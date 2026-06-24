import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import { store } from "../data/store";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";

const router = Router();

const PAYFAST_SANDBOX_URL =
  process.env["PAYFAST_SANDBOX_URL"] ?? "https://sandbox.payfast.co.za/eng/process";
const PAYFAST_SANDBOX_MERCHANT_ID =
  process.env["PAYFAST_SANDBOX_MERCHANT_ID"] ?? "10036200";
const PAYFAST_SANDBOX_MERCHANT_KEY =
  process.env["PAYFAST_SANDBOX_MERCHANT_KEY"] ?? "ztgkjo0djf02j";
const PAYFAST_SANDBOX_PASSPHRASE =
  process.env["PAYFAST_SANDBOX_PASSPHRASE"] ?? "uber20206torbeN";

function encodePayFastValue(value: string): string {
  return encodeURIComponent(value.trim()).replace(/%20/g, "+");
}

function createPayFastSignature(fields: Record<string, string>, passphrase: string): string {
  const parameterString = [
    ...Object.entries(fields)
      .filter(([, value]) => value !== "")
      .map(([key, value]) => `${key}=${encodePayFastValue(value)}`),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return createHash("md5").update(parameterString).digest("hex");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePayFastFields(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => key !== "signature")
      .map(([key, value]) => [key, readString(value)]),
  );
}

function getRequestOrigin(req: Request): string {
  const requestedOrigin = typeof req.body?.origin === "string" ? req.body.origin : "";
  if (/^https?:\/\/[^/]+$/i.test(requestedOrigin)) return requestedOrigin;

  const fallbackProtocol = req.get("x-forwarded-proto") ?? req.protocol;
  return `${fallbackProtocol}://${req.get("host")}`;
}

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

    const fields: Record<string, string> = {
      merchant_id: PAYFAST_SANDBOX_MERCHANT_ID,
      merchant_key: PAYFAST_SANDBOX_MERCHANT_KEY,
      return_url: `${origin}/payments?payfast=test-success&payment_id=${paymentId}`,
      cancel_url: `${origin}/payments?payfast=test-cancelled&payment_id=${paymentId}`,
      notify_url: `${origin}/api/payments/payfast-sandbox/notify`,
      name_first: "Bookza",
      name_last: "Tester",
      email_address: business.email || "test@bookza.co.za",
      m_payment_id: paymentId,
      amount,
      item_name: "Bookza sandbox test payment",
      item_description: `PayFast sandbox test payment for ${business.business_name || "Bookza"}.`,
      custom_str1: "bookza_sandbox_test",
      custom_str2: business.id,
    };

    res.json({
      action: PAYFAST_SANDBOX_URL,
      paymentId,
      fields: {
        ...fields,
        signature: createPayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE),
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not create PayFast sandbox payment" });
  }
});

router.post("/payments/payfast-sandbox/notify", async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).send("Supabase is not configured");
    }

    const receivedSignature = readString(req.body?.signature);
    const fields = normalizePayFastFields(req.body ?? {});
    const expectedSignature = createPayFastSignature(fields, PAYFAST_SANDBOX_PASSPHRASE);

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

    const { error } = await getSupabaseAdmin()
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
      .eq("method", "payfast");

    if (error) throw new Error(error.message);
    res.status(200).send("OK");
  } catch (err) {
    req.log.error(err);
    res.status(500).send("Could not process PayFast notification");
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
