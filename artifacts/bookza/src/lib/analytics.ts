import { format } from "date-fns";
import type { BookingStatus, ClientType } from "@/types/catalog";
import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y";

export type AnalyticsInsight = {
  title?: string;
  text: string;
  action?: string;
  tone?: "good" | "warning" | "opportunity" | "neutral";
};

export type AnalyticsMetric = {
  label: string;
  value: number | string;
  detail?: string;
  change?: number;
  format?: "currency" | "number" | "percent" | "text";
  unavailable?: boolean;
};

export type AnalyticsOverview = {
  totalRevenue: number;
  totalBookings: number;
  completedBookings: number;
  averageBookingValue: number;
  completionRate: number;
  retentionRate: number;
  noShowRate: number;
  noShowCount: number;
  cancelledCount: number;
  cancellationRate: number;
  previousRevenue: number;
  previousBookings: number;
  revenueChangePct: number;
  bookingsChangePct: number;
  futureBookedRevenue: number;
  futureBookedBookings: number;
  projectedRevenue: number;
  projectedBookings: number;
  revenueAtRisk: number;
  bestRevenueDay: string;
  quietestDay: string;
  topServiceName: string;
  topServiceShare: number;
  peakHour: string;
  peakHourBookings: number;
  returningClients: number;
  newClients: number;
  performanceSignal: "improving" | "declining" | "steady";
  revenueData: TrendPoint[];
  bookingDensityData: BookingDensityPoint[];
  workingDays: string[];
  serviceBreakdown: ServiceBreakdownPoint[];
  weekdayBreakdown: PeriodBreakdownPoint[];
  statusBreakdown: StatusBreakdownPoint[];
  hourlyDemand: HourlyDemandPoint[];
};

export type BookingDensityPoint = {
  isoDate: string;
  date: string;
  totalBookings: number;
  bookedValue: number;
  statusCounts: Partial<Record<BookingStatus, number>>;
};

export type TrendPoint = {
  date: string;
  isoDate: string;
  revenue: number;
  bookings: number;
};

export type ServiceBreakdownPoint = {
  id?: string;
  name: string;
  bookingCount: number;
  revenue: number;
  percentageOfTotal: number;
};

export type PeriodBreakdownPoint = {
  day: string;
  bookings: number;
  revenue: number;
};

export type StatusBreakdownPoint = {
  status: BookingStatus;
  count: number;
  revenue: number;
  percentageOfTotal: number;
};

export type HourlyDemandPoint = {
  hour: string;
  bookings: number;
  revenue: number;
};

export type AnalyticsClients = {
  summary: AnalyticsMetric[];
  newClients: number;
  returningClients: number;
  retentionRate: number;
  rebookingRate: number;
  averageClientValue: number;
  visitFrequency: number;
  inactiveClients: number;
  clientsWithoutFutureBooking: number;
  newReturningData: Array<{ name: string; clients: number }>;
  clientTypeData: Array<{ name: string; clients: number }>;
  clientValueDistribution: ClientValueDistributionPoint[];
  topClients: ClientAnalyticsRow[];
  inactiveClientRows: ClientAnalyticsRow[];
  noFutureBookingRows: ClientAnalyticsRow[];
};

export type ClientValueDistributionPoint = {
  band: string;
  clientCount: number;
  averageBookings: number;
};

export type ClientAnalyticsRow = {
  id: string;
  name: string;
  bookings: number;
  revenue: number;
  lastVisit: string;
  lastVisitTime: number | null;
  futureBookings: number;
};

export type AnalyticsStaff = {
  summary: AnalyticsMetric[];
  rows: StaffAnalyticsRow[];
  revenueData: Array<{ name: string; revenue: number; bookings: number }>;
  utilisationData: Array<{ name: string; utilisation: number }>;
  claims: string[];
};

export type StaffAnalyticsRow = {
  id: string | null;
  name: string;
  revenue: number;
  completedBookings: number;
  averageBookingValue: number;
  bookedHours: number;
  availableHours: number;
  utilisationRate: number;
  cancellationRate: number;
  noShowRate: number;
  retentionRate: number;
  revenuePerBookedHour: number;
};

export type AnalyticsServices = {
  summary: AnalyticsMetric[];
  rows: ServiceAnalyticsRow[];
  revenueData: Array<{ name: string; revenue: number; bookings: number }>;
  shareData: Array<{ name: string; value: number }>;
};

export type ServiceAnalyticsRow = {
  id: string | null;
  name: string;
  revenue: number;
  bookings: number;
  completedBookings: number;
  revenueShare: number;
  averageSellingValue: number;
  completionRate: number;
  cancellationRate: number;
  returningClientRate: number;
  bookedHours: number;
  revenuePerBookedHour: number;
};

export type AnalyticsBookings = {
  summary: AnalyticsMetric[];
  journey: BookingJourney;
  heatmap: BookingHeatmapPoint[];
  bookingTrendData: TrendPoint[];
  leadTimeDistribution: Array<{ name: string; bookings: number }>;
  pipelineByWeek: Array<{ week: string; completed: number; confirmed: number; pending: number }>;
  outcomeRows: BookingOutcomeRow[];
  pressurePoints: BookingPressurePoint[];
  claims: string[];
};

export type BookingJourney = {
  scheduled: number;
  attended: number;
  completed: number;
  noShow: number;
  cancelled: number;
  pending: number;
};

export type BookingHeatmapPoint = {
  day: string;
  hour: string;
  bookingCount: number;
  bookedValue: number;
  noShowRate: number;
};

export type BookingOutcomeRow = {
  outcome: string;
  status: BookingStatus;
  bookings: number;
  share: number;
  bookedValue: number;
  averageValue: number;
};

export type BookingPressurePoint = {
  period: string;
  bookings: number;
  completionRate: number;
  noShowRate: number;
  signal: string;
};

export type AnalyticsCampaigns = {
  summary: AnalyticsMetric[];
  rows: CampaignAnalyticsRow[];
  funnel: CampaignFunnelStage[];
  channelRows: CampaignChannelRow[];
  trendData: TrendPoint[];
  statusData: Array<{ name: string; count: number }>;
  engagementData: Array<{ name: string; value: number }>;
  claims: string[];
};

export type CampaignAnalyticsRow = {
  id: string;
  name: string;
  channel: string;
  status: string;
  audience: number;
  sent: number;
  failed: number;
  replies: number;
  deliveryRate: number;
  replyRate: number;
  bookingsGenerated: number | null;
  revenueAttributed: number | null;
  cost: number | null;
  roi: number | null;
};

export type CampaignFunnelStage = {
  name: string;
  value: number;
  previousRate: number;
  overallRate: number;
  format?: "currency";
  unavailable?: boolean;
};

export type CampaignChannelRow = {
  channel: string;
  sent: number;
  delivered: number | null;
  replies: number;
  bookings: number | null;
  revenue: number | null;
  cost: number | null;
  roi: number | null;
};

export type AnalyticsChatbot = {
  summary: AnalyticsMetric[];
  draftStatusData: Array<{ name: string; count: number }>;
  messageData: TrendPoint[];
  recentDrafts: ChatbotDraftRow[];
  settings: {
    enabled: boolean;
    reviewMode: boolean;
    faqCount: number;
  };
  claims: string[];
};

