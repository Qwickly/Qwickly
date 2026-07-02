import { Router, type Request } from "express";
import { store } from "../data/store";
import { getSupabaseAdmin, getUserFromAccessToken, isSupabaseAdminConfigured } from "../lib/supabase";

const router = Router();

function readAccessToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function getUserFromRequest(req: Request) {
  const accessToken = readAccessToken(req);
  if (!accessToken) {
    throw new Error("Missing authorization token");
  }
  return getUserFromAccessToken(accessToken);
}

async function getBusinessForUser(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Business not found");
  }

  return data as { id: string };
}

router.get("/dashboard/summary", async (req, res) => {
  try {
    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      const [todayBookings, upcomingBookings, totalBookings, noShowBookings, payments] = await Promise.all([
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id)
          .gte("start_time", startOfDay)
          .lt("start_time", startOfTomorrow)
          .neq("status", "cancelled"),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id)
          .gte("start_time", now.toISOString())
          .neq("status", "cancelled"),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id),
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("business_id", business.id)
          .eq("status", "no_show"),
        supabase
          .from("payments")
          .select("amount")
          .eq("business_id", business.id)
          .eq("status", "completed")
          .gte("paid_at", startOfMonth),
      ]);

      if (todayBookings.error || upcomingBookings.error || totalBookings.error || noShowBookings.error || payments.error) {
        throw todayBookings.error || upcomingBookings.error || totalBookings.error || noShowBookings.error || payments.error;
      }

      const revenueThisMonth = (payments.data ?? []).reduce(
        (sum, payment) => sum + Number((payment as any).amount ?? 0),
        0,
      );
      const total = Number(totalBookings.count ?? 0);
      const nsCount = Number(noShowBookings.count ?? 0);
      const noShowRate = total > 0 ? (nsCount / total) * 100 : 0;

      return res.json({
        todayAppointments: Number(todayBookings.count ?? 0),
        revenueThisMonth,
        upcomingBookings: Number(upcomingBookings.count ?? 0),
        noShowRate: Math.round(noShowRate * 10) / 10,
        todayAppointmentsChange: 0,
        revenueChange: 0,
        upcomingChange: 0,
        noShowChange: 0,
      });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayBookings = store.bookings.filter(
      (b) => b.startTime >= startOfDay && b.startTime < startOfTomorrow,
    );
    const monthRevenue = store.payments
      .filter((p) => p.createdAt >= startOfMonth)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const upcoming = store.bookings.filter((b) => b.startTime >= now);
    const total = store.bookings.length;
    const nsCount = store.bookings.filter((b) => b.status === "no_show").length;
    const noShowRate = total > 0 ? (nsCount / total) * 100 : 0;

    res.json({
      todayAppointments: todayBookings.length,
      revenueThisMonth: monthRevenue,
      upcomingBookings: upcoming.length,
      noShowRate: Math.round(noShowRate * 10) / 10,
      todayAppointmentsChange: 12.5,
      revenueChange: 8.3,
      upcomingChange: 4.2,
      noShowChange: -2.1,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/revenue-chart", async (req, res) => {
  try {
    const period = (req.query.period as string) ?? "30d";
    const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 365;

    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();
      const now = new Date();
      const start = new Date(now);
      start.setDate(start.getDate() - (days - 1));

      const [paymentResult, bookingResult] = await Promise.all([
        supabase
          .from("payments")
          .select("amount, paid_at")
          .eq("business_id", business.id)
          .eq("status", "completed")
          .gte("paid_at", start.toISOString()),
        supabase
          .from("bookings")
          .select("start_time")
          .eq("business_id", business.id)
          .neq("status", "cancelled")
          .gte("start_time", start.toISOString()),
      ]);

      if (paymentResult.error) throw paymentResult.error;
      if (bookingResult.error) throw bookingResult.error;

      const revenueByDate = new Map<string, number>();
      ((paymentResult.data ?? []) as any[]).forEach((row) => {
        const date = new Date(row.paid_at).toISOString().split("T")[0];
        revenueByDate.set(date, (revenueByDate.get(date) ?? 0) + Number(row.amount ?? 0));
      });

      const bookingsByDate = new Map<string, number>();
      ((bookingResult.data ?? []) as any[]).forEach((row) => {
        const date = new Date(row.start_time).toISOString().split("T")[0];
        bookingsByDate.set(date, (bookingsByDate.get(date) ?? 0) + 1);
      });

      const points = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const label = d.toISOString().split("T")[0];
        points.push({
          date: label,
          revenue: Number(revenueByDate.get(label) ?? 0),
          bookings: bookingsByDate.get(label) ?? 0,
        });
      }

      return res.json(points);
    }

    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toISOString().split("T")[0];
      points.push({
        date: label,
        revenue: Math.round(Math.random() * 3000 + 500),
        bookings: Math.round(Math.random() * 20 + 5),
      });
    }

    res.json(points);
  } catch (err) {
    req.log.error(err);
    if (err instanceof Error && err.message.includes("Missing authorization token")) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/popular-services", async (req, res) => {
  try {
    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from("bookings")
        .select("service_id, total_amount, services(name, price)")
        .eq("business_id", business.id)
        .neq("status", "cancelled");

      if (error) throw error;

      const serviceMap = new Map<string, { id: string; name: string; bookingCount: number; revenue: number }>();
      (data ?? []).forEach((row: any) => {
        const service = Array.isArray(row.services) ? row.services[0] : row.services;
        const id = row.service_id ?? service?.name ?? "unknown";
        const existing = serviceMap.get(id) ?? {
          id,
          name: service?.name ?? "Unknown",
          bookingCount: 0,
          revenue: 0,
        };
        existing.bookingCount += 1;
        existing.revenue += Number(row.total_amount ?? 0);
        serviceMap.set(id, existing);
      });

      let result = Array.from(serviceMap.values())
        .sort((a, b) => b.bookingCount - a.bookingCount)
        .slice(0, 6);

      const totalRevenue = result.reduce((sum, service) => sum + service.revenue, 0);
      result = result.map((service, index) => ({
        id: service.id,
        name: service.name,
        bookingCount: service.bookingCount,
        revenue: service.revenue,
        percentageOfTotal:
          totalRevenue > 0
            ? Math.round((service.revenue / totalRevenue) * 100)
            : [43, 28, 15, 8, 4, 2][index] ?? 1,
      }));

      if (result.length === 0) {
        const { data: services } = await supabase
          .from("services")
          .select("id, name, price")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .limit(6);

        result = (services ?? []).map((s: any, index: number) => ({
          id: s.id,
          name: s.name,
          bookingCount: 0,
          revenue: Number(s.price ?? 0),
          percentageOfTotal: [43, 28, 15, 8, 4, 2][index] ?? 1,
        }));
      }

      return res.json(result);
    }

    const services = store.services.slice(0, 6);
    const result = services.map((s, i) => ({
      id: s.id,
      name: s.name,
      bookingCount: s.bookingCount ?? Math.floor(Math.random() * 80 + 10),
      revenue: Number(s.price) * (s.bookingCount || 1),
      percentageOfTotal: [43, 28, 15, 8, 4, 2][i] ?? 1,
    }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/activity-feed", async (req, res) => {
  try {
    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from("bookings")
        .select("id, created_at, status, clients(name), services(name)")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (error) throw error;

      const activities = ((data ?? []) as any[]).map((b, i) => {
        const client = Array.isArray(b.clients) ? b.clients[0] : b.clients;
        const service = Array.isArray(b.services) ? b.services[0] : b.services;
        const type = b.status === "cancelled" ? "cancellation" : "booking";
        const message =
          b.status === "confirmed"
            ? `${client?.name ?? "Client"} booked ${service?.name ?? "a service"}`
            : b.status === "cancelled"
            ? `${client?.name ?? "Client"} cancelled ${service?.name ?? "a service"}`
            : `${client?.name ?? "Client"} updated ${service?.name ?? "a service"}`;
        return {
          id: i + 1,
          type,
          message,
          clientName: client?.name ?? "Client",
          timestamp: new Date(b.created_at).toISOString(),
          avatarUrl: null,
        };
      });

      return res.json(activities);
    }

    const clients = store.clients.slice(0, 10);
    const bookings = [...store.bookings]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    const activities = bookings.slice(0, 8).map((b, i) => {
      const client = clients.find((c) => c.id === b.clientId) ?? clients[0];
      const types = ["booking", "payment", "reminder", "cancellation"] as const;
      const messages = [
        `${client?.name ?? "Client"} booked a service`,
        `Deposit payment received from ${client?.name ?? "client"}`,
        `Reminder sent to ${client?.name ?? "client"}`,
        `Booking confirmed for ${client?.name ?? "client"}`,
      ];
      return {
        id: b.id,
        type: types[i % 4],
        message: messages[i % 4],
        clientName: client?.name ?? "Client",
        timestamp: b.createdAt.toISOString(),
        avatarUrl: client?.avatarUrl ?? null,
      };
    });

    res.json(activities);
  } catch (err) {
    req.log.error(err);
    if (err instanceof Error && err.message.includes("Missing authorization token")) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/calendar-overview", async (req, res) => {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);

    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from("bookings")
        .select("id, client_id, service_id, staff_id, start_time, end_time, status, deposit_paid, notes, clients(name, phone), services(name, color), staff_members(name)")
        .eq("business_id", business.id)
        .gte("start_time", now.toISOString())
        .order("start_time", { ascending: true })
        .limit(30);

      if (error) throw error;

      const allBookings = (data ?? []) as any[];
      const mapBooking = (b: any) => {
        const client = Array.isArray(b.clients) ? b.clients[0] : b.clients;
        const service = Array.isArray(b.services) ? b.services[0] : b.services;
        const staff = Array.isArray(b.staff_members) ? b.staff_members[0] : b.staff_members;
        return {
          id: b.id,
          bookingId: b.id,
          clientName: client?.name ?? "Client",
          clientPhone: client?.phone ?? null,
          serviceName: service?.name ?? "Service",
          staffName: staff?.name ?? "Staff",
          staffId: b.staff_id,
          startTime: new Date(b.start_time).toISOString(),
          endTime: new Date(b.end_time).toISOString(),
          status: b.status,
          depositPaid: b.deposit_paid,
          color: service?.color ?? "#10b981",
          notes: b.notes ?? null,
        };
      };

      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

      return res.json({
        today: allBookings.filter((b) => new Date(b.start_time) >= now && new Date(b.start_time) < todayEnd).map(mapBooking),
        tomorrow: allBookings.filter((b) => new Date(b.start_time) >= tomorrow && new Date(b.start_time) < tomorrowEnd).map(mapBooking),
        thisWeek: allBookings.filter((b) => new Date(b.start_time) >= now && new Date(b.start_time) < weekEnd).map(mapBooking),
      });
    }

    const allBookings = store.bookings
      .filter((b) => b.startTime >= now)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .slice(0, 30);

    const mapBooking = (b: (typeof allBookings)[0]) => {
      const client = store.clients.find((c) => c.id === b.clientId);
      const service = store.services.find((s) => s.id === b.serviceId);
      return {
        id: b.id,
        bookingId: b.id,
        clientName: client?.name ?? "Client",
        clientPhone: client?.phone ?? null,
        serviceName: service?.name ?? "Service",
        staffName: "Staff",
        staffId: b.staffId,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
        depositPaid: b.depositPaid,
        color: service?.color ?? "#10b981",
        notes: b.notes ?? null,
      };
    };

    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

    res.json({
      today: allBookings.filter((b) => b.startTime >= now && b.startTime < todayEnd).map(mapBooking),
      tomorrow: allBookings.filter((b) => b.startTime >= tomorrow && b.startTime < tomorrowEnd).map(mapBooking),
      thisWeek: allBookings.filter((b) => b.startTime >= now && b.startTime < weekEnd).map(mapBooking),
    });
  } catch (err) {
    req.log.error(err);
    if (err instanceof Error && err.message.includes("Missing authorization token")) {
      return res.status(401).json({ error: err.message });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
