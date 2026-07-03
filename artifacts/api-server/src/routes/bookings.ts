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

async function getUserFromRequest(req: Request) {
  const accessToken = readAccessToken(req);
  if (!accessToken) {
    throw new Error("Missing authorization token");
  }
  return getUserFromAccessToken(accessToken);
}

router.get("/bookings", async (req, res) => {
  try {
    const { status, staffId, serviceId, dateFrom, dateTo, search } = req.query as Record<string, string>;

    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      let query = supabase
        .from("bookings")
        .select("id, client_id, service_id, staff_id, start_time, end_time, status, deposit_paid, total_amount, notes, created_at, clients(name, phone), services(name, deposit_amount), staff_members(name)")
        .eq("business_id", business.id);

      if (status) query = query.eq("status", status);
      if (staffId) query = query.eq("staff_id", staffId);
      if (serviceId) query = query.eq("service_id", serviceId);
      if (dateFrom) query = query.gte("start_time", new Date(dateFrom).toISOString());
      if (dateTo) query = query.lte("start_time", new Date(dateTo).toISOString());

      const { data, error } = await query.order("start_time", { ascending: true }).limit(100);
      if (error) throw error;

      const result = ((data ?? []) as any[])
        .map((b) => {
          const client = Array.isArray(b.clients) ? b.clients[0] : b.clients;
          const service = Array.isArray(b.services) ? b.services[0] : b.services;
          const staff = Array.isArray(b.staff_members) ? b.staff_members[0] : b.staff_members;

          return {
            id: b.id,
            clientId: b.client_id,
            clientName: client?.name ?? "Unknown",
            clientPhone: client?.phone ?? null,
            serviceId: b.service_id,
            serviceName: service?.name ?? "Unknown",
            staffId: b.staff_id,
            staffName: staff?.name ?? "Unknown",
            startTime: new Date(b.start_time).toISOString(),
            endTime: new Date(b.end_time).toISOString(),
            status: b.status,
            depositPaid: b.deposit_paid,
            depositAmount: Number(service?.deposit_amount ?? 0),
            totalAmount: Number(b.total_amount ?? 0),
            notes: b.notes ?? null,
            createdAt: new Date(b.created_at).toISOString(),
          };
        })
        .filter((b) => !search || b.clientName.toLowerCase().includes(search.toLowerCase()));

      return res.json(result);
    }

    let bookings = [...store.bookings];

    if (status) bookings = bookings.filter((b) => b.status === status);
    if (staffId) bookings = bookings.filter((b) => b.staffId === Number(staffId));
    if (serviceId) bookings = bookings.filter((b) => b.serviceId === Number(serviceId));
    if (dateFrom) bookings = bookings.filter((b) => b.startTime >= new Date(dateFrom));
    if (dateTo) bookings = bookings.filter((b) => b.startTime <= new Date(dateTo));

    const result = bookings
      .slice(0, 100)
      .map((b) => {
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
      })
      .filter((b) => !search || b.clientName.toLowerCase().includes(search.toLowerCase()));

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