export type ChatbotDraftRow = {
  id: string;
  status: string;
  clientPhone: string;
  createdAt: string;
  needsHuman: boolean;
};

export type AnalyticsReport = {
  overview: AnalyticsOverview;
  clients: AnalyticsClients;
  staff: AnalyticsStaff;
  services: AnalyticsServices;
  bookings: AnalyticsBookings;
  campaigns: AnalyticsCampaigns;
  chatbot: AnalyticsChatbot;
  insights: AnalyticsInsight[];
};

type Relation<T> = T | T[] | null;

type BookingRow = {
  id: string;
  client_id: string | null;
  service_id: string | null;
  staff_id: string | null;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  total_amount: number | string | null;
  created_at: string;
  clients: Relation<{ name: string | null }>;
  services: Relation<{ name: string | null; duration: number | null }>;
  staff_members: Relation<{ name: string | null }>;
};

type AnalyticsBooking = {
  id: string;
  clientId: string | null;
  clientName: string;
  serviceId: string | null;
  serviceName: string;
  serviceDuration: number;
  staffId: string | null;
  staffName: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  originalStatus: BookingStatus;
  totalAmount: number;
  createdAt: string;
};

type ClientRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  client_type: ClientType | null;
  created_at: string;
};

type StaffRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  working_days: string[] | null;
};

type ServiceRow = {
  id: string;
  name: string | null;
  price: number | string | null;
  duration: number | null;
  is_active: boolean | null;
};

type CampaignRow = {
  id: string;
  name: string | null;
  channel: string | null;
  recipient_count: number | null;
  status: string | null;
  sent: number | null;
  opened: number | null;
  conversions: number | null;
  revenue: number | string | null;
  created_at: string;
};

type CampaignRecipientRow = {
  campaign_id: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string;
};

type EngagementRow = {
  campaign_id: string | null;
  sent_at: string;
  opened_at: string | null;
  responded_at: string | null;
  converted: boolean | null;
  conversion_value: number | string | null;
};

type InboundMessageRow = {
  created_at: string;
};

type BotDraftRow = {
  id: string;
  status: string | null;
  client_phone: string | null;
  created_at: string;
  decision_json: Record<string, unknown> | null;
};

type BotSettingsRow = {
  bot_enabled: boolean | null;
  review_mode: boolean | null;
};

type BotFaqRow = {
  id: string;
  is_active: boolean | null;
};

type OperatingHourRow = {
  day_name: string | null;
  is_open: boolean | null;
  open_time: string | null;
  close_time: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "No-show",
};

export const analyticsKeys = {
  report: (period: AnalyticsPeriod) => ["analytics", "report", period] as const,
  overview: (period: AnalyticsPeriod) =>
    ["analytics", "overview", period] as const,
  insights: (period: AnalyticsPeriod) =>
    ["analytics", "insights", period] as const,
};

function relationOne<T>(value: Relation<T> | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function effectiveStatus(status: BookingStatus, endTime: string): BookingStatus {
  return status === "confirmed" && new Date(endTime).getTime() < Date.now()
    ? "completed"
    : status;
}

function periodStart(period: AnalyticsPeriod): Date {
  const now = new Date();
  const start = new Date(now);
  const days =
    period === "7d" ? 6 : period === "30d" ? 29 : period === "90d" ? 89 : 364;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start;
}

function previousPeriodStart(period: AnalyticsPeriod, currentStart: Date): Date {
  const prev = new Date(currentStart);
  const days =
    period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  prev.setDate(prev.getDate() - days);
  return prev;
}

function periodLengthDays(period: AnalyticsPeriod): number {
  return period === "7d"
    ? 7
    : period === "30d"
      ? 30
      : period === "90d"
        ? 90
        : 365;
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return roundOne((part / total) * 100);
}

function changePct(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return roundOne(((current - previous) / previous) * 100);
}

function inRange(value: string, start: Date, end: Date): boolean {
  const date = new Date(value);
  return date >= start && date <= end;
}

function isActiveBooking(booking: AnalyticsBooking): boolean {
  return booking.status !== "cancelled";
}

function isCompletedBooking(booking: AnalyticsBooking): boolean {
  return booking.status === "completed";
}

function bookingHours(booking: AnalyticsBooking): number {
  const from = new Date(booking.startTime).getTime();
  const to = new Date(booking.endTime).getTime();
  if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
    return roundOne((to - from) / 36e5);
  }
  return roundOne((booking.serviceDuration || 60) / 60);
}

