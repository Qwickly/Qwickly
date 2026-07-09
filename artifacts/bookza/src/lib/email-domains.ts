import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";

/**
 * Client for the Stage 2 custom-domain routes on the api-server
 * (artifacts/api-server/src/routes/email-domains.ts). All the SendGrid work
 * happens server-side; the browser only reads status and triggers actions.
 */

export type EmailDomainRecord = {
  key: string;
  host: string;
  type: string;
  data: string;
  valid: boolean;
};

export type EmailDomain = {
  id: string;
  domain: string;
  dnsRecords: EmailDomainRecord[];
  fromLocalPart: string;
  fromAddress: string;
  status: "pending" | "verified" | "failed";
  lastError: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export async function fetchEmailDomain(): Promise<EmailDomain | null> {
  const res = await fetch(buildApiUrl("/api/email/domain"), {
    method: "GET",
    credentials: "include",
    headers: await authHeaders(),
  });
  const { domain } = await parse<{ domain: EmailDomain | null }>(res, "Could not load custom domain");
  return domain;
}

export async function registerEmailDomain(domain: string, fromLocalPart: string): Promise<EmailDomain> {
  const res = await fetch(buildApiUrl("/api/email/domain"), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(true),
    body: JSON.stringify({ domain, fromLocalPart }),
  });
  const result = await parse<{ domain: EmailDomain }>(res, "Could not register domain");
  return result.domain;
}

export async function verifyEmailDomain(): Promise<{ domain: EmailDomain; valid: boolean }> {
  const res = await fetch(buildApiUrl("/api/email/domain/verify"), {
    method: "POST",
    credentials: "include",
    headers: await authHeaders(),
  });
  return parse<{ domain: EmailDomain; valid: boolean }>(res, "Could not verify domain");
}

export async function deleteEmailDomain(): Promise<void> {
  const res = await fetch(buildApiUrl("/api/email/domain"), {
    method: "DELETE",
    credentials: "include",
    headers: await authHeaders(),
  });
  await parse<{ ok: boolean }>(res, "Could not remove domain");
}
