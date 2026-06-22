import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/bookings", async (req, res) => {
  try {
    const { status, staffId, serviceId, dateFrom, dateTo, search } = req.query as Record<string, string>;

    let bookings = [...store.bookings];

    if (status) bookings = bookings.filter((b) => b.status === status);
    if (staffId) bookings = bookings.filter((b) => b.staffId === Number(staffId));
    if (serviceId) bookings = bookings.filter((b) => b.serviceId === Number(serviceId));
    if (dateFrom) bookings = bookings.filter((b) => b.startTime >= new Date(dateFrom));
    if (dateTo) bookings = bookings.filter((b) => b.startTime <= new Date(dateTo));

    const result = bookings.slice(0, 100).map((b) => {
      const client = store.clients.find((c) => c.id === b.clientId);
      const service = store.services.find((s) => s.id === b.serviceId);
      const member = store.staff.find((s) => s.id === b.staffId);
      return {
        id: b.id,
        clientId: b.clientId,
        clientName: client?.name ?? "Unknown",
        clientPhone: client?.phone ?? null,
        serviceId: b.serviceId,
        serviceName: service?.name ?? "Unknown",
        staffId: b.staffId,
        staffName: member?.name ?? "Unknown",
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
        depositPaid: b.depositPaid,
        depositAmount: Number(b.depositAmount),
        totalAmount: Number(b.totalAmount),
        notes: b.notes ?? null,
        createdAt: b.createdAt.toISOString(),
      };
    }).filter((b) => !search || b.clientName.toLowerCase().includes(search.toLowerCase()));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bookings", async (req, res) => {
  try {
    const { clientId, serviceId, staffId, startTime, notes, depositRequired } = req.body;

    const svc = store.services.find((s) => s.id === Number(serviceId));
    if (!svc) return res.status(404).json({ error: "Service not found" });

    const start = new Date(startTime);
    const end = new Date(start.getTime() + (svc.duration ?? 60) * 60 * 1000);

    const booking = {
      id: store.nextId.booking++,
      clientId: Number(clientId),
      serviceId: Number(serviceId),
      staffId: Number(staffId),
      startTime: start,
      endTime: end,
      status: "pending",
      depositPaid: false,
      depositAmount: depositRequired ? svc.depositAmount ?? "0" : "0",
      totalAmount: svc.price,
      notes: notes ?? null,
      createdAt: new Date(),
    };
    store.bookings.push(booking);

    const client = store.clients.find((c) => c.id === Number(clientId));
    const staff = store.staff.find((s) => s.id === Number(staffId));

    res.status(201).json({
      id: booking.id,
      clientId: booking.clientId,
      clientName: client?.name ?? "Unknown",
      clientPhone: client?.phone ?? null,
      serviceId: booking.serviceId,
      serviceName: svc.name,
      staffId: booking.staffId,
      staffName: staff?.name ?? "Unknown",
      startTime: booking.startTime.toISOString(),
      endTime: booking.endTime.toISOString(),
      status: booking.status,
      depositPaid: booking.depositPaid,
      depositAmount: Number(booking.depositAmount),
      totalAmount: Number(booking.totalAmount),
      notes: booking.notes ?? null,
      createdAt: booking.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/bookings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = store.bookings.find((x) => x.id === id);
    if (!b) return res.status(404).json({ error: "Not found" });

    const client = store.clients.find((c) => c.id === b.clientId);
    const service = store.services.find((s) => s.id === b.serviceId);
    const staff = store.staff.find((s) => s.id === b.staffId);

    res.json({
      id: b.id,
      clientId: b.clientId,
      clientName: client?.name ?? "Unknown",
      clientPhone: client?.phone ?? null,
      serviceId: b.serviceId,
      serviceName: service?.name ?? "Unknown",
      staffId: b.staffId,
      staffName: staff?.name ?? "Unknown",
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      depositPaid: b.depositPaid,
      depositAmount: Number(b.depositAmount),
      totalAmount: Number(b.totalAmount),
      notes: b.notes ?? null,
      createdAt: b.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/bookings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = store.bookings.find((x) => x.id === id);
    if (!b) return res.status(404).json({ error: "Not found" });

    if (req.body.startTime !== undefined) b.startTime = new Date(req.body.startTime);
    if (req.body.status !== undefined) b.status = req.body.status;
    if (req.body.notes !== undefined) b.notes = req.body.notes;
    if (req.body.depositPaid !== undefined) b.depositPaid = req.body.depositPaid;

    const client = store.clients.find((c) => c.id === b.clientId);
    const service = store.services.find((s) => s.id === b.serviceId);
    const staff = store.staff.find((s) => s.id === b.staffId);

    res.json({
      id: b.id,
      clientId: b.clientId,
      clientName: client?.name ?? "Unknown",
      clientPhone: client?.phone ?? null,
      serviceId: b.serviceId,
      serviceName: service?.name ?? "Unknown",
      staffId: b.staffId,
      staffName: staff?.name ?? "Unknown",
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      depositPaid: b.depositPaid,
      depositAmount: Number(b.depositAmount),
      totalAmount: Number(b.totalAmount),
      notes: b.notes ?? null,
      createdAt: b.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/bookings/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = store.bookings.find((x) => x.id === id);
    if (b) b.status = "cancelled";
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bookings/:id/confirm", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = store.bookings.find((x) => x.id === id);
    if (!b) return res.status(404).json({ error: "Not found" });
    b.status = "confirmed";

    const client = store.clients.find((c) => c.id === b.clientId);
    const service = store.services.find((s) => s.id === b.serviceId);
    const staff = store.staff.find((s) => s.id === b.staffId);

    res.json({
      id: b.id, clientId: b.clientId,
      clientName: client?.name ?? "Unknown",
      clientPhone: client?.phone ?? null,
      serviceId: b.serviceId, serviceName: service?.name ?? "Unknown",
      staffId: b.staffId, staffName: staff?.name ?? "Unknown",
      startTime: b.startTime.toISOString(), endTime: b.endTime.toISOString(),
      status: b.status, depositPaid: b.depositPaid,
      depositAmount: Number(b.depositAmount), totalAmount: Number(b.totalAmount),
      notes: b.notes ?? null, createdAt: b.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/bookings/:id/send-whatsapp", async (req, res) => {
  try {
    res.json({ success: true, messageId: `msg_${Date.now()}`, error: null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
