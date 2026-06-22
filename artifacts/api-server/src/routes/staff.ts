import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/staff", async (req, res) => {
  try {
    const members = [...store.staff].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    res.json(members.map((m) => {
      const upcoming = store.bookings.filter(
        (b) => b.staffId === m.id && new Date(b.startTime) > new Date() && b.status !== "cancelled"
      ).length;
      return {
        id: m.id, name: m.name, position: m.position,
        email: m.email ?? null, phone: m.phone ?? null,
        avatarUrl: m.avatarUrl ?? null, upcomingBookings: upcoming,
        revenueGenerated: Number(m.revenueGenerated),
        completedBookings: m.completedBookings, isActive: m.isActive,
        serviceIds: [], createdAt: m.createdAt.toISOString(),
      };
    }));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/staff", async (req, res) => {
  try {
    const { name, position, email, phone, serviceIds } = req.body;
    const m = {
      id: store.nextId.staff++,
      name,
      position,
      email: email ?? null,
      phone: phone ?? null,
      avatarUrl: null,
      revenueGenerated: "0",
      completedBookings: 0,
      isActive: true,
      createdAt: new Date(),
    };
    store.staff.push(m);

    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    for (const day of days) {
      store.staffSchedule.push({
        id: store.nextId.staffSchedule++,
        staffId: m.id,
        day,
        isAvailable: day !== "sunday",
        startTime: "09:00",
        endTime: "17:00",
      });
    }

    res.status(201).json({
      id: m.id, name: m.name, position: m.position,
      email: m.email ?? null, phone: m.phone ?? null,
      avatarUrl: null, upcomingBookings: 0, revenueGenerated: 0,
      completedBookings: 0, isActive: true,
      serviceIds: serviceIds ?? [], createdAt: m.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/staff/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = store.staff.find((x) => x.id === id);
    if (!m) return res.status(404).json({ error: "Not found" });

    const upcoming = store.bookings.filter((b) => b.staffId === id).slice(0, 10);

    res.json({
      staffMember: {
        id: m.id, name: m.name, position: m.position,
        email: m.email ?? null, phone: m.phone ?? null,
        avatarUrl: m.avatarUrl ?? null, upcomingBookings: upcoming.length,
        revenueGenerated: Number(m.revenueGenerated),
        completedBookings: m.completedBookings, isActive: m.isActive,
        serviceIds: [], createdAt: m.createdAt.toISOString(),
      },
      upcomingBookings: upcoming.map((b) => ({
        id: b.id, clientId: b.clientId, clientName: "Client",
        clientPhone: null, serviceId: b.serviceId, serviceName: "Service",
        staffId: b.staffId, staffName: m.name,
        startTime: b.startTime.toISOString(), endTime: b.endTime.toISOString(),
        status: b.status, depositPaid: b.depositPaid,
        depositAmount: Number(b.depositAmount), totalAmount: Number(b.totalAmount),
        notes: b.notes ?? null, createdAt: b.createdAt.toISOString(),
      })),
      performanceMetrics: {
        totalBookings: m.completedBookings + upcoming.length,
        completionRate: 94.2,
        noShowRate: 3.1,
        averageRating: 4.8,
        revenueThisMonth: Number(m.revenueGenerated),
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/staff/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const m = store.staff.find((x) => x.id === id);
    if (!m) return res.status(404).json({ error: "Not found" });

    if (req.body.name !== undefined) m.name = req.body.name;
    if (req.body.position !== undefined) m.position = req.body.position;
    if (req.body.email !== undefined) m.email = req.body.email;
    if (req.body.phone !== undefined) m.phone = req.body.phone;
    if (req.body.isActive !== undefined) m.isActive = req.body.isActive;

    res.json({
      id: m.id, name: m.name, position: m.position,
      email: m.email ?? null, phone: m.phone ?? null,
      avatarUrl: m.avatarUrl ?? null, upcomingBookings: 0,
      revenueGenerated: Number(m.revenueGenerated),
      completedBookings: m.completedBookings, isActive: m.isActive,
      serviceIds: [], createdAt: m.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/staff/:id/schedule", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const schedule = store.staffSchedule.filter((s) => s.staffId === id);

    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const availability = days.map((day) => {
      const entry = schedule.find((s) => s.day === day);
      return {
        day,
        isAvailable: entry?.isAvailable ?? (day !== "sunday"),
        startTime: entry?.startTime ?? "09:00",
        endTime: entry?.endTime ?? "17:00",
      };
    });

    res.json({ staffId: id, weeklyAvailability: availability });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/staff/:id/schedule", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { weeklyAvailability } = req.body;

    for (const entry of weeklyAvailability ?? []) {
      const existing = store.staffSchedule.filter((s) => s.staffId === id);
      const match = existing.find((e) => e.day === entry.day);
      if (match) {
        match.isAvailable = entry.isAvailable;
        match.startTime = entry.startTime;
        match.endTime = entry.endTime;
      } else {
        store.staffSchedule.push({
          id: store.nextId.staffSchedule++,
          staffId: id,
          day: entry.day,
          isAvailable: entry.isAvailable,
          startTime: entry.startTime,
          endTime: entry.endTime,
        });
      }
    }

    res.json({ staffId: id, weeklyAvailability: weeklyAvailability ?? [] });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