function buildDateBuckets(from: Date, to: Date): TrendPoint[] {
  const buckets: TrendPoint[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    buckets.push({
      date: format(cursor, "MMM d"),
      isoDate: format(cursor, "yyyy-MM-dd"),
      revenue: 0,
      bookings: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

function buildBookingDensityData(allBookings: AnalyticsBooking[]): BookingDensityPoint[] {
  const points = new Map<string, BookingDensityPoint>();

  allBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const isoDate = format(date, "yyyy-MM-dd");
    const row =
      points.get(isoDate) ??
      {
        isoDate,
        date: format(date, "MMM d"),
        totalBookings: 0,
        bookedValue: 0,
        statusCounts: {},
      };

    row.totalBookings += 1;
    row.bookedValue += booking.totalAmount;
    row.statusCounts[booking.originalStatus] = (row.statusCounts[booking.originalStatus] ?? 0) + 1;
    points.set(isoDate, row);
  });

  return Array.from(points.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function buildWeekdayBuckets(): PeriodBreakdownPoint[] {
  return [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ].map((day) => ({ day, bookings: 0, revenue: 0 }));
}

function buildHourlyBuckets(): HourlyDemandPoint[] {
  return Array.from({ length: 24 }).map((_, hour) => ({
    hour: `${hour.toString().padStart(2, "0")}:00`,
    bookings: 0,
    revenue: 0,
  }));
}

function mapBooking(row: BookingRow): AnalyticsBooking {
  const service = relationOne(row.services);
  const client = relationOne(row.clients);
  const staff = relationOne(row.staff_members);
  const status = effectiveStatus(row.status, row.end_time);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: client?.name || "Walk-in client",
    serviceId: row.service_id,
    serviceName: service?.name || "Service",
    serviceDuration: Number(service?.duration ?? 60),
    staffId: row.staff_id,
    staffName: staff?.name || "Unassigned",
    startTime: row.start_time,
    endTime: row.end_time,
    status,
    originalStatus: row.status,
    totalAmount: money(row.total_amount),
    createdAt: row.created_at,
  };
}

async function maybeQuery<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as T[];
}

async function fetchAnalyticsSource() {
  const businessId = await ensureBusiness();
  const [
    bookings,
    clients,
    staff,
    services,
    campaigns,
    recipients,
    engagement,
    botSettings,
    botFaqs,
    drafts,
    operatingHours,
  ] = await Promise.all([
    maybeQuery<BookingRow>(
      supabase
        .from("bookings")
        .select(
          "id, client_id, service_id, staff_id, start_time, end_time, status, total_amount, created_at, clients(name), services(name, duration), staff_members(name)",
        )
        .eq("business_id", businessId)
        .order("start_time", { ascending: true }),
    ),
    maybeQuery<ClientRow>(
      supabase
        .from("clients")
        .select("id, name, phone, email, client_type, created_at")
        .eq("business_id", businessId),
    ),
    maybeQuery<StaffRow>(
      supabase
        .from("staff_members")
        .select("id, name, is_active, working_days")
        .eq("business_id", businessId),
    ),
    maybeQuery<ServiceRow>(
      supabase
        .from("services")
        .select("id, name, price, duration, is_active")
        .eq("business_id", businessId),
    ),
    maybeQuery<CampaignRow>(
      supabase
        .from("marketing_campaigns")
        .select("id, name, channel, recipient_count, status, sent, opened, conversions, revenue, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
    ),
    maybeQuery<CampaignRecipientRow>(
      supabase
        .from("marketing_campaign_recipients")
        .select("campaign_id, status, sent_at, created_at")
        .eq("business_id", businessId),
    ),
    maybeQuery<EngagementRow>(
      supabase
        .from("message_engagement")
        .select(
          "campaign_id, sent_at, opened_at, responded_at, converted, conversion_value",
        )
        .eq("business_id", businessId),
    ),
    maybeQuery<BotSettingsRow>(
      supabase
        .from("whatsapp_bot_settings")
        .select("bot_enabled, review_mode")
        .eq("business_id", businessId)
        .limit(1),
    ),
    maybeQuery<BotFaqRow>(
      supabase
        .from("whatsapp_bot_faqs")
        .select("id, is_active")
        .eq("business_id", businessId),
    ),
    maybeQuery<BotDraftRow>(
      supabase
        .from("whatsapp_ai_drafts")
        .select("id, status, client_phone, created_at, decision_json")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
    ),
    maybeQuery<OperatingHourRow>(
      supabase
        .from("business_operating_hours")
        .select("day_name, is_open, open_time, close_time")
        .eq("business_id", businessId),
    ),
  ]);

  let inboundMessages: InboundMessageRow[] = [];
  const tenantResult = await supabase.rpc("ensure_my_tenant");
  if (!tenantResult.error && tenantResult.data) {
    inboundMessages = await maybeQuery<InboundMessageRow>(
      supabase
        .from("inbound_messages")
        .select("created_at")
        .eq("tenant_id", tenantResult.data as string),
    );
  }

  return {
    bookings: bookings.map(mapBooking),
    clients,
    staff,
    services,
    campaigns,
    recipients,
    engagement,
    inboundMessages,
    botSettings: botSettings[0] ?? null,
    botFaqs,
    drafts,
    operatingHours,
  };
}

function clientHasPriorBooking(
  bookings: AnalyticsBooking[],
  clientId: string | null,
  before: Date,
): boolean {
  if (!clientId) return false;
  return bookings.some(
    (booking) =>
      booking.clientId === clientId &&
      isActiveBooking(booking) &&
      new Date(booking.startTime) < before,
  );
}

function buildClientRows(
  clients: ClientRow[],
  bookings: AnalyticsBooking[],
  futureBookings: AnalyticsBooking[],
): ClientAnalyticsRow[] {
  return clients.map((client) => {
    const clientBookings = bookings.filter((booking) => booking.clientId === client.id);
    const completed = clientBookings.filter(isCompletedBooking);
    const lastVisit = [...clientBookings]
      .filter(isActiveBooking)
      .sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      )[0]?.startTime;

    return {
      id: client.id,
      name: client.name || "Unnamed client",
      bookings: clientBookings.filter(isActiveBooking).length,
      revenue: completed.reduce((sum, booking) => sum + booking.totalAmount, 0),
      lastVisit: lastVisit ? format(new Date(lastVisit), "dd MMM yyyy") : "No visit",
      lastVisitTime: lastVisit ? new Date(lastVisit).getTime() : null,
      futureBookings: futureBookings.filter(
        (booking) => booking.clientId === client.id,
      ).length,
    };
  });
}

function buildClientValueDistribution(clientRows: ClientAnalyticsRow[]): ClientValueDistributionPoint[] {
  const bands = [
    { band: "Under R500", min: 0, max: 500 },
    { band: "R500-R999", min: 500, max: 1000 },
    { band: "R1,000-R1,499", min: 1000, max: 1500 },
    { band: "R1,500-R2,499", min: 1500, max: 2500 },
    { band: "R2,500+", min: 2500, max: Infinity },
  ];

  return bands.map(({ band, min, max }) => {
    const clientsInBand = clientRows.filter((client) => client.revenue >= min && client.revenue < max);
    const totalBookings = clientsInBand.reduce((sum, client) => sum + client.bookings, 0);

    return {
      band,
      clientCount: clientsInBand.length,
      averageBookings: clientsInBand.length ? roundOne(totalBookings / clientsInBand.length) : 0,
    };
  });
}

function timeToHours(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours + minutes / 60;
}

function businessOpenHoursForPeriod(
  operatingHours: OperatingHourRow[],
  start: Date,
  end: Date,
): number {
  const fallbackHours = [
    { day_name: "monday", is_open: true, open_time: "08:00", close_time: "18:00" },
    { day_name: "tuesday", is_open: true, open_time: "08:00", close_time: "18:00" },
    { day_name: "wednesday", is_open: true, open_time: "08:00", close_time: "18:00" },
    { day_name: "thursday", is_open: true, open_time: "08:00", close_time: "18:00" },
    { day_name: "friday", is_open: true, open_time: "08:00", close_time: "18:00" },
  ];
  const hours = operatingHours.length ? operatingHours : fallbackHours;
  const byDay = new Map(
    hours
      .filter((hour) => hour.is_open)
      .map((hour) => [String(hour.day_name ?? "").toLowerCase(), hour]),
  );
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  let total = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    const hour = byDay.get(names[cursor.getDay()]);
    if (hour) {
      const open = timeToHours(hour.open_time);
      const close = timeToHours(hour.close_time);
      if (open !== null && close !== null && close > open) {
        total += close - open;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return roundOne(total);
}

function buildOverview(
  period: AnalyticsPeriod,
  allBookings: AnalyticsBooking[],
  operatingHours: OperatingHourRow[],
): AnalyticsOverview {
  const now = new Date();
  const start = periodStart(period);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const previousStart = previousPeriodStart(period, start);

  const periodBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, start, end),
  );
  const previousBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, previousStart, new Date(start.getTime() - 1)),
  );
  const activeBookings = periodBookings.filter(isActiveBooking);
  const completedBookings = periodBookings.filter(isCompletedBooking);
  const previousActiveBookings = previousBookings.filter(isActiveBooking);
  const previousCompletedBookings = previousBookings.filter(isCompletedBooking);
  const finishedEligible = periodBookings.filter(
    (booking) => new Date(booking.endTime) <= now && booking.status !== "cancelled",
  );
  const noShows = periodBookings.filter((booking) => booking.status === "no_show");
  const cancelled = periodBookings.filter((booking) => booking.status === "cancelled");
  const futureBooked = allBookings.filter(
    (booking) =>
      new Date(booking.startTime) > now &&
      (booking.originalStatus === "confirmed" || booking.originalStatus === "pending"),
  );
  const revenue = completedBookings.reduce(
    (sum, booking) => sum + booking.totalAmount,
    0,
  );
  const previousRevenue = previousCompletedBookings.reduce(
    (sum, booking) => sum + booking.totalAmount,
    0,
  );
  const revenueAtRisk = [...noShows, ...cancelled].reduce(
    (sum, booking) => sum + booking.totalAmount,
    0,
  );
  const periodClientIds = new Set(
    activeBookings.map((booking) => booking.clientId).filter(Boolean),
  );
  const returningClients = Array.from(periodClientIds).filter((clientId) =>
    clientHasPriorBooking(allBookings, clientId, start),
  ).length;
  const newClients = periodClientIds.size - returningClients;
  const workingDays =
    operatingHours.length > 0
      ? operatingHours
          .filter((hour) => hour.is_open)
          .map((hour) => String(hour.day_name ?? "").toLowerCase())
          .filter(Boolean)
      : ["monday", "tuesday", "wednesday", "thursday", "friday"];

  const revenueData = buildDateBuckets(start, end);
  const dateIndex = new Map(revenueData.map((bucket, index) => [bucket.date, index]));
  activeBookings.forEach((booking) => {
    const key = format(new Date(booking.startTime), "MMM d");
    const index = dateIndex.get(key);
    if (index === undefined) return;
    revenueData[index].bookings += 1;
    if (booking.status === "completed") {
      revenueData[index].revenue += booking.totalAmount;
    }
  });

  const weekdayBreakdown = buildWeekdayBuckets();
  const hourlyDemand = buildHourlyBuckets();
  activeBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const weekday = format(date, "EEEE");
    const weekdayRow = weekdayBreakdown.find((row) => row.day === weekday);
    if (weekdayRow) {
      weekdayRow.bookings += 1;
      if (booking.status === "completed") weekdayRow.revenue += booking.totalAmount;
    }
    const hourly = hourlyDemand[date.getHours()];
    hourly.bookings += 1;
    if (booking.status === "completed") hourly.revenue += booking.totalAmount;
  });

  const services = new Map<string, ServiceBreakdownPoint>();
  completedBookings.forEach((booking) => {
    const key = booking.serviceId || booking.serviceName;
    const row =
      services.get(key) ??
      {
        id: booking.serviceId ?? undefined,
        name: booking.serviceName,
        bookingCount: 0,
        revenue: 0,
        percentageOfTotal: 0,
      };
    row.bookingCount += 1;
    row.revenue += booking.totalAmount;
    services.set(key, row);
  });
  const serviceBreakdown = Array.from(services.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((row) => ({ ...row, percentageOfTotal: pct(row.revenue, revenue) }));

  const statusMap = new Map<BookingStatus, StatusBreakdownPoint>();
  periodBookings.forEach((booking) => {
    const row =
      statusMap.get(booking.status) ??
      { status: booking.status, count: 0, revenue: 0, percentageOfTotal: 0 };
    row.count += 1;
    row.revenue += booking.totalAmount;
    statusMap.set(booking.status, row);
  });
  const statusBreakdown = Array.from(statusMap.values()).map((row) => ({
    ...row,
    percentageOfTotal: pct(row.count, periodBookings.length),
  }));

  const topService = serviceBreakdown[0];
  const bestRevenueDay =
    [...revenueData].sort((a, b) => b.revenue - a.revenue)[0]?.date ?? "None yet";
  const quietestDay =
    [...revenueData].sort((a, b) => a.bookings - b.bookings)[0]?.date ??
    "None yet";
  const peak = [...hourlyDemand].sort((a, b) => b.bookings - a.bookings)[0];
  const revenueChangePct = changePct(revenue, previousRevenue);
  const bookingsChangePct = changePct(activeBookings.length, previousActiveBookings.length);

  return {
    totalRevenue: revenue,
    totalBookings: activeBookings.length,
    completedBookings: completedBookings.length,
    averageBookingValue: completedBookings.length ? revenue / completedBookings.length : 0,
    completionRate: pct(completedBookings.length, finishedEligible.length),
    retentionRate: pct(returningClients, periodClientIds.size),
    noShowRate: pct(noShows.length, finishedEligible.length),
    noShowCount: noShows.length,
    cancelledCount: cancelled.length,
    cancellationRate: pct(cancelled.length, periodBookings.length),
    previousRevenue,
    previousBookings: previousActiveBookings.length,
    revenueChangePct,
    bookingsChangePct,
    futureBookedRevenue: futureBooked.reduce((sum, booking) => sum + booking.totalAmount, 0),
    futureBookedBookings: futureBooked.length,
    projectedRevenue: revenue,
    projectedBookings: activeBookings.length,
    revenueAtRisk,
    bestRevenueDay,
    quietestDay,
    topServiceName: topService?.name ?? "No service yet",
    topServiceShare: topService?.percentageOfTotal ?? 0,
    peakHour: peak?.hour ?? "00:00",
    peakHourBookings: peak?.bookings ?? 0,
    returningClients,
    newClients,
    performanceSignal:
      revenueChangePct > 5 || bookingsChangePct > 5
        ? "improving"
        : revenueChangePct < -5 || bookingsChangePct < -5
          ? "declining"
          : "steady",
    revenueData,
    bookingDensityData: buildBookingDensityData(allBookings),
    workingDays,
    serviceBreakdown,
    weekdayBreakdown,
    statusBreakdown,
    hourlyDemand,
  };
}

