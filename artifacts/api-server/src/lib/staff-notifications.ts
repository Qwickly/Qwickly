import { getSupabaseAdmin } from "./supabase";
import { sendTenantMessageByPhone } from "./whatsapp";
import { logger } from "./logger";

export type StaffNotificationRow = {
  id: string;
  business_id: string;
  booking_id: string;
  staff_id: string;
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
      logger.error("[Staff Notifications] Failed to get business:", bizError);
      return null;
    }

    // Get tenant for that user
    const { data: tenant, error: tenantError } = await getSupabaseAdmin()
      .from("tenants")
      .select("id")
      .eq("owner_user_id", business.user_id)
      .maybeSingle();

    if (tenantError || !tenant?.id) {
      logger.error("[Staff Notifications] Failed to get tenant for user:", tenantError);
      return null;
    }

    return tenant.id;
  } catch (err) {
    logger.error("[Staff Notifications] Error getting tenant for business:", err);
    return null;
  }
}

/**
 * Get staff member phone by staff_id
 */
async function getStaffPhone(staffId: string): Promise<string | null> {
  try {
    const { data: staff, error } = await getSupabaseAdmin()
      .from("staff_members")
      .select("phone")
      .eq("id", staffId)
      .maybeSingle();

    if (error || !staff?.phone) {
      logger.error("[Staff Notifications] Staff member not found or has no phone:", error);
      return null;
    }

    return staff.phone as string;
  } catch (err) {
    logger.error("[Staff Notifications] Error getting staff phone:", err);
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
      .from("staff_notifications")
      .update({
        status,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", notificationId);

    if (error) {
      logger.error("[Staff Notifications] Failed to update notification status:", error);
    }
  } catch (err) {
    logger.error("[Staff Notifications] Error updating notification:", err);
  }
}

/**
 * Process a single pending staff notification
 */
async function processNotification(notification: StaffNotificationRow): Promise<void> {
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

    // Get staff member phone
    const phone = await getStaffPhone(notification.staff_id);
    if (!phone) {
      await updateNotificationStatus(notification.id, "failed", "Staff member has no phone");
      return;
    }

    // Send WhatsApp message
    await sendTenantMessageByPhone(tenantId, phone, notification.message);

    // Mark as sent
    await updateNotificationStatus(notification.id, "sent");
    logger.info("[Staff Notifications] Sent successfully", {
      notificationId: notification.id,
      staffId: notification.staff_id,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await updateNotificationStatus(notification.id, "failed", errorMsg);
    logger.error("[Staff Notifications] Failed to send notification:", {
      notificationId: notification.id,
      error: errorMsg,
    });
  }
}

/**
 * Worker function: Process all pending staff notifications
 * Should be called periodically (e.g., every 5-10 seconds) or as a cron job
 */
export async function processStaffNotifications(): Promise<void> {
  try {
    logger.info("[Staff Notifications] Starting to process pending notifications");

    // Fetch all pending notifications
    const { data: notifications, error } = await getSupabaseAdmin()
      .from("staff_notifications")
      .select("*")
      .eq("status", "pending")
      .order("scheduled_at", { ascending: true });

    if (error) {
      logger.error("[Staff Notifications] Failed to fetch notifications:", error);
      return;
    }

    if (!notifications || notifications.length === 0) {
      logger.debug("[Staff Notifications] No pending notifications");
      return;
    }

    logger.info("[Staff Notifications] Processing", { count: notifications.length });

    // Process each notification sequentially to avoid rate limiting
    for (const notification of notifications) {
      await processNotification(notification as StaffNotificationRow);
      // Small delay between messages to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (err) {
    logger.error("[Staff Notifications] Error in notification processor:", err);
  }
}

/**
 * Start a background worker that periodically processes staff notifications
 * Runs every interval (default 10 seconds)
 */
export function startStaffNotificationWorker(interval: number = 10000): NodeJS.Timeout {
  logger.info("[Staff Notifications] Starting background worker", { intervalMs: interval });

  return setInterval(async () => {
    await processStaffNotifications();
  }, interval);
}
