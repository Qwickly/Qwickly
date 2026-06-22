import { Router } from "express";
import { store } from "../data/store";

const router = Router();

router.get("/payments", async (req, res) => {
  try {
    const { method, status, dateFrom, dateTo } = req.query as Record<string, string>;

    let payments = [...store.payments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    if (method && method !== "null") payments = payments.filter((p) => p.method === method);
    if (status && status !== "null") payments = payments.filter((p) => p.status === status);
    if (dateFrom) payments = payments.filter((p) => p.date >= dateFrom);
    if (dateTo) payments = payments.filter((p) => p.date <= dateTo);

    res.json(payments.map((p) => {
      const client = store.clients.find((c) => c.id === p.clientId);
      return {
        id: p.id, clientId: p.clientId,
        clientName: client?.name ?? "Unknown",
        bookingId: p.bookingId, amount: Number(p.amount),
        method: p.method, status: p.status, type: p.type,
        date: p.date, createdAt: p.createdAt.toISOString(),
      };
    }));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/payments/summary", async (req, res) => {
  try {
    const payments = store.payments;

    const totalRevenue = payments.filter((p) => p.status === "completed")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const deposits = payments.filter((p) => p.type === "deposit" && p.status === "completed")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const outstanding = payments.filter((p) => p.status === "pending")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const refunds = payments.filter((p) => p.type === "refund")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    res.json({
      totalRevenue,
      depositsCollected: deposits,
      outstandingPayments: outstanding,
      refunds,
      revenueChange: 12.4,
      depositsChange: 8.1,
      outstandingChange: -5.3,
      refundsChange: 2.2,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
