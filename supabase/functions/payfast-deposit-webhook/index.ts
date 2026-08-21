// PayFast ITN handler for BOOKING DEPOSITS.
//
// Why this lives here and not in the Express api-server (where it used to):
//
//  1. Reachability. PayFast delivers to the subscription webhook next door
//     without trouble. The same notifications aimed at the self-hosted API were
//     recorded by PayFast as "cURL Error" — a transport failure, before any HTTP
//     status existed. Rather than keep guessing at that path, deposits now use
//     the one PayFast demonstrably reaches.
//
//  2. Signature correctness. The api-server copy of the signature builder
//     dropped empty fields and used plain encodeURIComponent. PayFast signs with
//     PHP urlencode over ALL fields including empty ones, so any real ITN
//     carrying an empty custom_str or name_last could never match. The encoder
//     below is the one already debugged in payfast-webhook/index.ts.
//
// Everything this handler touches is Supabase, so nothing was lost in the move.
//
// Deposits differ from subscriptions in one important way: they are signed with
// the BUSINESS'S OWN merchant passphrase, not Qwickly's. The passphrase must
// therefore be resolved per-business before the signature can be checked.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { md5 } from "https://esm.sh/js-md5@0.8.3";

const PAYFAST_SANDBOX_PASSPHRASE =
  Deno.env.get("PAYFAST_SANDBOX_PASSPHRASE") || "uber20206torbeN";

/** How long to wait on PayFast's validate endpoint before giving up on it. */
const VALIDATE_TIMEOUT_MS = 8000;

/**
 * Must match PHP urlencode() exactly, because that is what PayFast used to build
 * the signature we are checking. encodeURIComponent leaves these six characters
 * unescaped; urlencode escapes them:  ! ' ( ) * ~
 */
function encodePayFastValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(
      /[!'()*~]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

/**
 * PayFast ITN signature: original field order, EMPTY VALUES INCLUDED.
 *
 * Filtering empty values out is the bug this function exists to avoid — a real
 * ITN almost always has at least one empty field, and dropping it changes the
 * parameter string and therefore the hash.
 */
function createPayFastSignature(
  fields: Record<string, string>,
  passphrase: string,
): string {
  const parameterString = [
    ...Object.entries(fields).map(
      ([key, value]) => `${key}=${encodePayFastValue(value)}`,
    ),
    `passphrase=${encodePayFastValue(passphrase)}`,
  ].join("&");

  return md5(parameterString);
}

function payFastValidateUrl(isSandbox: boolean): string {
  return isSandbox
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";
}

type Credentials = { passphrase: string; isSandbox: boolean };

/**
 * The passphrase to verify an inbound deposit ITN against.
 *
 * Lenient by design, mirroring resolvePayFastCredentials in the api-server: a
 * business that never connected its own account falls back to the shared sandbox
 * passphrase, so notifications for historical sandbox payments still verify.
 * This is only ever used to CHECK a signature, never to build a checkout.
 */
async function resolveCredentials(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  businessId: string,
): Promise<Credentials> {
  const fallback: Credentials = {
    passphrase: PAYFAST_SANDBOX_PASSPHRASE,
    isSandbox: true,
  };

  if (!businessId) return fallback;

  try {
    const { data, error } = await supabase
      .from("payment_provider_credentials")
      .select("merchant_id, merchant_key, passphrase, mode, connected")
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.connected || !data.merchant_id || !data.merchant_key) {
      return fallback;
    }

    // Vault first. The legacy plaintext column is only consulted as a fallback,
    // exactly as the api-server does it — see readPayFastPassphrase there.
    let passphrase = "";
    try {
      const { data: vaultData, error: vaultError } = await supabase.rpc(
        "get_payfast_passphrase",
        { p_business_id: businessId },
      );
      if (vaultError) throw new Error(vaultError.message);
      passphrase = (vaultData as string | null) ?? "";
    } catch (err) {
      console.error("[PayFast Deposit] Vault read failed:", err);
    }

    return {
      passphrase: passphrase || data.passphrase || "",
      isSandbox: data.mode !== "live",
    };
  } catch (err) {
    console.error("[PayFast Deposit] Credential lookup failed:", err);
    return fallback;
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const formData = await req.formData();
    const body: Record<string, string> = {};
    formData.forEach((value, key) => {
      body[key] = value.toString();
    });

    const receivedSignature = body.signature ?? "";
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key !== "signature") fields[key] = value;
    }

    const paymentReference = fields.m_payment_id ?? "";
    const businessId = fields.custom_str2 ?? "";

    console.log("[PayFast Deposit] ITN received", {
      paymentReference,
      businessId,
      paymentStatus: fields.payment_status,
    });

    const credentials = await resolveCredentials(supabase, businessId);
    const expectedSignature = createPayFastSignature(
      fields,
      credentials.passphrase,
    );

    if (!receivedSignature || receivedSignature !== expectedSignature) {
      console.error("[PayFast Deposit] Invalid signature", {
        received: receivedSignature,
        expected: expectedSignature,
      });
      return new Response("Invalid signature", { status: 400 });
    }

    // Ask PayFast whether this notification is really theirs. A valid signature
    // proves whoever sent it holds the passphrase — which a replayed
    // notification also does.
    //
    // A validation request that cannot be MADE is logged and allowed through on
    // the signature: PayFast retries a limited number of times, and dropping a
    // genuine COMPLETE because their validate endpoint was briefly unreachable
    // strands a paid booking. The timeout matters — without it a hung endpoint
    // would hold this function open until the platform kills it.
    try {
      const validateResponse = await fetch(
        payFastValidateUrl(credentials.isSandbox),
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body).toString(),
          signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        },
      );
      const validateText = (await validateResponse.text()).trim();

      if (validateText !== "VALID") {
        console.warn("[PayFast Deposit] PayFast did not validate this ITN", {
          validateText,
          paymentReference,
        });
        return new Response("Validation failed", { status: 400 });
      }
    } catch (err) {
      console.error(
        "[PayFast Deposit] Could not reach PayFast to validate — continuing on signature:",
        err,
      );
    }

    if (!paymentReference) {
      return new Response("Missing payment reference", { status: 400 });
    }

    const payfastStatus = (fields.payment_status ?? "").toUpperCase();
    const nextStatus =
      payfastStatus === "COMPLETE"
        ? "completed"
        : payfastStatus === "CANCELLED" || payfastStatus === "FAILED"
          ? "failed"
          : "pending";

    const { data: paymentRow, error } = await supabase
      .from("payments")
      .update({
        status: nextStatus,
        paid_at: new Date().toISOString(),
        provider_payload: {
          source: "payfast_deposit_edge",
          event: "itn",
          received_at: new Date().toISOString(),
          data: body,
        },
      })
      .eq("provider_reference", paymentReference)
      .eq("method", "payfast")
      .select("booking_id")
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!paymentRow) {
      // Not worth failing on: PayFast retries, and a 500 here would make it
      // retry a notification that will never match anything.
      console.warn("[PayFast Deposit] No matching payment row", {
        paymentReference,
      });
      return new Response("OK", { status: 200 });
    }

    // Flip the linked booking's deposit_paid on a completed deposit. The
    // deposit_paid=false guard makes this idempotent against PayFast's
    // documented ITN retries — a second identical COMPLETE matches 0 rows and
    // no-ops instead of re-running any side effects.
    if (nextStatus === "completed" && paymentRow.booking_id) {
      const { error: bookingError } = await supabase
        .from("bookings")
        .update({ deposit_paid: true, pending_expires_at: null })
        .eq("id", paymentRow.booking_id)
        .eq("deposit_paid", false);

      if (bookingError) {
        console.error(
          "[PayFast Deposit] Failed to mark booking deposit_paid:",
          bookingError,
        );
      }
    }

    console.log("[PayFast Deposit] Processed", {
      paymentReference,
      nextStatus,
      bookingId: paymentRow.booking_id,
    });
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[PayFast Deposit] Unhandled error:", err);
    return new Response("Could not process PayFast notification", {
      status: 500,
    });
  }
});
