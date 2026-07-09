import { logger } from "./logger";

/**
 * SendGrid domain-authentication (a.k.a. "whitelabel") admin calls — the Stage 2
 * custom-domain backend. Separate from email-sender.ts, which only *sends* mail:
 * this module *provisions* a customer's own sending domain.
 *
 * These endpoints need a SendGrid API key with **Sender Authentication** access
 * (the Stage 1 "Mail Send"-only key is NOT sufficient). Same main SendGrid
 * account — per-tenant subusers are Stage 3.
 *
 * Docs: https://docs.sendgrid.com/api-reference/domain-authentication
 */

const WHITELABEL_BASE = "https://api.sendgrid.com/v3/whitelabel/domains";

/** A single DNS record the customer must add at their DNS provider. */
export type DomainDnsRecord = {
  /** Human label for which record this is (e.g. "dkim1", "mail_cname"). */
  key: string;
  host: string;
  type: string;
  data: string;
  valid: boolean;
};

export type CreatedDomain = {
  sendgridDomainId: number;
  records: DomainDnsRecord[];
};

export type ValidateResult = {
  valid: boolean;
  /** Per-record validity, so the UI can show which record is still wrong. */
  records: DomainDnsRecord[];
};

function requireApiKey(): string {
  const key = process.env["SENDGRID_API_KEY"];
  if (!key) throw new Error("SENDGRID_API_KEY not configured");
  return key;
}

async function sgFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${WHITELABEL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `${res.status}: ${body.slice(0, 300)}`;
}

/**
 * SendGrid returns DNS records as a keyed object, e.g.
 *   { mail_cname: { host, type, data, valid }, dkim1: {...}, dkim2: {...} }
 * Flatten to an array while keeping the key as a label for display.
 */
function flattenDns(dns: Record<string, unknown> | undefined): DomainDnsRecord[] {
  if (!dns || typeof dns !== "object") return [];
  return Object.entries(dns).map(([key, raw]) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      key,
      host: String(r["host"] ?? ""),
      type: String(r["type"] ?? ""),
      data: String(r["data"] ?? ""),
      valid: Boolean(r["valid"]),
    };
  });
}

/**
 * Register a domain for authentication. `automatic_security: true` makes SendGrid
 * hand back three CNAMEs (2× DKIM + return-path) — the simplest records for a
 * customer to add. Returns the SendGrid domain id (persist it) and the records
 * to display.
 */
export async function createDomainAuthentication(domain: string): Promise<CreatedDomain> {
  const res = await sgFetch("", {
    method: "POST",
    body: JSON.stringify({ domain, automatic_security: true }),
  });
  if (!res.ok) {
    throw new Error(`SendGrid create domain failed (${await errorText(res)})`);
  }
  const json = (await res.json()) as { id: number; dns?: Record<string, unknown> };
  logger.info({ domain, sendgridDomainId: json.id }, "[SendGrid] Domain authentication created");
  return { sendgridDomainId: json.id, records: flattenDns(json.dns) };
}

/**
 * Ask SendGrid to re-check the DNS records for an existing authentication. This
 * is what the "Verify" button triggers. `valid` is only true once every record
 * resolves correctly at the customer's DNS provider.
 */
export async function validateDomainAuthentication(sendgridDomainId: number): Promise<ValidateResult> {
  const res = await sgFetch(`/${sendgridDomainId}/validate`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`SendGrid validate domain failed (${await errorText(res)})`);
  }
  const json = (await res.json()) as {
    valid: boolean;
    validation_results?: Record<string, { valid?: boolean; reason?: string | null }>;
  };

  const results = json.validation_results ?? {};
  const records: DomainDnsRecord[] = Object.entries(results).map(([key, r]) => ({
    key,
    host: "",
    type: "",
    // On failure SendGrid puts the human-readable problem in `reason`.
    data: r?.reason ?? "",
    valid: Boolean(r?.valid),
  }));

  return { valid: Boolean(json.valid), records };
}

/** Remove a domain authentication from SendGrid (when a business detaches its domain). */
export async function deleteDomainAuthentication(sendgridDomainId: number): Promise<void> {
  const res = await sgFetch(`/${sendgridDomainId}`, { method: "DELETE" });
  // 204 on success; a 404 means it's already gone, which is fine for our purpose.
  if (!res.ok && res.status !== 404) {
    throw new Error(`SendGrid delete domain failed (${await errorText(res)})`);
  }
}
