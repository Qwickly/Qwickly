import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

/**
 * Client for the real per-business PayFast credential routes
 * (artifacts/api-server/src/routes/payment-providers.ts). Separate from the
 * older payment_provider_settings toggle (lib/settings.ts#savePaymentProviders)
 * — that one is a harmless placeholder for not-yet-available providers; this
 * one holds an actual merchant passphrase, so all reads/writes go through
 * these authenticated Express routes rather than direct Supabase calls.
 */

export type PayFastProviderConfig = {
  merchantId: string | null;
  merchantKeyMasked: string | null;
  hasPassphrase: boolean;
  mode: "sandbox" | "live";
  enabled: boolean;
  connected: boolean;
};

async function authHeaders(json = false): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parse<T>(res: Response, fallback: string): Promise<T> {
  const payload = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : fallback;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchPayFastConfig(): Promise<PayFastProviderConfig | null> {
  const res = await fetch(buildApiUrl("/api/payment-providers/payfast"), {
    method: "GET",
    credentials: "include",
    headers: await authHeaders(),
  });
  const { provider } = await parse<{ provider: PayFastProviderConfig | null }>(
    res,
    "Could not load PayFast settings",
  );
  return provider;
}

export async function savePayFastConfig(input: {
  merchantId: string;
  merchantKey: string;
  passphrase?: string;
  mode: "sandbox" | "live";
}): Promise<void> {
  const res = await fetch(buildApiUrl("/api/payment-providers/payfast"), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(true),
    body: JSON.stringify(input),
  });
  await parse<{ ok: boolean }>(res, "Could not save PayFast settings");
}

export async function disconnectPayFast(): Promise<void> {
  const res = await fetch(buildApiUrl("/api/payment-providers/payfast"), {
    method: "DELETE",
    credentials: "include",
    headers: await authHeaders(),
  });
  await parse<{ ok: boolean }>(res, "Could not remove PayFast settings");
}
