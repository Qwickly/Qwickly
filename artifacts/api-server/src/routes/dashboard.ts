import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayBookings = store.bookings.filter((b) => b.startTime >= startOfDay);
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
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/popular-services", async (req, res) => {
  try {
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
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
