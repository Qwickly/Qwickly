import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/clients", async (req, res) => {
  try {
    const { search, filter } = req.query as Record<string, string>;

    let clients = [...store.clients].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (filter && filter !== "all") {
      clients = clients.filter((c) => c.clientType === filter);
    }

    if (search) {
      const q = search.toLowerCase();
      clients = clients.filter((c) =>
        c.name.toLowerCase().includes(q) || c.phone.includes(q) || (c.email ?? "").toLowerCase().includes(q)
      );
    }

    res.json(clients.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email ?? null,
      totalSpent: Number(c.totalSpent),
      lifetimeBookings: c.lifetimeBookings,
      lastBookingDate: c.lastBookingDate ?? null,
      clientType: c.clientType,
      noShowCount: c.noShowCount,
      avatarUrl: c.avatarUrl ?? null,
      createdAt: c.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/clients", async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    const client = {
      id: store.nextId.client++,
      name,
      phone,
      email: email ?? null,
      totalSpent: "0",
      lifetimeBookings: 0,
      lastBookingDate: null,
      clientType: "new",
      noShowCount: 0,
      avatarUrl: null,
      createdAt: new Date(),
    };
    store.clients.push(client);
    res.status(201).json({
      id: client.id, name: client.name, phone: client.phone,
      email: client.email ?? null, totalSpent: 0, lifetimeBookings: 0,
      lastBookingDate: null, clientType: "new", noShowCount: 0,
      avatarUrl: null, createdAt: client.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/clients/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const client = store.clients.find((c) => c.id === id);
    if (!client) return res.status(404).json({ error: "Not found" });

    const bookings = store.bookings.filter((b) => b.clientId === id).slice(0, 20);
    const payments = store.payments.filter((p) => p.clientId === id).slice(0, 20);

    res.json({
      client: {
        id: client.id, name: client.name, phone: client.phone,
        email: client.email ?? null, totalSpent: Number(client.totalSpent),
        lifetimeBookings: client.lifetimeBookings, lastBookingDate: client.lastBookingDate ?? null,
        clientType: client.clientType, noShowCount: client.noShowCount,
        avatarUrl: client.avatarUrl ?? null, createdAt: client.createdAt.toISOString(),
      },
      recentBookings: bookings.map((b) => ({
        id: b.id, clientId: b.clientId, clientName: client.name,
        clientPhone: client.phone ?? null, serviceId: b.serviceId,
        serviceName: "Service", staffId: b.staffId, staffName: "Staff",
        startTime: b.startTime.toISOString(), endTime: b.endTime.toISOString(),
        status: b.status, depositPaid: b.depositPaid,
        depositAmount: Number(b.depositAmount), totalAmount: Number(b.totalAmount),
        notes: b.notes ?? null, createdAt: b.createdAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id, clientId: p.clientId, clientName: client.name,
        bookingId: p.bookingId, amount: Number(p.amount),
        method: p.method, status: p.status, type: p.type,
        date: p.date, createdAt: p.createdAt.toISOString(),
      })),
      notes: [],
      aiInsights: [
        { id: 1, text: `${client.name} books approximately every 4 weeks`, type: "positive", impact: "medium" },
        { id: 2, text: "High-value client — prioritize retention", type: "opportunity", impact: "high" },
      ],
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/clients/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const client = store.clients.find((c) => c.id === id);
    if (!client) return res.status(404).json({ error: "Not found" });

    if (req.body.name) client.name = req.body.name;
    if (req.body.phone) client.phone = req.body.phone;
    if (req.body.email !== undefined) client.email = req.body.email;

    res.json({
      id: client.id, name: client.name, phone: client.phone,
      email: client.email ?? null, totalSpent: Number(client.totalSpent),
      lifetimeBookings: client.lifetimeBookings, lastBookingDate: client.lastBookingDate ?? null,
      clientType: client.clientType, noShowCount: client.noShowCount,
      avatarUrl: client.avatarUrl ?? null, createdAt: client.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/clients/:id/ai-insights", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const client = store.clients.find((c) => c.id === id);

    res.json([
      { id: 1, text: `${client?.name ?? "Client"} frequently books every 4 weeks`, type: "positive", impact: "medium" },
      { id: 2, text: "Due for rebooking — last visit was 32 days ago", type: "warning", impact: "high" },
      { id: 3, text: "High-value client in top 10% by spend", type: "opportunity", impact: "high" },
      { id: 4, text: "Prefers Saturday morning appointments", type: "neutral", impact: "low" },
    ]);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
