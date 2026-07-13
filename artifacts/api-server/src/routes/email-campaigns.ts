import { Router } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { isEmailConfigured, sendEmail } from "../lib/email-sender";

const router = Router();
export const EMAIL_DAILY_BATCH_SIZE = 100;
export const EMAIL_DAILY_GLOBAL_LIMIT = 100;

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

    // Accept large recipient lists up to 7,000 and persist them for background sending.
    if (recipients.length > 7000) {
      return res.status(400).json({ error: "Maximum 7000 recipients per campaign allowed" });
    }

    const supa = getSupabaseAdmin();

    // Schedule recipients across days at EMAIL_DAILY_BATCH_SIZE per business (e.g., 100/day)
    const today = new Date();
    const rowsToInsert: Array<any> = [];
    for (let i = 0; i < recipients.length; i += 1) {
      const dayOffset = Math.floor(i / EMAIL_DAILY_BATCH_SIZE);
      const scheduled = new Date(today);
      scheduled.setDate(today.getDate() + dayOffset);
      rowsToInsert.push({
        campaign_id: campaignId,
        business_id: business.id,
        recipient_text: recipients[i],
        recipient_type: "email",
        status: "pending",
        scheduled_for: scheduled.toISOString().split("T")[0],
      });
    }

    // Insert recipients in safe chunks to avoid oversized payloads
    const CHUNK_SIZE = 500;
    for (let i = 0; i < rowsToInsert.length; i += CHUNK_SIZE) {
      const chunk = rowsToInsert.slice(i, i + CHUNK_SIZE);
      const { error: chunkError } = await supa.from("marketing_campaign_recipients").insert(chunk);
      if (chunkError) {
        throw new Error(chunkError.message);
      }
    }

    // Update campaign row to active and set recipient_count
    await supa
      .from("marketing_campaigns")
      .update({ status: "active", recipient_count: recipients.length, updated_at: new Date().toISOString() })
      .eq("id", campaignId);

    return res.json({
      success: true,
      queued: recipients.length,
      dailyBatchSize: EMAIL_DAILY_BATCH_SIZE,
      note: "Recipients scheduled for background sending. Sending will occur in daily batches.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email campaign";
    return res.status(500).json({ error: message });
  }
});

export default router;
