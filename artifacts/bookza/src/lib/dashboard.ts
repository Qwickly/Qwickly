import { addDays, format } from "date-fns";
import type { CatalogBooking, CatalogPayment } from "@/types/catalog";
import { fetchBookings, fetchPayments, fetchServices, fetchStaff, fetchClients } from "@/lib/catalog";
import { fetchBookingPageSettings } from "@/lib/booking-page";
import { ensureBusiness, fetchBusinessSettings, fetchWhatsappConnectionStatus } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

export type DashboardAttentionItem = {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  href: string;
  action: string;
};

export type DashboardDay = {
  date: string;
  label: string;
  count: number;
  value: number;
  firstTime: string | null;
  lastTime: string | null;
  staffCount: number;
};

export type DashboardSystemStatus = {
  setupComplete: boolean;
  setupItems: Array<{ label: string; complete: boolean; href: string }>;
  systems: Array<{ label: string; status: "good" | "warning" | "off"; detail: string; href: string }>;
};

export type DashboardOperations = {
  today: {
    bookings: CatalogBooking[];
    bookingCount: number;
    expectedValue: number;
    newClients: number;
    completed: number;
    remaining: number;
    needsAttention: number;
    nextBooking: CatalogBooking | null;
  };
  tomorrowAndNext: DashboardDay[];
  attention: DashboardAttentionItem[];
  systemStatus: DashboardSystemStatus;
  unreadWhatsapp: number;
  aiDraftsAwaitingReview: number;
};

type NotificationRow = {
  id: string;
  booking_id: string | null;
  notification_type: string;
  channel?: string | null;
  status: string;
  error_message?: string | null;
  scheduled_at: string;
};

type AiDraftRow = {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  status: string;
  created_at: string;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function inRange(value: string, start: Date, end: Date) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start.getTime() && time <= end.getTime();
}

function isActiveBooking(booking: CatalogBooking) {
  return booking.status !== "cancelled";
}

function isCompletedToday(booking: CatalogBooking, now: Date) {
  return booking.status === "completed" || (booking.status === "confirmed" && new Date(booking.endTime) < now);
}

function bookingPaymentTotal(booking: CatalogBooking, payments: CatalogPayment[]) {
  return payments
    .filter((payment) => payment.bookingId === booking.id && payment.status === "completed")
    .reduce((sum, payment) => sum + payment.amount, 0);
}

async function fetchNotificationRows(businessId: string) {
  const today = startOfDay(new Date()).toISOString();
  const [clientNotifications, staffNotifications] = await Promise.all([
    supabase
      .from("client_notifications")
      .select("id, booking_id, notification_type, channel, status, error_message, scheduled_at")
      .eq("business_id", businessId)
      .gte("scheduled_at", today)
      .limit(100),
    supabase
      .from("staff_notifications")
      .select("id, booking_id, notification_type, status, error_message, scheduled_at")
      .eq("business_id", businessId)
      .gte("scheduled_at", today)
      .limit(100),
  ]);

  return {
    client: (clientNotifications.data ?? []) as NotificationRow[],
    staff: (staffNotifications.data ?? []) as NotificationRow[],
    failedCount:
      (clientNotifications.data ?? []).filter((row) => row.status === "failed").length +
      (staffNotifications.data ?? []).filter((row) => row.status === "failed").length,
  };
}

