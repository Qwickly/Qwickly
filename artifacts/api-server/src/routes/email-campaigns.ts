import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { isEmailConfigured, sendEmail } from "../lib/email-sender";

const router = Router();
const EMAIL_DAILY_BATCH_SIZE = 100;
const EMAIL_DAILY_GLOBAL_LIMIT = 100;

async function getBusinessForUser(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

async function getEmailDailyUsage(businessId: string): Promise<{ used: number; limit: number }> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await getSupabaseAdmin()
    .from("usage_tracking")
    .select("marketing_messages_sent")
    .eq("business_id", businessId)
    .eq("tracking_date", today)
    .maybeSingle();

  const used = Number(data?.marketing_messages_sent ?? 0);
  return { used, limit: EMAIL_DAILY_BATCH_SIZE };
}

async function getGlobalEmailDailyUsage(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await getSupabaseAdmin()
    .from("usage_tracking")
    .select("marketing_messages_sent")
    .eq("tracking_date", today);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce((sum, row) => sum + Number(row?.marketing_messages_sent ?? 0), 0);
}

async function incrementEmailDailyUsage(businessId: string, incrementBy: number): Promise<void> {
  if (incrementBy <= 0) {
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const { data: existingRow, error: fetchError } = await getSupabaseAdmin()
    .from("usage_tracking")
    .select("id, marketing_messages_sent")
    .eq("business_id", businessId)
    .eq("tracking_date", today)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (existingRow) {
    const nextUsed = Number(existingRow.marketing_messages_sent ?? 0) + incrementBy;
    const { error: updateError } = await getSupabaseAdmin()
      .from("usage_tracking")
      .update({ marketing_messages_sent: nextUsed, updated_at: new Date().toISOString() })
      .eq("id", existingRow.id);

    if (updateError) {
      throw new Error(updateError.message);
    }
    return;
  }

  const { error: insertError } = await getSupabaseAdmin().from("usage_tracking").insert({
    business_id: businessId,
    tracking_date: today,
    marketing_messages_sent: incrementBy,
    whatsapp_messages_sent: 0,
    whatsapp_campaigns_sent: 0,
    bookings_created: 0,
    bookings_completed: 0,
    bookings_cancelled: 0,
    clients_added: 0,
    review_requests_sent: 0,
    reviews_received: 0,
    metadata: {},
  });

  if (insertError) {
    throw new Error(insertError.message);
  }
}

router.post("/email/campaigns/send", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const { campaignId, recipients, subject, message, contentType = "text" } = req.body;

    if (!campaignId || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ error: "Campaign ID and recipients are required" });
    }

    const business = await getBusinessForUser(user.id);
    if (!business) {
      return res.status(403).json({ error: "Business not found" });
    }

    if (!isEmailConfigured()) {
      return res.status(409).json({
        error: "Email sending is not configured yet. Add SendGrid credentials and a verified sender address before sending campaigns.",
      });
    }

    const { used, limit } = await getEmailDailyUsage(business.id);
    const globalUsed = await getGlobalEmailDailyUsage();
    const remaining = Math.max(limit - used, 0);
    const globalRemaining = Math.max(EMAIL_DAILY_GLOBAL_LIMIT - globalUsed, 0);
    const batchCount = Math.min(recipients.length, remaining, globalRemaining);

    if (batchCount <= 0) {
      return res.status(429).json({ error: "Daily email limit reached for today. Try again tomorrow." });
    }

    const recipientsToSend = recipients.slice(0, batchCount);
    const htmlBody = contentType === "html" ? message : undefined;

    const { data: businessData } = await getSupabaseAdmin()
      .from("businesses")
      .select("business_name, email")
      .eq("id", business.id)
      .maybeSingle();

    const businessName = (businessData?.business_name as string | undefined)?.trim() || undefined;
    const replyTo = (businessData?.email as string | undefined)?.trim() || undefined;

    const results = [] as Array<{ recipient: string; status: "sent" | "failed"; error?: string }>;
    for (const recipient of recipientsToSend) {
      try {
        await sendEmail({
          to: recipient,
          subject: subject || "Marketing campaign",
          text: message || "",
          html: htmlBody,
          fromName: businessName,
          replyTo,
        });
        results.push({ recipient, status: "sent" });
      } catch (error) {
        results.push({ recipient, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }

    const sentCount = results.filter((item) => item.status === "sent").length;
    if (sentCount > 0) {
      await incrementEmailDailyUsage(business.id, sentCount);
    }

    await getSupabaseAdmin()
      .from("marketing_campaigns")
      .update({
        status: "completed",
        sent: sentCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return res.json({
      success: true,
      queued: recipients.length,
      sent: sentCount,
      failed: results.filter((item) => item.status === "failed").length,
      dailyLimit: limit,
      globalDailyLimit: EMAIL_DAILY_GLOBAL_LIMIT,
      remainingAfterSend: Math.max(limit - used - sentCount, 0),
      globalRemainingAfterSend: Math.max(EMAIL_DAILY_GLOBAL_LIMIT - globalUsed - sentCount, 0),
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email campaign";
    return res.status(500).json({ error: message });
  }
});

export default router;
