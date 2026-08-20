import { Router } from "express";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import {
  buildPayFastSandboxFields,
  getConfiguredApiOrigin,
  getRequestOrigin,
} from "../lib/payfast";
import { resolveMerchantPayFastCredentials } from "../lib/payment-providers";
import { calculateDepositAmount } from "../lib/deposit";

/**
 * Unauthenticated by design — the public booking page has no session, same
 * trust model as the existing anon create_public_booking RPC. The only guard
 * is that the booking must belong to the business resolved from the slug
 * (rejecting cross-tenant lookups), and payment-provider credentials are
 * still only ever read server-side.
 */

const router = Router();

router.post("/public-payments/payfast-intent", async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Payments are not configured" });
    }

    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim() : "";
    const bookingId = typeof req.body?.bookingId === "string" ? req.body.bookingId.trim() : "";
    if (!slug || !bookingId) {
      return res.status(400).json({ error: "slug and bookingId are required" });
    }

    const supa = getSupabaseAdmin();

    const { data: page, error: pageError } = await supa
      .from("booking_page_settings")
      .select("business_id, require_deposit")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();

    if (pageError) throw new Error(pageError.message);
    if (!page) return res.status(404).json({ error: "Booking page not found" });

    const businessId = page.business_id as string;

    const { data: booking, error: bookingError } = await supa
      .from("bookings")
      .select("id, client_id, service_id, status, deposit_paid, total_amount")
      .eq("id", bookingId)
      .eq("business_id", businessId)
      .maybeSingle();

    if (bookingError) throw new Error(bookingError.message);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status !== "pending") {
      return res.status(409).json({ error: "This booking is no longer awaiting payment" });
    }
    if (booking.deposit_paid) {
      return res.status(409).json({ error: "This booking's deposit has already been paid" });
    }

    // Reuse an existing non-terminal payment for this booking instead of
    // creating a duplicate row — protects against page refresh/back-button.
    const { data: existingPayment } = await supa
      .from("payments")
      .select("id, provider_reference, provider_payload")
      .eq("booking_id", bookingId)
      .eq("method", "payfast")
      .eq("status", "pending")
      .maybeSingle();

    if (existingPayment) {
      const payload = existingPayment.provider_payload as
        | { payfast_fields?: Record<string, string>; payfast_action_url?: string }
        | null;
      if (payload?.payfast_fields) {
        return res.json({
          action: payload.payfast_action_url,
          fields: payload.payfast_fields,
        });
      }
    }

    const [{ data: service, error: serviceError }, { data: client, error: clientError }, { data: depositSettings }] =
      await Promise.all([
        supa
          .from("services")
          .select("name, price, deposit_required, deposit_amount")
          .eq("id", booking.service_id)
          .maybeSingle(),
        supa
          .from("clients")
          .select("id, name, phone, email")
          .eq("id", booking.client_id)
          .maybeSingle(),
        supa
          .from("deposit_settings")
          .select("require_deposit, deposit_type, deposit_amount")
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);

    if (serviceError) throw new Error(serviceError.message);
    if (clientError) throw new Error(clientError.message);
    if (!service || !client) return res.status(404).json({ error: "Booking details not found" });

    const deposit = calculateDepositAmount(
      {
        deposit_required: Boolean(service.deposit_required),
        deposit_amount: Number(service.deposit_amount ?? 0),
        price: Number(service.price ?? 0),
      },
      depositSettings ?? null,
      Boolean(page.require_deposit),
    );

    if (!deposit.required || deposit.amount <= 0) {
      return res.status(409).json({ error: "This booking does not require a deposit" });
    }

    // Where PayFast calls us back. Must be this API's own public host, and must
    // NOT come from the request body — a caller who could set it would point
    // the notification somewhere else and leave the payment stuck pending.
    const notifyOrigin = getConfiguredApiOrigin(req);
    // Where the customer's browser lands afterwards: the app, which is a
    // different deployment.
    const appOrigin = getRequestOrigin(req);
    const paymentId = `bookza-pub-${Date.now()}`;
    const amount = deposit.amount.toFixed(2);
    const nameParts = (client.name as string).trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "Guest";
    const lastName = nameParts.slice(1).join(" ") || "Customer";

    const credentials = await resolveMerchantPayFastCredentials(businessId);
    if (!credentials) {
      // No merchant account, so there is nowhere for this money to go. Refusing
      // is the only honest answer: the fallback used to sign the request with
      // the shared sandbox account, which took the client through a checkout
      // that charged nothing and recorded a payment that never happened.
      return res.status(409).json({
        error:
          "This business hasn't finished setting up payments yet. Please contact them to book.",
      });
    }
    // booking_id travels in the return/cancel URLs (not just PayFast's own
    // custom_str fields) so the return page can poll status without any
    // client-side state surviving the full-page redirect to PayFast.
    const returnUrl = `${appOrigin}/book/${slug}/payment-return?payfast=success&booking_id=${bookingId}`;
    const cancelUrl = `${appOrigin}/book/${slug}/payment-return?payfast=cancelled&booking_id=${bookingId}`;

    const fields = buildPayFastSandboxFields({
      origin: notifyOrigin,
      appOrigin,
      paymentId,
      amount,
      itemName: `${service.name} deposit`,
      itemDescription: `Deposit for ${service.name} booking.`,
      customerFirstName: firstName,
      customerLastName: lastName,
      customerEmail: client.email as string | null,
      businessId,
      customSource: "bookza_public_booking",
      merchantId: credentials.merchantId,
      merchantKey: credentials.merchantKey,
      passphrase: credentials.passphrase,
      returnUrl,
      cancelUrl,
    });

    const { error: paymentError } = await supa.from("payments").insert({
      business_id: businessId,
      client_id: client.id,
      booking_id: bookingId,
      amount,
      method: "payfast",
      status: "pending",
      type: "deposit",
      notes: `Public booking-page deposit payment for ${service.name}.`,
      provider_reference: paymentId,
      provider_payload: {
        source: "public_booking",
        event: "created",
        booking_id: bookingId,
        created_at: new Date().toISOString(),
        payfast_fields: fields,
        payfast_action_url: credentials.actionUrl,
      },
    });

    if (paymentError) throw new Error(paymentError.message);

    return res.json({ action: credentials.actionUrl, fields });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not start deposit payment" });
  }
});

// Lightweight status check for the public payment-return page to poll — the
// `payments`/`bookings` tables have owner-only RLS, so an anonymous customer
// can't read them directly via Supabase; this is scoped the same way as the
// intent route above (booking must belong to the business resolved from slug).
router.get("/public-payments/status", async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Payments are not configured" });
    }

    const slug = typeof req.query.slug === "string" ? req.query.slug.trim() : "";
    const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId.trim() : "";
    if (!slug || !bookingId) {
      return res.status(400).json({ error: "slug and bookingId are required" });
    }

    const supa = getSupabaseAdmin();
    const { data: page, error: pageError } = await supa
      .from("booking_page_settings")
      .select("business_id")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();

    if (pageError) throw new Error(pageError.message);
    if (!page) return res.status(404).json({ error: "Booking page not found" });

    const { data: booking, error: bookingError } = await supa
      .from("bookings")
      .select("status, deposit_paid")
      .eq("id", bookingId)
      .eq("business_id", page.business_id)
      .maybeSingle();

    if (bookingError) throw new Error(bookingError.message);
    if (!booking) return res.status(404).json({ error: "Booking not found" });

    return res.json({ status: booking.status, depositPaid: Boolean(booking.deposit_paid) });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not check payment status" });
  }
});

export default router;