async function fetchAiDrafts(businessId: string) {
  const { data } = await supabase
    .from("whatsapp_ai_drafts")
    .select("id, client_name, client_phone, status, created_at")
    .eq("business_id", businessId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(25);

  return (data ?? []) as AiDraftRow[];
}

async function fetchUnreadWhatsappCount() {
  try {
    const tenantResult = await supabase.rpc("ensure_my_tenant");
    if (tenantResult.error || !tenantResult.data) return 0;
    const today = startOfDay(new Date()).toISOString();
    const { count } = await supabase
      .from("inbound_messages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantResult.data as string)
      .gte("received_at", today);
    return count ?? 0;
  } catch {
    return 0;
  }
}

function buildAttentionItems({
  todayBookings,
  futureBookings,
  payments,
  notifications,
  aiDrafts,
  unreadWhatsapp,
}: {
  todayBookings: CatalogBooking[];
  futureBookings: CatalogBooking[];
  payments: CatalogPayment[];
  notifications: Awaited<ReturnType<typeof fetchNotificationRows>>;
  aiDrafts: AiDraftRow[];
  unreadWhatsapp: number;
}): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];
  const pending = [...todayBookings, ...futureBookings]
    .filter((booking) => booking.status === "pending")
    .slice(0, 3);
  pending.forEach((booking) => {
    items.push({
      id: `pending-${booking.id}`,
      priority: "high",
      title: "Booking needs confirmation",
      detail: `${booking.clientName} booked ${booking.serviceName} for ${format(new Date(booking.startTime), "EEE, d MMM h:mm a")}.`,
      href: "/bookings",
      action: "Review booking",
    });
  });

  notifications.client
    .filter((row) => row.status === "failed")
    .slice(0, 3)
    .forEach((row) => {
      items.push({
        id: `notification-${row.id}`,
        priority: "high",
        title: "Client notification failed",
        detail: `${row.channel ?? "Notification"} ${row.notification_type.replaceAll("_", " ")} did not send.`,
        href: "/settings",
        action: "Check notifications",
      });
    });

  aiDrafts.slice(0, 3).forEach((draft) => {
    items.push({
      id: `ai-draft-${draft.id}`,
      priority: "medium",
      title: "AI reply awaits review",
      detail: draft.client_name || draft.client_phone || "A WhatsApp draft needs a decision.",
      href: "/whatsapp/bot",
      action: "Review draft",
    });
  });

  const unpaidCompleted = todayBookings
    .filter((booking) => isCompletedToday(booking, new Date()))
    .filter((booking) => bookingPaymentTotal(booking, payments) < booking.totalAmount)
    .slice(0, 3);
  unpaidCompleted.forEach((booking) => {
    items.push({
      id: `unpaid-${booking.id}`,
      priority: "medium",
      title: "Completed booking is unpaid",
      detail: `${booking.clientName} has ${formatCurrency(booking.totalAmount - bookingPaymentTotal(booking, payments))} still outstanding.`,
      href: "/payments",
      action: "Record payment",
    });
  });

  [...todayBookings, ...futureBookings]
    .filter((booking) => !booking.staffId)
    .slice(0, 3)
    .forEach((booking) => {
      items.push({
        id: `staff-${booking.id}`,
        priority: "medium",
        title: "Booking has no staff member",
        detail: `${booking.serviceName} for ${booking.clientName} is unassigned.`,
        href: "/bookings",
        action: "Assign staff",
      });
    });

  const missingContact = [...todayBookings, ...futureBookings]
    .filter((booking) => !booking.clientPhone)
    .slice(0, 2);
  missingContact.forEach((booking) => {
    items.push({
      id: `contact-${booking.id}`,
      priority: "low",
      title: "Client phone is missing",
      detail: `${booking.clientName} may not receive WhatsApp updates.`,
      href: `/clients/${booking.clientId}`,
      action: "Update client",
    });
  });

  if (unreadWhatsapp > 0) {
    items.push({
      id: "whatsapp-unread",
      priority: "medium",
      title: "WhatsApp messages received today",
      detail: `${unreadWhatsapp} inbound message${unreadWhatsapp === 1 ? "" : "s"} recorded today.`,
      href: "/whatsapp",
      action: "Open inbox",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 10);
}

function buildUpcomingDays(bookings: CatalogBooking[]) {
  return Array.from({ length: 5 }).map((_, index) => {
    const day = startOfDay(addDays(new Date(), index + 1));
    const end = endOfDay(day);
    const dayBookings = bookings
      .filter((booking) => isActiveBooking(booking) && inRange(booking.startTime, day, end))
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const staffIds = new Set(dayBookings.map((booking) => booking.staffId).filter(Boolean));
    return {
      date: day.toISOString(),
      label: index === 0 ? "Tomorrow" : format(day, "EEE, d MMM"),
      count: dayBookings.length,
      value: dayBookings.reduce((sum, booking) => sum + booking.totalAmount, 0),
      firstTime: dayBookings[0] ? format(new Date(dayBookings[0].startTime), "HH:mm") : null,
      lastTime: dayBookings.at(-1) ? format(new Date(dayBookings.at(-1)!.startTime), "HH:mm") : null,
      staffCount: staffIds.size,
    };
  });
}

function formatCurrency(value: number) {
  return `R ${Math.round(value).toLocaleString()}`;
}

async function buildSystemStatus({
  businessId,
  serviceCount,
  staffCount,
  notificationsFailed,
}: {
  businessId: string;
  serviceCount: number;
  staffCount: number;
  notificationsFailed: number;
}): Promise<DashboardSystemStatus> {
  const [settings, bookingPage, whatsapp] = await Promise.all([
    fetchBusinessSettings(businessId),
    fetchBookingPageSettings().catch(() => null),
    fetchWhatsappConnectionStatus().catch(() => null),
  ]);

  const businessComplete = Boolean(settings.business.business_name && settings.business.phone && settings.business.email);
  const hoursConfigured = settings.operatingHours.some((hour) => hour.is_open);
  const notificationOn = Boolean(
    settings.notifications.booking_confirmations ||
      settings.notifications.reminder_24h ||
      settings.notifications.reminder_2h ||
      settings.notifications.cancellation_notices ||
      settings.notifications.rescheduling_alerts,
  );
  const depositOn = Boolean(settings.deposits.require_deposit);
  const paymentConnected = settings.paymentProviders.some((provider) => provider.enabled || provider.connected);
  const whatsappConnected = whatsapp?.status === "connected";
  const emailActive = Boolean(
    settings.notifications.booking_confirmations_email ||
      settings.notifications.reminder_24h_email ||
      settings.notifications.reminder_2h_email ||
      settings.notifications.cancellation_notices_email ||
      settings.notifications.rescheduling_alerts_email ||
      settings.notifications.review_requests_email,
  );

  const setupItems = [
    { label: "Business details", complete: businessComplete, href: "/settings" },
    { label: "Services added", complete: serviceCount > 0, href: "/services" },
    { label: "Staff added", complete: staffCount > 0, href: "/staff" },
    { label: "Availability configured", complete: hoursConfigured, href: "/settings" },
    { label: "Booking page published", complete: Boolean(bookingPage?.isPublished), href: "/booking-page" },
    { label: "Notifications configured", complete: notificationOn, href: "/settings" },
    { label: "Deposits configured", complete: depositOn, href: "/settings" },
    { label: "WhatsApp connected", complete: whatsappConnected, href: "/whatsapp" },
  ];

  return {
    setupComplete: setupItems.every((item) => item.complete),
    setupItems,
    systems: [
      {
        label: "Booking page",
        status: bookingPage?.isPublished ? "good" : "warning",
        detail: bookingPage?.isPublished ? "Live and bookable" : "Not published",
        href: "/booking-page",
      },
      {
        label: "Email",
        status: emailActive ? "good" : "off",
        detail: emailActive ? "Email notifications active" : "Email notifications off",
        href: "/settings",
      },
      {
        label: "WhatsApp",
        status: whatsappConnected ? "good" : "warning",
        detail: whatsappConnected ? whatsapp?.connectedPhone ?? "Connected" : "Not connected",
        href: "/whatsapp",
      },
      {
        label: "Reminders",
        status: notificationOn ? "good" : "off",
        detail: notificationOn ? "Notifications enabled" : "Reminder settings off",
        href: "/settings",
      },
      {
        label: "Payments",
        status: paymentConnected || depositOn ? "good" : "off",
        detail: paymentConnected ? "Provider configured" : depositOn ? "Deposits required" : "No payment setup",
        href: "/payments",
      },
      {
        label: "Failures",
        status: notificationsFailed > 0 ? "warning" : "good",
        detail: notificationsFailed > 0 ? `${notificationsFailed} failed notification${notificationsFailed === 1 ? "" : "s"}` : "No failed notifications today",
        href: "/settings",
      },
    ],
  };
}

export async function fetchDashboardOperations(): Promise<DashboardOperations> {
  const businessId = await ensureBusiness();
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const nextWeekEnd = endOfDay(addDays(now, 6));

  const [bookings, payments, services, staff, clientsResult, notifications, aiDrafts, unreadWhatsapp] =
    await Promise.all([
      fetchBookings(),
      fetchPayments(),
      fetchServices(),
      fetchStaff(),
      fetchClients(1, 1000),
      fetchNotificationRows(businessId),
      fetchAiDrafts(businessId),
      fetchUnreadWhatsappCount(),
    ]);

  const todayBookings = bookings
    .filter((booking) => inRange(booking.startTime, todayStart, todayEnd) && isActiveBooking(booking))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const futureBookings = bookings
    .filter((booking) => new Date(booking.startTime) > now && new Date(booking.startTime) <= nextWeekEnd && isActiveBooking(booking))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const attention = buildAttentionItems({
    todayBookings,
    futureBookings,
    payments,
    notifications,
    aiDrafts,
    unreadWhatsapp,
  });
  const todayClientIds = new Set(todayBookings.map((booking) => booking.clientId));
  const clients = clientsResult.clients ?? [];
  const newClientsToday = clients.filter(
    (client) =>
      todayClientIds.has(client.id) &&
      inRange(client.createdAt, todayStart, todayEnd),
  ).length;

  return {
    today: {
      bookings: todayBookings,
      bookingCount: todayBookings.length,
      expectedValue: todayBookings.reduce((sum, booking) => sum + booking.totalAmount, 0),
      newClients: newClientsToday,
      completed: todayBookings.filter((booking) => isCompletedToday(booking, now)).length,
      remaining: todayBookings.filter((booking) => new Date(booking.startTime) >= now).length,
      needsAttention: attention.length,
      nextBooking: todayBookings.find((booking) => new Date(booking.startTime) >= now) ?? null,
    },
    tomorrowAndNext: buildUpcomingDays(bookings),
    attention,
    systemStatus: await buildSystemStatus({
      businessId,
      serviceCount: services.length,
      staffCount: staff.length,
      notificationsFailed: notifications.failedCount,
    }),
    unreadWhatsapp,
    aiDraftsAwaitingReview: aiDrafts.length,
  };
}

export const dashboardKeys = {
  operations: ["dashboard", "operations"] as const,
};
