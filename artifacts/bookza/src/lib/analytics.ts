import { format } from "date-fns";
import type { BookingStatus } from "@/types/catalog";
import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y";

export type AnalyticsInsight = {
  text: string;
};

export type AnalyticsOverview = {
  totalRevenue: number;
  totalBookings: number;
  retentionRate: number;
  noShowRate: number;
  noShowCount: number;
  revenueData: Array<{
    date: string;
    revenue: number;
    bookings: number;
  }>;
  serviceBreakdown: Array<{
    name: string;
    bookingCount: number;
    revenue: number;
    percentageOfTotal: number;
  }>;
};

type ServiceRelation = { name: string } | { name: string }[] | null;

type BookingRow = {
  client_id: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  total_amount: number;
  services: ServiceRelation;
};

type AnalyticsBooking = {
  clientId: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
  totalAmount: number;
  serviceName: string;
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function effectiveStatus(status: BookingStatus, endTime: string): BookingStatus {
  return status === "confirmed" && new Date(endTime).getTime() < Date.now() ? "completed" : status;
}

function mapBooking(row: BookingRow): AnalyticsBooking {
  return {
    clientId: row.client_id,
    startTime: row.start_time,
    endTime: row.end_time,
    status: effectiveStatus(row.status, row.end_time),
    totalAmount: Number(row.total_amount),
    serviceName: relationOne(row.services)?.name ?? "Service",
  };
}

function periodStart(period: AnalyticsPeriod): Date {
  const now = new Date();
  const start = new Date(now);
  const days = period === "7d" ? 6 : period === "30d" ? 29 : period === "90d" ? 89 : 364;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days);
  return start;
}

function previousPeriodStart(period: AnalyticsPeriod, currentStart: Date): Date {
  const prev = new Date(currentStart);
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;
  prev.setDate(prev.getDate() - days);
  return prev;
}

function percentRate(part: number, total: number): number {
  if (total === 0) return 0;
  return roundOne((part / total) * 100);
}

