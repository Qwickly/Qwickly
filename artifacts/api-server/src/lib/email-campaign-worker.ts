import { logger } from "./logger";
import { getSupabaseAdmin } from "../lib/supabase";
import { sendEmail } from "./email-sender";
import { EMAIL_DAILY_BATCH_SIZE, EMAIL_DAILY_GLOBAL_LIMIT } from "../routes/email-campaigns";

export async function processEmailCampaignsOnce(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  try {
    const supa = getSupabaseAdmin();

    // Compute global used today
    const { data: usageRows } = await supa
      .from("usage_tracking")
      .select("business_id, marketing_messages_sent")
      .eq("tracking_date", today);

    const globalUsed = (usageRows ?? []).reduce((s: number, r: any) => s + Number(r.marketing_messages_sent ?? 0), 0);
    let globalRemaining = Math.max(EMAIL_DAILY_GLOBAL_LIMIT - globalUsed, 0);
    if (globalRemaining <= 0) return;

    // Find businesses with pending recipients scheduled for today or earlier
    const { data: businessRows } = await supa
      .from("marketing_campaign_recipients")
      .select("business_id")
      .eq("status", "pending")
      .lte("scheduled_for", today)
      .group("business_id");

    const businessIds = (businessRows ?? []).map((r: any) => r.business_id) as string[];
    for (const businessId of businessIds) {
      if (globalRemaining <= 0) break;

      // get how many sent for this business today
      const { data: usage } = await supa
        .from("usage_tracking")
        .select("marketing_messages_sent")
        .eq("business_id", businessId)
        .eq("tracking_date", today)
        .maybeSingle();
      const used = Number(usage?.marketing_messages_sent ?? 0);
      const businessRemaining = Math.max(EMAIL_DAILY_BATCH_SIZE - used, 0);
      const sendCount = Math.min(businessRemaining, globalRemaining);
      if (sendCount <= 0) continue;

      // fetch up to sendCount pending recipients
      const { data: recipients, error: recError } = await supa
        .from("marketing_campaign_recipients")
        .select("id, campaign_id, recipient_text")
        .eq("business_id", businessId)
        .eq("status", "pending")
        .lte("scheduled_for", today)
        .limit(sendCount);

      if (recError) {
        logger.error({ err: recError }, "[EmailCampaignWorker] Failed to fetch recipients");
        continue;
      }

      for (const row of recipients ?? []) {
        try {
          await sendEmail({
            to: row.recipient_text,
            subject: "Marketing campaign",
            text: "",
          });

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

          globalRemaining -= 1;
          if (globalRemaining <= 0) break;
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
