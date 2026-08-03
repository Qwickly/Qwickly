import { logger } from "./logger";
import { getSupabaseAdmin } from "../lib/supabase";
import { sendEmail } from "./email-sender";
import { spendCredits } from "./credits";
import { EMAIL_DAILY_BATCH_SIZE } from "../routes/email-campaigns";
import { getBusinessContact, getVerifiedSenderAddress, getBrandColor } from "./business-email-profile";

/** Plain-text fallback for an HTML campaign body. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function processEmailCampaignsOnce(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  try {
    const supa = getSupabaseAdmin();

    // Find businesses with pending recipients scheduled for today or earlier.
    // NOTE: this used `.group("business_id")`, which is not a PostgREST method —
    // it doesn't exist on the query builder, so the call threw and the worker
    // never sent anything. De-duplicated in JS instead.
    const { data: businessRows, error: businessError } = await supa
      .from("marketing_campaign_recipients")
      .select("business_id")
      .eq("status", "pending")
      .lte("scheduled_for", today);

    if (businessError) {
      logger.error({ err: businessError }, "[EmailCampaignWorker] Failed to fetch pending businesses");
      return;
    }

    const businessIds = Array.from(
      new Set((businessRows ?? []).map((r: any) => r.business_id as string)),
    );
    for (const businessId of businessIds) {
      // Campaigns require a verified custom domain (see email-campaigns.ts
      // requireVerifiedDomain gate at queue time) — each business sends on its
      // own domain's reputation, so there's no shared platform pool to cap.
      // Re-checked here (not just at queue time) because a domain can be
      // deleted/unverified after rows were already queued. Deliberately PAUSE
      // rather than fail: rows created before this gate existed (or a domain
      // that briefly lapses) must not be permanently killed — status stays
      // 'pending' so sending resumes on its own once a domain is verified.
      // Marking them 'failed' here would silently drop an in-flight campaign
      // with no recovery path other than the business re-uploading and
      // re-sending the whole list.
      const fromOverride = await getVerifiedSenderAddress(businessId);
      if (!fromOverride) {
        const { count } = await supa
          .from("marketing_campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("status", "pending")
          .lte("scheduled_for", today);
        if (count) {
          logger.warn(
            { businessId, count },
            "[EmailCampaignWorker] No verified domain — pausing queued rows until one is verified",
          );
        }
        continue;
      }

      // get how many sent for this business today
      const { data: usage } = await supa
        .from("usage_tracking")
        .select("marketing_messages_sent")
        .eq("business_id", businessId)
        .eq("tracking_date", today)
        .maybeSingle();
      const used = Number(usage?.marketing_messages_sent ?? 0);
      const sendCount = Math.max(EMAIL_DAILY_BATCH_SIZE - used, 0);
      if (sendCount <= 0) continue;

      const { name: fromName } = await getBusinessContact(businessId);
      const brandColor = await getBrandColor(businessId);

      // fetch up to sendCount pending recipients
      const { data: recipients, error: recError } = await supa
        .from("marketing_campaign_recipients")
        .select("id, campaign_id, recipient_text, attempt_count")
        .eq("business_id", businessId)
        .eq("status", "pending")
        .lte("scheduled_for", today)
        .limit(sendCount);

      if (recError) {
        logger.error({ err: recError }, "[EmailCampaignWorker] Failed to fetch recipients");
        continue;
      }

      // Load the campaigns these recipients belong to. The recipient rows carry
      // only an address — the subject and body live on the campaign, so without
      // this every email went out blank and titled "Marketing campaign".
      const campaignIds = Array.from(new Set((recipients ?? []).map((r) => r.campaign_id)));
      const campaignsById = new Map<
        string,
        { name: string; message: string; content_type: string }
      >();

      if (campaignIds.length > 0) {
        const { data: campaignRows, error: campaignError } = await supa
          .from("marketing_campaigns")
          .select("id, name, message, content_type")
          .in("id", campaignIds);

        if (campaignError) {
          logger.error({ err: campaignError }, "[EmailCampaignWorker] Failed to fetch campaigns");
          continue;
        }

        for (const c of campaignRows ?? []) {
          campaignsById.set(c.id as string, {
            name: (c.name as string) ?? "",
            message: (c.message as string) ?? "",
            content_type: (c.content_type as string) ?? "text",
          });
        }
      }

      for (const row of recipients ?? []) {
        try {
          const campaign = campaignsById.get(row.campaign_id);

          // No campaign, or nothing to say. Don't send a blank email and don't
          // charge for one — fail the row so it's visible instead of silent.
          if (!campaign || !campaign.message.trim()) {
            logger.warn(
              { recipientId: row.id, campaignId: row.campaign_id },
              "[EmailCampaignWorker] Skipping recipient — campaign missing or has no message",
            );
            await supa
              .from("marketing_campaign_recipients")
              .update({
                status: "failed",
                attempt_count: (row.attempt_count ?? 0) + 1,
                error: "Campaign missing or has no message body",
              })
              .eq("id", row.id);
            continue;
          }

          const isHtml = campaign.content_type === "html";
          await sendEmail({
            to: row.recipient_text,
            subject: campaign.name || "Marketing campaign",
            // sendEmail needs a plain-text part regardless; for HTML campaigns
            // it's the fallback for clients that won't render HTML.
            text: isHtml ? stripHtml(campaign.message) : campaign.message,
            ...(isHtml ? { html: campaign.message } : {}),
            fromName,
            fromOverride,
            brandColor,
            // Campaigns only ever send from a verified custom domain now — always
            // white-label, there's no "via Qwickly" shared-domain campaign tier.
            whiteLabel: true,
          });

          // Charge one marketing email credit AFTER SendGrid accepted it. Included
          // allowance is consumed before purchased credits — spend_credits handles
          // that ordering. Transactional booking emails never come through here.
          const spend = await spendCredits({
            businessId,
            kind: "marketing_emails",
            amount: 1,
            reason: "email_campaign",
            refId: `campaign:${row.campaign_id}`,
          });

          if (!spend.ok) {
            // Out of credits. The recipient stays 'pending' rather than 'sent' —
            // wrong, but this branch means the email already went out, so mark it
            // sent and stop processing this business rather than double-sending it
            // on the next tick.
            logger.warn(
              { businessId, campaignId: row.campaign_id, error: spend.error },
              "[EmailCampaignWorker] Credits exhausted — halting this business for this tick",
            );
            await supa
              .from("marketing_campaign_recipients")
              .update({ status: "sent", sent_at: new Date().toISOString(), attempt_count: 1 })
              .eq("id", row.id);
            break;
          }

          await supa
            .from("marketing_campaign_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString(), attempt_count: 1 })
            .eq("id", row.id);

          // increment campaign.sent
          const { data: campaignRow } = await supa
            .from("marketing_campaigns")
            .select("sent")
            .eq("id", row.campaign_id)
            .maybeSingle();
          const nextSent = Number(campaignRow?.sent ?? 0) + 1;
          await supa.from("marketing_campaigns").update({ sent: nextSent }).eq("id", row.campaign_id);

          // increment usage_tracking for this business/day
          const { data: existingUsage } = await supa
            .from("usage_tracking")
            .select("id, marketing_messages_sent")
            .eq("business_id", businessId)
            .eq("tracking_date", today)
            .maybeSingle();
          if (existingUsage) {
            const updated = Number(existingUsage.marketing_messages_sent ?? 0) + 1;
            await supa.from("usage_tracking").update({ marketing_messages_sent: updated, updated_at: new Date().toISOString() }).eq("id", existingUsage.id);
          } else {
            await supa.from("usage_tracking").insert({ business_id: businessId, tracking_date: today, marketing_messages_sent: 1, whatsapp_messages_sent: 0, whatsapp_campaigns_sent: 0, bookings_created: 0, bookings_completed: 0, bookings_cancelled: 0, clients_added: 0, review_requests_sent: 0, reviews_received: 0, metadata: {} });
          }
        } catch (err) {
          logger.error({ err, recipientId: row.id }, "[EmailCampaignWorker] Failed to send email to recipient");
          // mark failed and increment attempt_count
          await supa
            .from("marketing_campaign_recipients")
            .update({ status: "failed", attempt_count: (row.attempt_count ?? 0) + 1, error: (err as any)?.message ?? String(err) })
            .eq("id", row.id);
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "[EmailCampaignWorker] Tick failed");
  }
}

export function startEmailCampaignWorker(intervalMs: number = 30_000): NodeJS.Timeout {
  logger.info({ intervalMs }, "[EmailCampaignWorker] starting");
  const timer = setInterval(() => {
    void processEmailCampaignsOnce();
  }, intervalMs);
  return timer;
}
