import { Router, type Request } from "express";
import { store } from "../data/store";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, getUserFromAccessToken, isSupabaseAdminConfigured } from "../lib/supabase";
import {
  PAYFAST_SANDBOX_URL,
  buildPayFastSandboxFields,
  createPayFastSignature,
  getRequestOrigin,
  normalizePayFastFields,
  readPayFastString,
} from "../lib/payfast";
import { resolvePayFastCredentials } from "../lib/payment-providers";

const router = Router();

async function getBusinessForUser(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("businesses")
    .select("id, business_name, email")
    .eq("user_id", userId)
    .single();

  if (error) throw new Error(error.message);
  return data as { id: string; business_name: string; email: string };
}

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

async function getOrCreateSandboxClient(businessId: string, businessEmail?: string | null): Promise<string> {
  const supabase = getSupabaseAdmin();
  const email = businessEmail?.trim() || "test@bookza.co.za";

  const { data: existing, error: existingError } = await supabase
    .from("clients")
    .select("id")
    .eq("business_id", businessId)
    .eq("email", email)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from("clients")
    .insert({
      business_id: businessId,
      name: "PayFast Sandbox Tester",
      phone: "",
      email,
      client_type: "new",
      notes: "Automatically created for PayFast sandbox test payments.",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id as string;
}

router.post("/payments/payfast-sandbox", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({
        error: "Payment tracking is incomplete. Add Supabase server credentials to the API server env.",
      });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const clientId = await getOrCreateSandboxClient(business.id, business.email);
    const origin = getRequestOrigin(req);
    const paymentId = `bookza-test-${Date.now()}`;
    const amount = "10.00";
    const supabase = getSupabaseAdmin();

    const { error: paymentError } = await supabase
      .from("payments")
      .insert({
        business_id: business.id,
        client_id: clientId,
        amount,
        method: "payfast",
        status: "pending",
        type: "deposit",
        paid_at: new Date().toISOString(),
        notes: "PayFast sandbox test payment created from the Payments page.",
        provider_reference: paymentId,
        provider_payload: {
          source: "payfast_sandbox",
          event: "created",
          created_at: new Date().toISOString(),
        },
      });

    if (paymentError) throw new Error(paymentError.message);

    const fields = buildPayFastSandboxFields({
      origin,
      paymentId,
      amount,
      itemName: "Bookza sandbox test payment",
      itemDescription: `PayFast sandbox test payment for ${business.business_name || "Bookza"}.`,
      customerFirstName: "Bookza",
      customerLastName: "Tester",
      customerEmail: business.email,
      businessId: business.id,
      customSource: "bookza_sandbox_test",
    });

    res.json({
      action: PAYFAST_SANDBOX_URL,
      paymentId,
      fields,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not create PayFast sandbox payment" });
  }
});

router.post("/payments/payfast-sandbox/notify", async (req, res) => {
  // NOTE: URL kept as "payfast-sandbox" for backward compatibility — PayFast
  // dashboards for already-connected businesses reference this exact
  // notify_url. It now handles the dashboard sandbox tester, per-business
  // real PayFast payments, and WhatsApp AI deposit links, all of the same
  // shape (method='payfast', a payments row keyed by provider_reference).
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).send("Supabase is not configured");
    }

    const fields = normalizePayFastFields(req.body ?? {});
    const receivedSignature = readPayFastString(req.body?.signature);

    // custom_str2 carries the business_id (see buildPayFastSandboxFields) —
    // resolve THAT business's passphrase to verify against. Falls back to the
    // shared sandbox passphrase automatically when the business never
    // connected their own account, so historical/unconnected-business ITNs
    // keep verifying exactly as before.
    const businessId = fields.custom_str2;
    const credentials = businessId
      ? await resolvePayFastCredentials(businessId)
      : null;
    const expectedSignature = createPayFastSignature(fields, credentials?.passphrase);

    if (!receivedSignature || receivedSignature !== expectedSignature) {
      return res.status(400).send("Invalid signature");
    }

    const paymentReference = fields.m_payment_id;
    if (!paymentReference) {
      return res.status(400).send("Missing payment reference");
    }

    const payfastStatus = fields.payment_status.toUpperCase();
    const nextStatus =
      payfastStatus === "COMPLETE"
        ? "completed"
        : payfastStatus === "CANCELLED" || payfastStatus === "FAILED"
          ? "failed"
          : "pending";

    const supa = getSupabaseAdmin();

    const { data: paymentRow, error } = await supa
      .from("payments")
      .update({
        status: nextStatus,
        paid_at: new Date().toISOString(),
        provider_payload: {
          source: "payfast_sandbox",
          event: "itn",
          received_at: new Date().toISOString(),
          data: req.body,
        },
      })
      .eq("provider_reference", paymentReference)
      .eq("method", "payfast")
      .select("booking_id")
      .maybeSingle();

    if (error) throw new Error(error.message);

    // Flip the linked booking's deposit_paid on a completed deposit. The
    // `deposit_paid=false` guard makes this idempotent against PayFast's
    // documented ITN retries — a second identical COMPLETE just matches 0
    // rows and no-ops instead of re-running any side effects.
    if (nextStatus === "completed" && paymentRow?.booking_id) {
      const { error: bookingError } = await supa
        .from("bookings")
        .update({ deposit_paid: true, pending_expires_at: null })
        .eq("id", paymentRow.booking_id)
        .eq("deposit_paid", false);
      if (bookingError) {
        req.log.error({ err: bookingError }, "[Payments] Failed to mark booking deposit_paid after ITN");
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    req.log.error(err);
    res.status(500).send("Could not process PayFast notification");
  }
});

router.get("/payments/payfast-sandbox/:reference/start", async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).send("Supabase is not configured");
    }

    const reference = req.params.reference;
    const { data: payment, error } = await getSupabaseAdmin()
      .from("payments")
      .select("provider_payload")
      .eq("provider_reference", reference)
      .eq("method", "payfast")
      .maybeSingle();

    if (error) throw new Error(error.message);
    const payload = payment?.provider_payload as
      | { payfast_fields?: Record<string, string>; payfast_action_url?: string }
      | null
      | undefined;
    const fields = payload?.payfast_fields;

    if (!fields) {
      return res.status(404).send("Payment link not found");
    }

    // Falls back to the sandbox URL for payment rows created before per-
    // business credentials existed (they never stored an action url).
    const actionUrl = payload?.payfast_action_url ?? PAYFAST_SANDBOX_URL;

    const inputs = Object.entries(fields)
      .map(([name, value]) => {
        const safeName = String(name).replace(/"/g, "&quot;");
        const safeValue = String(value).replace(/"/g, "&quot;");
        return `<input type="hidden" name="${safeName}" value="${safeValue}" />`;
      })
      .join("");

    res.type("html").send(`<!doctype html>
<html>
  <head><title>Redirecting to PayFast</title></head>
  <body>
    <form id="payfast" method="post" action="${actionUrl}">
      ${inputs}
      <noscript><button type="submit">Continue to PayFast</button></noscript>
    </form>
    <script>document.getElementById("payfast").submit();</script>
  </body>
</html>`);
  } catch (err) {
    req.log.error(err);
    res.status(500).send("Could not start PayFast payment");
  }
});

