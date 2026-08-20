import { getSupabaseAdmin } from "./supabase";
import { logger } from "./logger";
import {
  PAYFAST_SANDBOX_URL,
  PAYFAST_SANDBOX_MERCHANT_ID,
  PAYFAST_SANDBOX_MERCHANT_KEY,
  PAYFAST_SANDBOX_PASSPHRASE,
} from "./payfast";

/**
 * Which PayFast merchant account a business's payments belong to.
 *
 * Two resolvers, deliberately: one strict, for anything that CREATES a payment,
 * which returns null rather than falling back — a business with no merchant
 * account must be told it cannot take payments, not quietly handed a sandbox
 * checkout that charges nobody. And one lenient, for VERIFYING an inbound ITN,
 * which keeps the shared sandbox passphrase so notifications for historical
 * sandbox payments still check out.
 *
 * The passphrase is not read from the row. It lives in Supabase Vault (see
 * migration 20260821090000) and comes back through a SECURITY DEFINER function
 * that only the service role may call, so a dump of these tables carries a
 * secret id rather than a signing secret.
 */

export const PAYFAST_LIVE_URL =
  process.env["PAYFAST_LIVE_URL"] ?? "https://www.payfast.co.za/eng/process";

export type ResolvedPayFastCredentials = {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  actionUrl: string;
  /** false when this is Qwickly's shared sandbox fallback, not the business's own account. */
  isBusinessOwned: boolean;
  /** Which PayFast environment this merchant transacts against. */
  isSandbox: boolean;
};

/** Where to POST an ITN back to, to ask PayFast whether it really sent it. */
export function payFastValidateUrl(isSandbox: boolean): string {
  return isSandbox
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";
}

type CredentialsRow = {
  merchant_id: string | null;
  merchant_key: string | null;
  /**
   * Legacy plaintext column, nulled by the vault migration. Read only as a
   * fallback so a server running ahead of the migration keeps working.
   */
  passphrase: string | null;
  mode: "sandbox" | "live";
  connected: boolean;
};

/**
 * The merchant's PayFast passphrase, decrypted through the vault.
 *
 * PayFast treats the passphrase as optional, so an empty string is a valid
 * answer and not an error — it means "sign without one".
 */
export async function readPayFastPassphrase(businessId: string): Promise<string> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("get_payfast_passphrase", {
      p_business_id: businessId,
    });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? "";
  } catch (err) {
    logger.error(
      { err, businessId },
      "[PaymentProviders] Vault read failed for PayFast passphrase",
    );
    return "";
  }
}

/** Stores (or clears) the passphrase in the vault. */
export async function writePayFastPassphrase(
  businessId: string,
  passphrase: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("set_payfast_passphrase", {
    p_business_id: businessId,
    p_passphrase: passphrase,
  });
  if (error) throw new Error(error.message);
}

/**
 * The business's own credentials, or null when it has never connected an
 * account. Use this anywhere a payment is being CREATED — a booking deposit, a
 * WhatsApp payment link — so that a business without a merchant account is told
 * it cannot take payments rather than quietly taking fake ones.
 */
export async function resolveMerchantPayFastCredentials(
  businessId: string,
): Promise<ResolvedPayFastCredentials | null> {
  const credentials = await resolvePayFastCredentials(businessId);
  return credentials.isBusinessOwned ? credentials : null;
}

/**
 * Credentials for VERIFYING an inbound ITN, falling back to the shared sandbox
 * passphrase so notifications for historical sandbox payments still check out.
 *
 * Never use this to build a checkout: see resolveMerchantPayFastCredentials.
 */
export async function resolvePayFastCredentials(
  businessId: string,
): Promise<ResolvedPayFastCredentials> {
  const fallback: ResolvedPayFastCredentials = {
    merchantId: PAYFAST_SANDBOX_MERCHANT_ID,
    merchantKey: PAYFAST_SANDBOX_MERCHANT_KEY,
    passphrase: PAYFAST_SANDBOX_PASSPHRASE,
    actionUrl: PAYFAST_SANDBOX_URL,
    isBusinessOwned: false,
    isSandbox: true,
  };

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("payment_provider_credentials")
      .select("merchant_id, merchant_key, passphrase, mode, connected")
      .eq("business_id", businessId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const row = data as CredentialsRow | null;
    if (!row?.connected || !row.merchant_id || !row.merchant_key) {
      return fallback;
    }

    // Vault first; the legacy column is only still consulted so a server that
    // starts before the migration lands does not sign with an empty passphrase.
    const vaultPassphrase = await readPayFastPassphrase(businessId);

    return {
      merchantId: row.merchant_id,
      merchantKey: row.merchant_key,
      passphrase: vaultPassphrase || row.passphrase || "",
      actionUrl: row.mode === "live" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL,
      isBusinessOwned: true,
      isSandbox: row.mode !== "live",
    };
  } catch (err) {
    logger.error({ err, businessId }, "[PaymentProviders] Failed to resolve PayFast credentials — using sandbox fallback");
    return fallback;
  }
}