function buildDateBuckets(from: Date, to: Date) {
  const buckets: Array<{ date: string; revenue: number; bookings: number }> = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    buckets.push({
      date: format(cursor, "MMM d"),
      revenue: 0,
      bookings: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

async function fetchAnalyticsBookings(): Promise<AnalyticsBooking[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("bookings")
    .select("client_id, start_time, end_time, status, total_amount, services(name)")
    .eq("business_id", businessId)
    .order("start_time", { ascending: true });

  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as BookingRow[]).map(mapBooking);
}

export async function fetchAnalyticsOverview(period: AnalyticsPeriod): Promise<AnalyticsOverview> {
  const allBookings = await fetchAnalyticsBookings();
  const now = new Date();
  const start = periodStart(period);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const periodBookings = allBookings.filter((booking) => {
    const startTime = new Date(booking.startTime);
    return startTime >= start && startTime <= end;
  });

  const finishedBookings = periodBookings.filter((booking) => new Date(booking.endTime) <= now);
  const billableBookings = periodBookings.filter((booking) => booking.status === "completed");
  const activeBookings = periodBookings.filter((booking) => booking.status !== "cancelled");
  const noShowCount = finishedBookings.filter((booking) => booking.status === "no_show").length;

  const revenueData = buildDateBuckets(start, end);
  const bucketIndex = new Map(revenueData.map((bucket, index) => [bucket.date, index]));

  for (const booking of activeBookings) {
    const key = format(new Date(booking.startTime), "MMM d");
    const index = bucketIndex.get(key);
    if (index === undefined) continue;
    revenueData[index].bookings += 1;
    if (booking.status === "completed") {
      revenueData[index].revenue += booking.totalAmount;
    }
  }

  const serviceMap = new Map<string, { name: string; bookingCount: number; revenue: number }>();
  for (const booking of billableBookings) {
    const current = serviceMap.get(booking.serviceName) ?? {
      name: booking.serviceName,
      bookingCount: 0,
      revenue: 0,
    };
    current.bookingCount += 1;
    current.revenue += booking.totalAmount;
    serviceMap.set(booking.serviceName, current);
  }

  const totalRevenue = billableBookings.reduce((sum, booking) => sum + booking.totalAmount, 0);
  const serviceBreakdown = Array.from(serviceMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((service) => ({
      ...service,
      percentageOfTotal: percentRate(service.revenue, totalRevenue),
    }));

  const lifetimeNonCancelled = new Map<string, number>();
  for (const booking of allBookings) {
    if (booking.status === "cancelled") continue;
    lifetimeNonCancelled.set(booking.clientId, (lifetimeNonCancelled.get(booking.clientId) ?? 0) + 1);
  }

  const activeClientIds = new Set(activeBookings.map((booking) => booking.clientId));
  const returningClients = Array.from(activeClientIds).filter((clientId) => (lifetimeNonCancelled.get(clientId) ?? 0) > 1).length;

  return {
    totalRevenue,
    totalBookings: activeBookings.length,
    retentionRate: percentRate(returningClients, activeClientIds.size),
    noShowRate: percentRate(noShowCount, finishedBookings.filter((booking) => booking.status !== "cancelled").length),
    noShowCount,
    revenueData,
    serviceBreakdown,
  };
}

export async function fetchAnalyticsInsights(period: AnalyticsPeriod): Promise<AnalyticsInsight[]> {
  const allBookings = await fetchAnalyticsBookings();
  const now = new Date();
  const start = periodStart(period);
  const previousStart = previousPeriodStart(period, start);

  const inCurrentPeriod = allBookings.filter((booking) => {
    const startTime = new Date(booking.startTime);
    return startTime >= start && startTime <= now;
  });

  const inPreviousPeriod = allBookings.filter((booking) => {
    const startTime = new Date(booking.startTime);
    return startTime >= previousStart && startTime < start;
  });

  const currentCompleted = inCurrentPeriod.filter((booking) => booking.status === "completed");
  const previousCompleted = inPreviousPeriod.filter((booking) => booking.status === "completed");
  const currentRevenue = currentCompleted.reduce((sum, booking) => sum + booking.totalAmount, 0);
  const previousRevenue = previousCompleted.reduce((sum, booking) => sum + booking.totalAmount, 0);

  const weekdayCounts = new Map<string, number>();
  for (const booking of inCurrentPeriod.filter((booking) => booking.status !== "cancelled")) {
    const day = format(new Date(booking.startTime), "EEEE");
    weekdayCounts.set(day, (weekdayCounts.get(day) ?? 0) + 1);
  }

  const busiestDay = Array.from(weekdayCounts.entries()).sort((a, b) => b[1] - a[1])[0];

  const serviceRevenue = new Map<string, { bookings: number; revenue: number }>();
  for (const booking of currentCompleted) {
    const current = serviceRevenue.get(booking.serviceName) ?? { bookings: 0, revenue: 0 };
    current.bookings += 1;
    current.revenue += booking.totalAmount;
    serviceRevenue.set(booking.serviceName, current);
  }
  const topService = Array.from(serviceRevenue.entries()).sort((a, b) => b[1].revenue - a[1].revenue)[0];

  const finishedCurrent = inCurrentPeriod.filter((booking) => new Date(booking.endTime) <= now && booking.status !== "cancelled");
  const noShows = finishedCurrent.filter((booking) => booking.status === "no_show").length;

  const lifetimeNonCancelled = new Map<string, number>();
  for (const booking of allBookings) {
    if (booking.status === "cancelled") continue;
    lifetimeNonCancelled.set(booking.clientId, (lifetimeNonCancelled.get(booking.clientId) ?? 0) + 1);
  }
  const currentClients = new Set(inCurrentPeriod.filter((booking) => booking.status !== "cancelled").map((booking) => booking.clientId));
  const returningClients = Array.from(currentClients).filter((clientId) => (lifetimeNonCancelled.get(clientId) ?? 0) > 1).length;
  const retentionRate = percentRate(returningClients, currentClients.size);

  const insights: AnalyticsInsight[] = [];

  if (busiestDay) {
    insights.push({ text: `${busiestDay[0]} is your busiest day in this period with ${busiestDay[1]} bookings.` });
  }

  if (topService) {
    insights.push({
      text: `${topService[0]} is your top service, generating R ${topService[1].revenue.toLocaleString()} from ${topService[1].bookings} completed bookings.`,
    });
  }

  insights.push({
    text:
      noShows > 0
        ? `You had ${noShows} no-shows in this period, which is ${percentRate(noShows, finishedCurrent.length)}% of finished bookings.`
        : "You had no no-shows in this period.",
  });

  insights.push({
    text: `${retentionRate}% of clients who booked in this period are returning clients.`,
  });

  if (currentRevenue > previousRevenue) {
    const delta = currentRevenue - previousRevenue;
    insights.push({
      text: `Revenue is up by R ${delta.toLocaleString()} compared with the previous matching period.`,
    });
  } else if (previousRevenue > currentRevenue) {
    const delta = previousRevenue - currentRevenue;
    insights.push({
      text: `Revenue is down by R ${delta.toLocaleString()} compared with the previous matching period.`,
    });
  } else {
    insights.push({
      text: "Revenue is unchanged compared with the previous matching period.",
    });
  }

  const strongestDay = [...buildDateBuckets(start, now)].map((bucket) => ({ ...bucket }));
  const dayLookup = new Map(strongestDay.map((bucket, index) => [bucket.date, index]));
  for (const booking of currentCompleted) {
    const key = format(new Date(booking.startTime), "MMM d");
    const index = dayLookup.get(key);
    if (index === undefined) continue;
    strongestDay[index].revenue += booking.totalAmount;
  }
  const bestRevenueDay = strongestDay.sort((a, b) => b.revenue - a.revenue)[0];
  if (bestRevenueDay && bestRevenueDay.revenue > 0) {
    insights.push({
      text: `${bestRevenueDay.date} was your strongest revenue day, bringing in R ${bestRevenueDay.revenue.toLocaleString()}.`,
    });
  }

  return insights.slice(0, 6);
}

export const analyticsKeys = {
  overview: (period: AnalyticsPeriod) => ["analytics", "overview", period] as const,
  insights: (period: AnalyticsPeriod) => ["analytics", "insights", period] as const,
};

