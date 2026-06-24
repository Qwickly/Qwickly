import { getSupabaseAdmin } from "./supabase";
import { sendTenantMessageByPhone } from "./whatsapp";
import { logger } from "./logger";

export type ClientNotificationRow = {
  id: string;
  business_id: string;
  booking_id: string;
  client_id: string;
  notification_type: string;
  message: string;
  status: string;
};

/**
 * Get tenant_id for a given business_id by looking up the business owner's tenant.
 * Both business and tenant are owned by the same auth.user.
 */
async function getTenantIdForBusiness(businessId: string): Promise<string | null> {
  try {
    // Get business owner
    const { data: business, error: bizError } = await getSupabaseAdmin()
      .from("businesses")
      .select("user_id")
      .eq("id", businessId)
      .maybeSingle();

    if (bizError || !business?.user_id) {
      logger.error("[Client Notifications] Failed to get business:", bizError);
      return null;
    }

    // Get tenant for that user
    const { data: tenant, error: tenantError } = await getSupabaseAdmin()
      .from("tenants")
      .select("id")
      .eq("owner_user_id", business.user_id)
      .maybeSingle();

    if (tenantError || !tenant?.id) {
      logger.error("[Client Notifications] Failed to get tenant for user:", tenantError);
      return null;
    }

    return tenant.id;
  } catch (err) {
    logger.error("[Client Notifications] Error getting tenant for business:", err);
    return null;
  }
}

/**
 * Get client phone by client_id
 */
async function getClientPhone(clientId: string): Promise<string | null> {
  try {
    const { data: client, error } = await getSupabaseAdmin()
      .from("clients")
      .select("phone")
      .eq("id", clientId)
      .maybeSingle();

    if (error || !client?.phone) {
      logger.error("[Client Notifications] Client member not found or has no phone:", error);
      return null;
    }

    return client.phone as string;
  } catch (err) {
    logger.error("[Client Notifications] Error getting client phone:", err);
    return null;
  }
}

/**
 * Mark notification as sent or failed
 */
async function updateNotificationStatus(
  notificationId: string,
  status: "sent" | "failed",
  errorMessage?: string,
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("client_notifications")
      .update({
        status,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notificationId);

    if (error) {
      logger.error("[Client Notifications] Failed to update notification status:", error);
    }
  } catch (err) {
    logger.error("[Client Notifications] Error updating notification:", err);
  }
}

/**
 * Process a single pending client notification
 */
async function processNotification(notification: ClientNotificationRow): Promise<void> {
  try {
    // Get tenant ID for this business
    const tenantId = await getTenantIdForBusiness(notification.business_id);
    if (!tenantId) {
      await updateNotificationStatus(
        notification.id,
        "failed",
        "Could not resolve tenant for business",
      );
      return;
    }

    // Get client phone
    const phone = await getClientPhone(notification.client_id);
    if (!phone) {
      await updateNotificationStatus(notification.id, "failed", "Client has no phone");
      return;
    }

    // Send WhatsApp message
    await sendTenantMessageByPhone(tenantId, phone, notification.message);

    // Mark as sent
    await updateNotificationStatus(notification.id, "sent");
    logger.info("[Client Notifications] Sent successfully", {
      notificationId: notification.id,
      clientId: notification.client_id,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateNotificationStatus(notification.id, "failed", errorMsg);
    logger.error("[Client Notifications] Failed to send notification:", {
      notificationId: notification.id,
      error: errorMsg,
    });
  }
}

/**
 * Worker function: Process all pending client notifications scheduled in the past or now
 * Should be called periodically (e.g., every 5-10 seconds) or as a cron job
 */
export async function processClientNotifications(): Promise<void> {
  try {
    logger.info("[Client Notifications] Starting to process pending notifications");

    // Fetch all pending notifications that are scheduled to be sent now or in the past
    const { data: notifications, error } = await getSupabaseAdmin()
      .from("client_notifications")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true });

    if (error) {
      logger.error("[Client Notifications] Failed to fetch notifications:", error);
      return;
    }

    if (!notifications || notifications.length === 0) {
      logger.debug("[Client Notifications] No pending notifications to send");
      return;
    }

    logger.info("[Client Notifications] Processing", { count: notifications.length });

    // Process each notification sequentially to avoid rate limiting
    for (const notification of notifications) {
      await processNotification(notification as ClientNotificationRow);
      // Small delay between messages to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (err) {
    logger.error("[Client Notifications] Error in notification processor:", err);
  }
}

/**
 * Start a background worker that periodically processes client notifications
 * Runs every interval (default 10 seconds)
 */
export function startClientNotificationWorker(interval: number = 10000): NodeJS.Timeout {
  logger.info("[Client Notifications] Starting background worker", { intervalMs: interval });

  return setInterval(async () => {
    await processClientNotifications();
  }, interval);
}