function buildClients(
  start: Date,
  end: Date,
  clients: ClientRow[],
  allBookings: AnalyticsBooking[],
): AnalyticsClients {
  const periodBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, start, end),
  );
  const activePeriod = periodBookings.filter(isActiveBooking);
  const completedPeriod = periodBookings.filter(isCompletedBooking);
  const futureBookings = allBookings.filter(
    (booking) =>
      new Date(booking.startTime) > new Date() &&
      (booking.originalStatus === "confirmed" || booking.originalStatus === "pending"),
  );
  const clientIds = new Set(
    activePeriod
      .map((booking) => booking.clientId)
      .filter((clientId): clientId is string => Boolean(clientId)),
  );
  const clientTypeById = new Map(
    clients.map((client) => [client.id, client.client_type ?? "new"]),
  );
  const segmentCounts = Array.from(clientIds).reduce(
    (counts, clientId) => {
      const segment = clientTypeById.get(clientId) ?? "new";
      if (segment === "vip") counts.vip += 1;
      else if (segment === "returning") counts.returning += 1;
      else counts.new += 1;
      return counts;
    },
    { new: 0, returning: 0, vip: 0 },
  );
  const newClients = segmentCounts.new;
  const returningClients = segmentCounts.returning;
  const vipClients = segmentCounts.vip;
  const clientsWithCompleted = new Set(
    completedPeriod.map((booking) => booking.clientId).filter(Boolean),
  );
  const clientsWithFuture = new Set(
    futureBookings.map((booking) => booking.clientId).filter(Boolean),
  );
  const rebooked = Array.from(clientsWithCompleted).filter((clientId) =>
    clientsWithFuture.has(clientId),
  ).length;
  const revenue = completedPeriod.reduce((sum, booking) => sum + booking.totalAmount, 0);
  const clientRows = buildClientRows(clients, allBookings, futureBookings);
  const inactiveCutoff = new Date();
  inactiveCutoff.setDate(inactiveCutoff.getDate() - 60);
  const inactiveClientRows = clientRows
    .filter((row) => {
      const activeFuture = row.futureBookings > 0;
      if (activeFuture || row.lastVisit === "No visit") return false;
      return row.lastVisitTime !== null && row.lastVisitTime < inactiveCutoff.getTime();
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const noFutureBookingRows = clientRows
    .filter((row) => row.bookings > 0 && row.futureBookings === 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const topClients = clientRows
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const clientTypeData = [
    { name: "New", clients: newClients },
    { name: "Returning", clients: returningClients },
    { name: "VIP", clients: vipClients },
  ];

  return {
    summary: [
      { label: "New clients", value: newClients, format: "number", detail: "Active clients labelled new" },
      { label: "Returning clients", value: returningClients, format: "number", detail: "Active clients labelled returning" },
      { label: "VIP clients", value: vipClients, format: "number", detail: "Active clients labelled VIP" },
      { label: "Returning/VIP share", value: pct(returningClients + vipClients, clientIds.size), format: "percent", detail: "Returning and VIP clients / active clients" },
      { label: "Average client value", value: clientIds.size ? revenue / clientIds.size : 0, format: "currency" },
      { label: "Visit frequency", value: clientIds.size ? roundOne(activePeriod.length / clientIds.size) : 0, detail: "Bookings per active client", format: "number" },
    ],
    newClients,
    returningClients,
    retentionRate: pct(returningClients + vipClients, clientIds.size),
    rebookingRate: pct(rebooked, clientsWithCompleted.size),
    averageClientValue: clientIds.size ? revenue / clientIds.size : 0,
    visitFrequency: clientIds.size ? roundOne(activePeriod.length / clientIds.size) : 0,
    inactiveClients: inactiveClientRows.length,
    clientsWithoutFutureBooking: noFutureBookingRows.length,
    newReturningData: [
      { name: "New", clients: newClients },
      { name: "Returning", clients: returningClients },
      { name: "VIP", clients: vipClients },
    ],
    clientTypeData,
    clientValueDistribution: buildClientValueDistribution(
      clientRows.filter((row) => clientIds.has(row.id)),
    ),
    topClients,
    inactiveClientRows,
    noFutureBookingRows,
  };
}

function buildStaff(
  start: Date,
  end: Date,
  staff: StaffRow[],
  allBookings: AnalyticsBooking[],
  operatingHours: OperatingHourRow[],
): AnalyticsStaff {
  const periodBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, start, end),
  );
  const businessOpenHours = businessOpenHoursForPeriod(operatingHours, start, end);
  const rows: StaffAnalyticsRow[] = [
    ...staff.map((member) => ({
      id: member.id,
      name: member.name || "Staff member",
      isActive: member.is_active !== false,
    })),
    { id: null, name: "Unassigned", isActive: false },
  ]
    .map((member) => {
      const bookings = periodBookings.filter((booking) => booking.staffId === member.id);
      const active = bookings.filter(isActiveBooking);
      const completed = bookings.filter(isCompletedBooking);
      if (!active.length && member.id === null) return null;
      const revenue = completed.reduce((sum, booking) => sum + booking.totalAmount, 0);
      const bookedHours = active.reduce((sum, booking) => sum + bookingHours(booking), 0);
      const completedHours = completed.reduce((sum, booking) => sum + bookingHours(booking), 0);
      const availableHours = member.id && member.isActive ? businessOpenHours : 0;
      const returned = new Set(
        active
          .filter((booking) => clientHasPriorBooking(allBookings, booking.clientId, start))
          .map((booking) => booking.clientId),
      ).size;
      const uniqueClients = new Set(active.map((booking) => booking.clientId).filter(Boolean)).size;
      return {
        id: member.id,
        name: member.name,
        revenue,
        completedBookings: completed.length,
        averageBookingValue: completed.length ? revenue / completed.length : 0,
        bookedHours: roundOne(bookedHours),
        availableHours,
        utilisationRate: availableHours ? pct(bookedHours, availableHours) : 0,
        cancellationRate: pct(bookings.filter((booking) => booking.status === "cancelled").length, bookings.length),
        noShowRate: pct(bookings.filter((booking) => booking.status === "no_show").length, bookings.length),
        retentionRate: pct(returned, uniqueClients),
        revenuePerBookedHour: completedHours ? revenue / completedHours : 0,
      };
    })
    .filter(Boolean) as StaffAnalyticsRow[];
  rows.sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const totalBookings = rows.reduce((sum, row) => sum + row.completedBookings, 0);
  const assignedRows = rows.filter((row) => row.id);
  const totalBookedHours = assignedRows.reduce((sum, row) => sum + row.bookedHours, 0);
  const totalAvailableHours = assignedRows.reduce((sum, row) => sum + row.availableHours, 0);

  return {
    summary: [
      { label: "Staff revenue", value: totalRevenue, format: "currency" },
      { label: "Completed bookings", value: totalBookings, format: "number" },
      { label: "Utilisation", value: pct(totalBookedHours, totalAvailableHours), format: "percent", detail: "Booked hours / business-hour capacity" },
      { label: "Revenue per booked hour", value: totalBookedHours ? totalRevenue / totalBookedHours : 0, format: "currency" },
    ],
    rows,
    revenueData: rows.slice(0, 8).map((row) => ({
      name: row.name,
      revenue: row.revenue,
      bookings: row.completedBookings,
    })),
    utilisationData: rows.slice(0, 8).map((row) => ({
      name: row.name,
      utilisation: row.utilisationRate,
    })),
    claims: ["Team capacity uses business operating hours multiplied by active staff. Staff-specific availability is not tracked yet."],
  };
}

