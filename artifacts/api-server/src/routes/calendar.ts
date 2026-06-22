import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/calendar/events", async (req, res) => {
  try {
    const { from, to, staffId, serviceId } = req.query as Record<string, string>;

    let bookings = store.bookings.filter(
      (b) => b.startTime >= new Date(from) && b.startTime <= new Date(to)
    );
    if (staffId) bookings = bookings.filter((b) => b.staffId === Number(staffId));
    if (serviceId) bookings = bookings.filter((b) => b.serviceId === Number(serviceId));

    const events = bookings.slice(0, 200).map((b) => {
      const client = store.clients.find((c) => c.id === b.clientId);
      const service = store.services.find((s) => s.id === b.serviceId);
      const member = store.staff.find((s) => s.id === b.staffId);
      return {
        id: b.id,
        bookingId: b.id,
        clientName: client?.name ?? "Client",
        clientPhone: client?.phone ?? null,
        serviceName: service?.name ?? "Service",
        staffName: member?.name ?? "Staff",
        staffId: b.staffId,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
        status: b.status,
        depositPaid: b.depositPaid,
        color: service?.color ?? "#10b981",
        notes: b.notes ?? null,
      };
    });

    res.json(events);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
