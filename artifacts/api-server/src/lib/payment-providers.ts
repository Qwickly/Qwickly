import { getSupabaseAdmin } from "./supabase";
import { logger } from "./logger";
import {
  PAYFAST_SANDBOX_URL,
  PAYFAST_SANDBOX_MERCHANT_ID,
  PAYFAST_SANDBOX_MERCHANT_KEY,
  PAYFAST_SANDBOX_PASSPHRASE,
} from "./payfast";

/**
 * Resolves which PayFast merchant a business actually sends payment requests
 * to. Falls back to Qwickly's shared sandbox test merchant when a business
 * hasn't connected (or has disconnected) their own — this is what keeps the
 * dashboard's "PayFast Sandbox Tester" button and all historical sandbox
 * payments working unmodified after this feature ships.
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
};

type CredentialsRow = {
  merchant_id: string | null;
  merchant_key: string | null;
  passphrase: string | null;
  mode: "sandbox" | "live";
  connected: boolean;
};

export async function resolvePayFastCredentials(
  businessId: string,
): Promise<ResolvedPayFastCredentials> {
  const fallback: ResolvedPayFastCredentials = {
    merchantId: PAYFAST_SANDBOX_MERCHANT_ID,
    merchantKey: PAYFAST_SANDBOX_MERCHANT_KEY,
    passphrase: PAYFAST_SANDBOX_PASSPHRASE,
    actionUrl: PAYFAST_SANDBOX_URL,
    isBusinessOwned: false,
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

    return {
      merchantId: row.merchant_id,
      merchantKey: row.merchant_key,
      passphrase: row.passphrase ?? "",
      actionUrl: row.mode === "live" ? PAYFAST_LIVE_URL : PAYFAST_SANDBOX_URL,
      isBusinessOwned: true,
    };
  } catch (err) {
    logger.error({ err, businessId }, "[PaymentProviders] Failed to resolve PayFast credentials — using sandbox fallback");
    return fallback;
  }
}