function buildServices(
  start: Date,
  end: Date,
  services: ServiceRow[],
  allBookings: AnalyticsBooking[],
): AnalyticsServices {
  const periodBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, start, end),
  );
  const completedPeriodBookings = periodBookings.filter(isCompletedBooking);
  const completedRevenue = completedPeriodBookings.reduce(
    (sum, booking) => sum + booking.totalAmount,
    0,
  );
  const rows: ServiceAnalyticsRow[] = [
    ...services.map((service) => ({ id: service.id, name: service.name || "Service" })),
    { id: null, name: "Unassigned service" },
  ]
    .map((service) => {
      const bookings = periodBookings.filter((booking) => booking.serviceId === service.id);
      const active = bookings.filter(isActiveBooking);
      const completed = bookings.filter(isCompletedBooking);
      if (!bookings.length && service.id === null) return null;
      const revenue = completed.reduce((sum, booking) => sum + booking.totalAmount, 0);
      const hours = completed.reduce((sum, booking) => sum + bookingHours(booking), 0);
      const returned = new Set(
        active
          .filter((booking) => clientHasPriorBooking(allBookings, booking.clientId, start))
          .map((booking) => booking.clientId),
      ).size;
      const uniqueClients = new Set(active.map((booking) => booking.clientId).filter(Boolean)).size;
      return {
        id: service.id,
        name: service.name,
        revenue,
        bookings: active.length,
        completedBookings: completed.length,
        revenueShare: pct(revenue, completedRevenue),
        averageSellingValue: completed.length ? revenue / completed.length : 0,
        completionRate: pct(completed.length, active.length),
        cancellationRate: pct(bookings.filter((booking) => booking.status === "cancelled").length, bookings.length),
        returningClientRate: pct(returned, uniqueClients),
        bookedHours: roundOne(hours),
        revenuePerBookedHour: hours ? revenue / hours : 0,
      };
    })
    .filter(Boolean) as ServiceAnalyticsRow[];
  rows.sort((a, b) => b.revenue - a.revenue);

  return {
    summary: [
      { label: "Service revenue", value: completedRevenue, format: "currency" },
      { label: "Bookings", value: rows.reduce((sum, row) => sum + row.bookings, 0), format: "number" },
      { label: "Top service share", value: rows[0]?.revenueShare ?? 0, format: "percent" },
      { label: "Avg selling value", value: completedPeriodBookings.length ? completedRevenue / completedPeriodBookings.length : 0, format: "currency" },
    ],
    rows,
    revenueData: rows.slice(0, 8).map((row) => ({
      name: row.name,
      revenue: row.revenue,
      bookings: row.bookings,
    })),
    shareData: rows
      .filter((row) => row.revenue > 0)
      .slice(0, 8)
      .map((row) => ({ name: row.name, value: row.revenue })),
  };
}