router.post("/payments/payfast-sandbox/:reference/cancel", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const reference = req.params.reference;

    const { error } = await getSupabaseAdmin()
      .from("payments")
      .update({
        status: "failed",
        provider_payload: {
          source: "payfast_sandbox",
          event: "cancelled_return",
          received_at: new Date().toISOString(),
        },
      })
      .eq("business_id", business.id)
      .eq("provider_reference", reference)
      .eq("status", "pending");

    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not update PayFast sandbox payment" });
  }
});

router.post("/payments/payfast-sandbox/:reference/complete", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }

    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const reference = req.params.reference;

    const { error } = await getSupabaseAdmin()
      .from("payments")
      .update({
        status: "completed",
        paid_at: new Date().toISOString(),
        provider_payload: {
          source: "payfast_sandbox",
          event: "successful_return",
          received_at: new Date().toISOString(),
        },
      })
      .eq("business_id", business.id)
      .eq("provider_reference", reference)
      .eq("method", "payfast");

    if (error) throw new Error(error.message);
    res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not complete PayFast sandbox payment" });
  }
});

router.get("/payments", async (req, res) => {
  try {
    const { method, status, dateFrom, dateTo } = req.query as Record<string, string>;

    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      let query = supabase
        .from("payments")
        .select("id, client_id, booking_id, amount, method, status, type, paid_at, created_at, clients(name)")
        .eq("business_id", business.id)
        .order("paid_at", { ascending: false });

      if (method && method !== "null") query = query.eq("method", method);
      if (status && status !== "null") query = query.eq("status", status);
      if (dateFrom) query = query.gte("paid_at", new Date(dateFrom).toISOString());
      if (dateTo) query = query.lte("paid_at", new Date(dateTo).toISOString());

      const { data, error } = await query;
      if (error) throw error;

      const result = ((data ?? []) as any[]).map((p) => {
        const client = Array.isArray(p.clients) ? p.clients[0] : p.clients;
        return {
          id: p.id,
          clientId: p.client_id,
          clientName: client?.name ?? "Unknown",
          bookingId: p.booking_id,
          amount: Number(p.amount),
          method: p.method,
          status: p.status,
          type: p.type,
          date: new Date(p.paid_at).toISOString(),
          createdAt: new Date(p.created_at).toISOString(),
        };
      });

      return res.json(result);
    }

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
    if (isSupabaseAdminConfigured()) {
      const user = await getUserFromRequest(req);
      const business = await getBusinessForUser(user.id);
      const supabase = getSupabaseAdmin();

      const { data, error } = await supabase
        .from("payments")
        .select("amount, status, type")
        .eq("business_id", business.id);

      if (error) throw error;

      const payments = (data ?? []) as any[];
      const totalRevenue = payments
        .filter((p) => p.status === "completed")
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      const deposits = payments
        .filter((p) => p.type === "deposit" && p.status === "completed")
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      const outstanding = payments
        .filter((p) => p.status === "pending")
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
      const refunds = payments
        .filter((p) => p.type === "refund")
        .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);

      return res.json({
        totalRevenue,
        depositsCollected: deposits,
        outstandingPayments: outstanding,
        refunds,
        revenueChange: 0,
        depositsChange: 0,
        outstandingChange: 0,
        refundsChange: 0,
      });
    }

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
