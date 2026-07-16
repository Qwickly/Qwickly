import { Router, type Response } from "express";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";
import { getSupabaseAdmin, isSupabaseAdminConfigured } from "../lib/supabase";
import { hasGrant } from "../lib/entitlements";
import {
  createDomainAuthentication,
  validateDomainAuthentication,
  deleteDomainAuthentication,
  type DomainDnsRecord,
} from "../lib/sendgrid-domains";

/**
 * Stage 2 custom-domain routes. All mutations run server-side (service role)
 * because they carry the SendGrid API key and perform the SendGrid domain-auth
 * calls; owners only ever read their own row (via RLS + these GETs).
 */

const router = Router();

async function getBusinessForUser(userId: string): Promise<{ id: string }> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (error || !data) {
    throw new Error(error?.message || "Business not found");
  }
  return data as { id: string };
}

type EmailDomainRow = {
  id: string;
  domain: string;
  sendgrid_domain_id: number | null;
  dns_records: DomainDnsRecord[];
  from_local_part: string;
  status: "pending" | "verified" | "failed";
  last_error: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: EmailDomainRow) {
  return {
    id: row.id,
    domain: row.domain,
    dnsRecords: row.dns_records ?? [],
    fromLocalPart: row.from_local_part,
    fromAddress: `${row.from_local_part}@${row.domain}`,
    status: row.status,
    lastError: row.last_error,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Strip scheme/path/www and validate a bare registrable domain. */
function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  // At least two labels, letters/digits/hyphens, no leading/trailing hyphen.
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) return null;
  return d;
}

/** Sanitise a mailbox local part; empty falls back to "bookings". */
function normalizeLocalPart(input: unknown): string {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  const cleaned = raw.replace(/[^a-z0-9._-]/g, "");
  return cleaned || "bookings";
}

// The DB allows multiple rows per business (UNIQUE is on business_id+domain), but
// the MVP keeps a single active domain, so we take the most recent row. Using a
// limited list (not maybeSingle) means a stray second row can never throw here.
async function loadDomainRow(businessId: string): Promise<EmailDomainRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("email_domains")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data as EmailDomainRow[] | null)?.[0]) ?? null;
}

async function requireBrandedEmailAccess(businessId: string, res: Response): Promise<boolean> {
  if (await hasGrant(businessId, "branded_email")) return true;
  res.status(403).json({
    error: "Branded email sender is not included in your current plan",
  });
  return false;
}

// ── GET current custom domain (or null) ──────────────────────────────────────
router.get("/email/domain", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) return res.json({ domain: null });
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    const row = await loadDomainRow(business.id);
    return res.json({ domain: row ? mapRow(row) : null });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not load custom domain" });
  }
});

// ── POST register a custom domain (creates the SendGrid authentication) ───────
router.post("/email/domain", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!(await requireBrandedEmailAccess(business.id, res))) return;

    const domain = normalizeDomain(req.body?.domain);
    if (!domain) {
      return res.status(400).json({ error: "Enter a valid domain, e.g. salon.co.za" });
    }
    const fromLocalPart = normalizeLocalPart(req.body?.fromLocalPart);

    // MVP: one active domain per business. Remove any existing domain(s) first —
    // their SendGrid authentication (best-effort) and the DB row(s) — then insert
    // the new one. This enforces the single-active rule in code rather than with a
    // hard DB constraint, so the schema still allows changing domains over time.
    const existing = await loadDomainRow(business.id);
    if (existing?.sendgrid_domain_id) {
      try {
        await deleteDomainAuthentication(existing.sendgrid_domain_id);
      } catch (err) {
        // Non-fatal: log and continue so a stale SendGrid entry can't wedge the user.
        req.log.warn({ err }, "[Email Domain] Failed to remove previous SendGrid domain");
      }
    }
    if (existing) {
      const { error: delError } = await getSupabaseAdmin()
        .from("email_domains")
        .delete()
        .eq("business_id", business.id);
      if (delError) throw new Error(delError.message);
    }

    const created = await createDomainAuthentication(domain);

    const { data, error } = await getSupabaseAdmin()
      .from("email_domains")
      .insert({
        business_id: business.id,
        domain,
        sendgrid_domain_id: created.sendgridDomainId,
        dns_records: created.records,
        from_local_part: fromLocalPart,
        status: "pending",
        last_error: null,
        verified_at: null,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return res.json({ domain: mapRow(data as EmailDomainRow) });
  } catch (err) {
    req.log.error(err);
    const message = err instanceof Error ? err.message : "Could not register domain";
    // Surface SendGrid config problems (e.g. insufficient key scope) clearly.
    const isConfig = /SENDGRID_API_KEY|401|403/.test(message);
    return res.status(isConfig ? 502 : 500).json({
      error: isConfig
        ? "SendGrid rejected the request — check the API key has Sender Authentication access."
        : "Could not register domain",
    });
  }
});

// ── POST verify — ask SendGrid to re-check the DNS records ────────────────────
router.post("/email/domain/verify", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);
    if (!(await requireBrandedEmailAccess(business.id, res))) return;

    const row = await loadDomainRow(business.id);
    if (!row?.sendgrid_domain_id) {
      return res.status(404).json({ error: "No custom domain to verify" });
    }

    const result = await validateDomainAuthentication(row.sendgrid_domain_id);
    const status = result.valid ? "verified" : "failed";
    const lastError = result.valid
      ? null
      : "Some DNS records are not resolving yet. DNS changes can take up to 48 hours.";

    const { data, error } = await getSupabaseAdmin()
      .from("email_domains")
      .update({
        status,
        last_error: lastError,
        verified_at: result.valid ? new Date().toISOString() : null,
      })
      .eq("id", row.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return res.json({ domain: mapRow(data as EmailDomainRow), valid: result.valid });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not verify domain" });
  }
});

// ── DELETE detach the custom domain (reverts to Qwickly-domain sending) ───────
router.delete("/email/domain", requireUser, async (req, res) => {
  try {
    if (!isSupabaseAdminConfigured()) {
      return res.status(503).json({ error: "Supabase is not configured" });
    }
    const user = (req as AuthenticatedRequest).user;
    const business = await getBusinessForUser(user.id);

    const row = await loadDomainRow(business.id);
    if (!row) return res.json({ ok: true });

    if (row.sendgrid_domain_id) {
      try {
        await deleteDomainAuthentication(row.sendgrid_domain_id);
      } catch (err) {
        req.log.warn({ err }, "[Email Domain] Failed to remove SendGrid domain on detach");
      }
    }

    const { error } = await getSupabaseAdmin()
      .from("email_domains")
      .delete()
      .eq("id", row.id);
    if (error) throw new Error(error.message);

    return res.json({ ok: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Could not remove domain" });
  }
});

export default router;