function buildBookings(
  start: Date,
  end: Date,
  allBookings: AnalyticsBooking[],
  overview: AnalyticsOverview,
): AnalyticsBookings {
  const periodBookings = allBookings.filter((booking) =>
    inRange(booking.startTime, start, end),
  );
  const completed = periodBookings.filter(isCompletedBooking);
  const noShows = periodBookings.filter((booking) => booking.status === "no_show");
  const cancelled = periodBookings.filter((booking) => booking.status === "cancelled");
  const pending = periodBookings.filter((booking) => booking.status === "pending");
  const finishedEligible = periodBookings.filter(
    (booking) => new Date(booking.endTime) <= new Date() && booking.status !== "cancelled",
  );
  const leadTimes = periodBookings
    .map((booking) => {
      const created = new Date(booking.createdAt).getTime();
      const starts = new Date(booking.startTime).getTime();
      return starts > created ? (starts - created) / 864e5 : 0;
    })
    .filter(Number.isFinite);
  const lostBookedValue = [...noShows, ...cancelled].reduce(
    (sum, booking) => sum + booking.totalAmount,
    0,
  );
  const bookingTrendData = buildDateBuckets(start, end);
  const bookingTrendIndex = new Map(bookingTrendData.map((bucket, index) => [bucket.date, index]));
  periodBookings.forEach((booking) => {
    const key = format(new Date(booking.startTime), "MMM d");
    const index = bookingTrendIndex.get(key);
    if (index === undefined) return;
    bookingTrendData[index].bookings += 1;
    bookingTrendData[index].revenue += booking.totalAmount;
  });
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const heatmap = days.flatMap((day) =>
    Array.from({ length: 24 }).map((_, hour) => ({
      day,
      hour: `${hour.toString().padStart(2, "0")}:00`,
      bookingCount: 0,
      bookedValue: 0,
      noShowRate: 0,
    })),
  );
  const heatmapIndex = new Map(heatmap.map((point, index) => [`${point.day}-${point.hour}`, index]));
  periodBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const key = `${format(date, "EEEE")}-${date.getHours().toString().padStart(2, "0")}:00`;
    const index = heatmapIndex.get(key);
    if (index === undefined) return;
    const point = heatmap[index];
    point.bookingCount += 1;
    point.bookedValue += booking.totalAmount;
  });
  heatmap.forEach((point) => {
    if (!point.bookingCount) return;
    const noShowCount = periodBookings.filter((booking) => {
      const date = new Date(booking.startTime);
      return (
        booking.status === "no_show" &&
        format(date, "EEEE") === point.day &&
        `${date.getHours().toString().padStart(2, "0")}:00` === point.hour
      );
    }).length;
    point.noShowRate = pct(noShowCount, point.bookingCount);
  });

  const leadTimeDistribution = [
    { name: "Same day", bookings: leadTimes.filter((value) => value < 1).length },
    { name: "1-2 days", bookings: leadTimes.filter((value) => value >= 1 && value <= 2).length },
    { name: "3-7 days", bookings: leadTimes.filter((value) => value > 2 && value <= 7).length },
    { name: "8-14 days", bookings: leadTimes.filter((value) => value > 7 && value <= 14).length },
    { name: "14+ days", bookings: leadTimes.filter((value) => value > 14).length },
  ];

  const pipelineMap = new Map<string, { week: string; completed: number; confirmed: number; pending: number }>();
  periodBookings.forEach((booking) => {
    const date = new Date(booking.startTime);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const week = format(weekStart, "d MMM");
    const row = pipelineMap.get(week) ?? { week, completed: 0, confirmed: 0, pending: 0 };
    if (booking.status === "completed") row.completed += 1;
    if (booking.status === "confirmed" && new Date(booking.startTime) > new Date()) row.confirmed += 1;
    if (booking.status === "pending") row.pending += 1;
    pipelineMap.set(week, row);
  });

  const outcomes: Array<{ outcome: string; status: BookingStatus; bookings: AnalyticsBooking[] }> = [
    { outcome: "Completed", status: "completed", bookings: completed },
    { outcome: "No-show", status: "no_show", bookings: noShows },
    { outcome: "Cancelled", status: "cancelled", bookings: cancelled },
    { outcome: "Pending", status: "pending", bookings: pending },
  ];
  const outcomeRows = outcomes.map((row) => {
    const bookedValue = row.bookings.reduce((sum, booking) => sum + booking.totalAmount, 0);
    return {
      outcome: row.outcome,
      status: row.status,
      bookings: row.bookings.length,
      share: pct(row.bookings.length, periodBookings.length),
      bookedValue,
      averageValue: row.bookings.length ? bookedValue / row.bookings.length : 0,
    };
  });

  const weekdayRows = days
    .map((day) => {
      const bookings = periodBookings.filter((booking) => format(new Date(booking.startTime), "EEEE") === day);
      const weekdayCompleted = bookings.filter(isCompletedBooking).length;
      const weekdayNoShows = bookings.filter((booking) => booking.status === "no_show").length;
      return {
        period: day,
        bookings: bookings.length,
        completionRate: pct(weekdayCompleted, bookings.length),
        noShowRate: pct(weekdayNoShows, bookings.length),
      };
    })
    .filter((row) => row.bookings > 0);
  const maxWeekdayBookings = Math.max(1, ...weekdayRows.map((row) => row.bookings));
  const averageNoShowRate = pct(noShows.length, periodBookings.length);
  const pressurePoints = weekdayRows.map((row) => {
    let signal = "Consistent completion";
    if (row.bookings === maxWeekdayBookings && row.bookings > 1) signal = "Strong demand";
    else if (row.bookings <= Math.max(1, Math.floor(maxWeekdayBookings * 0.35))) signal = "Quiet period";
    if (row.noShowRate > Math.max(averageNoShowRate, 0) && row.noShowRate >= 10) signal = "High no-show risk";
    if (row.completionRate >= 80 && row.bookings > 1) signal = "Consistent completion";
    return { ...row, signal };
  });

  return {
    summary: [
      { label: "Total bookings", value: periodBookings.length, format: "number" },
      { label: "Completed bookings", value: completed.length, format: "number" },
      { label: "Completion rate", value: pct(completed.length, finishedEligible.length), format: "percent" },
      { label: "No-show rate", value: pct(noShows.length, finishedEligible.length), format: "percent" },
      { label: "Lost booked value", value: lostBookedValue, format: "currency" },
    ],
    journey: {
      scheduled: periodBookings.length,
      attended: completed.length,
      completed: completed.length,
      noShow: noShows.length,
      cancelled: cancelled.length,
      pending: pending.length,
    },
    heatmap,
    bookingTrendData,
    leadTimeDistribution,
    pipelineByWeek: Array.from(pipelineMap.values()),
    outcomeRows,
    pressurePoints,
    claims: [
      "Past confirmed bookings are treated as completed once their end time has passed.",
      "Booking source, cancellation reasons, and reschedules need explicit tracking fields before they can be reported accurately.",
    ],
  };
}

function buildCampaigns(
  start: Date,
  end: Date,
  campaigns: CampaignRow[],
  recipients: CampaignRecipientRow[],
  engagement: EngagementRow[],
): AnalyticsCampaigns {
  const periodCampaigns = campaigns.filter((campaign) =>
    inRange(campaign.created_at, start, end),
  );
  const periodRecipients = recipients.filter((recipient) =>
    inRange(recipient.sent_at || recipient.created_at, start, end),
  );
  const periodEngagement = engagement.filter((row) =>
    inRange(row.sent_at, start, end),
  );
  const trendData = buildDateBuckets(start, end);
  const trendIndex = new Map(trendData.map((bucket, index) => [bucket.date, index]));
  periodRecipients.forEach((recipient) => {
    const key = format(new Date(recipient.sent_at || recipient.created_at), "MMM d");
    const index = trendIndex.get(key);
    if (index === undefined) return;
    if (recipient.status === "sent") trendData[index].bookings += 1;
  });
  if (!periodRecipients.length) {
    periodCampaigns.forEach((campaign) => {
      const key = format(new Date(campaign.created_at), "MMM d");
      const index = trendIndex.get(key);
      if (index === undefined) return;
      trendData[index].bookings += Number(campaign.sent ?? 0);
    });
  }
  periodEngagement.forEach((row) => {
    if (!row.responded_at) return;
    const key = format(new Date(row.responded_at), "MMM d");
    const index = trendIndex.get(key);
    if (index === undefined) return;
    trendData[index].revenue += 1;
  });
  const audience = periodCampaigns.reduce((sum, row) => sum + Number(row.recipient_count ?? 0), 0) ||
    periodRecipients.length;
  const sent = periodRecipients.filter((row) => row.status === "sent").length ||
    periodCampaigns.reduce((sum, row) => sum + Number(row.sent ?? 0), 0);
  const failed = periodRecipients.filter((row) => row.status === "failed").length;
  const replies = periodEngagement.filter((row) => row.responded_at).length;
  const conversions = periodEngagement.filter((row) => row.converted).length;
  const attributedRevenue = periodEngagement.reduce(
    (sum, row) => sum + money(row.conversion_value),
    0,
  );
  const engagementByCampaign = new Map<string, EngagementRow[]>();
  periodEngagement.forEach((row) => {
    if (!row.campaign_id) return;
    const list = engagementByCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    engagementByCampaign.set(row.campaign_id, list);
  });
  const campaignRows: CampaignAnalyticsRow[] = periodCampaigns.slice(0, 10).map((campaign) => {
    const campaignRecipients = periodRecipients.filter(
      (recipient) => recipient.campaign_id === campaign.id,
    );
    const campaignEngagement = engagementByCampaign.get(campaign.id) ?? [];
    const campaignSent =
      campaignRecipients.filter((recipient) => recipient.status === "sent").length ||
      Number(campaign.sent ?? 0);
    const campaignFailed = campaignRecipients.filter(
      (recipient) => recipient.status === "failed",
    ).length;
    const campaignAudience = Number(campaign.recipient_count ?? 0) || campaignRecipients.length;
    const campaignReplies = campaignEngagement.filter((row) => row.responded_at).length;
    const campaignConversions = campaignEngagement.filter((row) => row.converted).length ||
      Number(campaign.conversions ?? 0);
    const campaignRevenue = campaignEngagement.some((row) => row.converted)
      ? campaignEngagement.reduce((sum, row) => sum + money(row.conversion_value), 0)
      : money(campaign.revenue);

    return {
      id: campaign.id,
      name: campaign.name || "Campaign",
      channel: campaign.channel || "Unknown",
      status: campaign.status || "draft",
      audience: campaignAudience,
      sent: campaignSent,
      failed: campaignFailed,
      replies: campaignReplies,
      deliveryRate: pct(campaignSent, campaignSent + campaignFailed),
      replyRate: pct(campaignReplies, campaignSent),
      bookingsGenerated: campaignConversions || null,
      revenueAttributed: campaignRevenue || null,
      cost: null,
      roi: null,
    };
  });
  const channelRows: CampaignChannelRow[] = Array.from(
    new Set(campaignRows.map((row) => row.channel)),
  ).map((channel) => {
    const rows = campaignRows.filter((row) => row.channel === channel);
    const channelSent = rows.reduce((sum, row) => sum + row.sent, 0);
    const channelReplies = rows.reduce((sum, row) => sum + row.replies, 0);
    const channelBookings = rows.reduce((sum, row) => sum + (row.bookingsGenerated ?? 0), 0);
    const channelRevenue = rows.reduce((sum, row) => sum + (row.revenueAttributed ?? 0), 0);
    return {
      channel,
      sent: channelSent,
      delivered: null,
      replies: channelReplies,
      bookings: channelBookings || null,
      revenue: channelRevenue || null,
      cost: null,
      roi: null,
    };
  });
  const funnelBase = audience || sent;
  const funnel: CampaignFunnelStage[] = [
    { name: "Recipients", value: audience, previousRate: 100, overallRate: 100 },
    { name: "Sent", value: sent, previousRate: pct(sent, audience), overallRate: pct(sent, funnelBase) },
    { name: "Delivered", value: sent, previousRate: pct(sent, sent + failed), overallRate: pct(sent, funnelBase), unavailable: true },
    { name: "Replied", value: replies, previousRate: pct(replies, sent), overallRate: pct(replies, funnelBase) },
    { name: "Booked", value: conversions, previousRate: pct(conversions, replies || sent), overallRate: pct(conversions, funnelBase) },
    { name: "Attributed revenue", value: attributedRevenue, previousRate: conversions ? 100 : 0, overallRate: funnelBase ? pct(conversions, funnelBase) : 0, format: "currency" },
  ];

  return {
    summary: [
      { label: "Campaigns sent", value: periodCampaigns.filter((row) => Number(row.sent ?? 0) > 0 || row.status === "completed").length, format: "number" },
      { label: "Messages sent", value: sent, format: "number" },
      { label: "Delivery rate", value: pct(sent, sent + failed), format: "percent", detail: "Sent vs failed, not carrier delivered" },
      { label: "Reply rate", value: pct(replies, sent), format: "percent" },
      { label: "Bookings generated", value: conversions, format: "number", detail: "Only explicit conversion tracking" },
      { label: "Revenue attributed", value: attributedRevenue, format: "currency", detail: "Only explicit conversion value" },
      { label: "Cost per booking", value: "Needs cost tracking", format: "text", unavailable: true },
      { label: "Campaign ROI", value: "Needs cost tracking", format: "text", unavailable: true },
    ],
    rows: campaignRows,
    funnel,
    channelRows,
    trendData,
    statusData: ["draft", "active", "completed", "halted_no_credits"].map((status) => ({
      name: status.replaceAll("_", " "),
      count: periodCampaigns.filter((campaign) => campaign.status === status).length,
    })),
    engagementData: [
      { name: "Sent", value: sent },
      { name: "Replied", value: replies },
      { name: "Converted", value: conversions },
    ],
    claims: [
      "Delivery rate means rows marked sent versus failed. Carrier-level delivered receipts are not tracked yet.",
      "Bookings generated and revenue attributed only use explicit campaign conversion tracking. Inferred attribution from later bookings is not enabled yet.",
      "Campaign cost, cost per booking and ROI need spend tracking before they can be reported accurately.",
    ],
  };
}

function buildChatbot(
  start: Date,
  end: Date,
  inboundMessages: InboundMessageRow[],
  drafts: BotDraftRow[],
  botSettings: BotSettingsRow | null,
  botFaqs: BotFaqRow[],
): AnalyticsChatbot {
  const periodMessages = inboundMessages.filter((message) =>
    inRange(message.created_at, start, end),
  );
  const periodDrafts = drafts.filter((draft) => inRange(draft.created_at, start, end));
  const sentDrafts = periodDrafts.filter((draft) => draft.status === "sent");
  const humanDrafts = periodDrafts.filter((draft) => draft.decision_json?.needs_human === true);
  const messageData = buildDateBuckets(start, end);
  const dateIndex = new Map(messageData.map((bucket, index) => [bucket.date, index]));
  periodMessages.forEach((message) => {
    const key = format(new Date(message.created_at), "MMM d");
    const index = dateIndex.get(key);
    if (index !== undefined) messageData[index].bookings += 1;
  });
  periodDrafts.forEach((draft) => {
    const key = format(new Date(draft.created_at), "MMM d");
    const index = dateIndex.get(key);
    if (index !== undefined && draft.status === "sent") messageData[index].revenue += 1;
  });
  const statuses = Array.from(new Set(periodDrafts.map((draft) => draft.status || "unknown")));

  return {
    summary: [
      { label: "Inbound messages", value: periodMessages.length, format: "number" },
      { label: "AI replies sent", value: sentDrafts.length, format: "number" },
      { label: "Needs review", value: humanDrafts.length, format: "number" },
      { label: "Bot bookings", value: "Unavailable", format: "text", unavailable: true, detail: "Needs booking attribution from chat actions" },
    ],
    draftStatusData: statuses.map((status) => ({
      name: status,
      count: periodDrafts.filter((draft) => (draft.status || "unknown") === status).length,
    })),
    messageData,
    recentDrafts: periodDrafts.slice(0, 8).map((draft) => ({
      id: draft.id,
      status: draft.status || "unknown",
      clientPhone: draft.client_phone || "Unknown",
      createdAt: format(new Date(draft.created_at), "dd MMM yyyy HH:mm"),
      needsHuman: draft.decision_json?.needs_human === true,
    })),
    settings: {
      enabled: Boolean(botSettings?.bot_enabled),
      reviewMode: Boolean(botSettings?.review_mode),
      faqCount: botFaqs.filter((faq) => faq.is_active !== false).length,
    },
    claims: [
      "Chatbot bookings, revenue generated, and quiet slots filled need a tracked link from assistant action to booking record.",
    ],
  };
}

function buildInsights(report: Omit<AnalyticsReport, "insights">): AnalyticsInsight[] {
  const insights: AnalyticsInsight[] = [];
  const { overview, clients, bookings, campaigns, chatbot } = report;

  if (overview.performanceSignal === "improving") {
    insights.push({
      title: "Business is trending up",
      text: `Revenue is ${overview.revenueChangePct}% versus the previous matching period and bookings are ${overview.bookingsChangePct}%.`,
      action: "Protect the busiest hours and keep top services easy to book.",
      tone: "good",
    });
  } else if (overview.performanceSignal === "declining") {
    insights.push({
      title: "Performance needs attention",
      text: `Revenue is ${overview.revenueChangePct}% and bookings are ${overview.bookingsChangePct}% versus the previous matching period.`,
      action: "Check quiet hours, inactive clients, and campaign follow-ups.",
      tone: "warning",
    });
  }

  if (overview.revenueAtRisk > 0) {
    insights.push({
      title: "Lost booked value is visible",
      text: `Cancellations and no-shows represent R ${Math.round(overview.revenueAtRisk).toLocaleString()} in booked value for this period.`,
      action: "Use reminders, deposits, and rebooking prompts on high-risk services.",
      tone: "opportunity",
    });
  }

  if (clients.clientsWithoutFutureBooking > 0) {
    insights.push({
      title: "Clients need follow-up",
      text: `${clients.clientsWithoutFutureBooking} clients with prior bookings do not have a future booking.`,
      action: "Use the Clients tab to prioritise the highest-value follow-ups.",
      tone: "opportunity",
    });
  }

  if (campaigns.summary[0]?.value === 0 && chatbot.summary[0]?.value === 0) {
    insights.push({
      title: "Automation data is still quiet",
      text: "Campaign and chatbot activity is not yet producing measurable engagement in this period.",
      action: "Once messaging is active, those tabs will show reply and conversion patterns.",
      tone: "neutral",
    });
  }

  return insights.slice(0, 5);
}

export async function fetchAnalyticsReport(
  period: AnalyticsPeriod,
): Promise<AnalyticsReport> {
  const source = await fetchAnalyticsSource();
  const start = periodStart(period);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const overview = buildOverview(period, source.bookings, source.operatingHours);
  const reportWithoutInsights = {
    overview,
    clients: buildClients(start, end, source.clients, source.bookings),
    staff: buildStaff(start, end, source.staff, source.bookings, source.operatingHours),
    services: buildServices(start, end, source.services, source.bookings),
    bookings: buildBookings(start, end, source.bookings, overview),
    campaigns: buildCampaigns(
      start,
      end,
      source.campaigns,
      source.recipients,
      source.engagement,
    ),
    chatbot: buildChatbot(
      start,
      end,
      source.inboundMessages,
      source.drafts,
      source.botSettings,
      source.botFaqs,
    ),
  };

  return {
    ...reportWithoutInsights,
    insights: buildInsights(reportWithoutInsights),
  };
}

export async function fetchAnalyticsOverview(
  period: AnalyticsPeriod,
): Promise<AnalyticsOverview> {
  return (await fetchAnalyticsReport(period)).overview;
}

export async function fetchAnalyticsInsights(
  period: AnalyticsPeriod,
): Promise<AnalyticsInsight[]> {
  return (await fetchAnalyticsReport(period)).insights;
}

export function analyticsStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
