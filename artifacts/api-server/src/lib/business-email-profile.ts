import { getSupabaseAdmin } from "./supabase";
import { hasGrant } from "./entitlements";
import { logger } from "./logger";

/**
 * Per-business email profile lookups shared by both email pipelines:
 * notification-worker.ts (transactional) and email-campaign-worker.ts
 * (marketing campaigns). Extracted so the two never drift on what counts as
 * a "verified" sending domain.
 */

const TTL_MS = 5 * 60_000;

// Business name/email feed the email's From display name and Reply-To.
// Name → "<business> via Qwickly"; email → Reply-To so customer replies
// reach the provider directly.
type BusinessContact = { name?: string; email?: string };
const businessContactCache = new Map<string, { contact: BusinessContact | null; expires: number }>();

export async function getBusinessContact(businessId: string): Promise<BusinessContact> {
  const cached = businessContactCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.contact ?? {};

  let contact: BusinessContact | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("businesses")
      .select("business_name, email")
      .eq("id", businessId)
      .maybeSingle();
    contact = {
      name: (data?.business_name as string | undefined)?.trim() || undefined,
      email: (data?.email as string | undefined)?.trim() || undefined,
    };
  } catch (err) {
    logger.error({ err }, "[Business Email Profile] Error getting business contact");
    return {}; // don't cache an error
  }

  businessContactCache.set(businessId, { contact, expires: Date.now() + TTL_MS });
  return contact ?? {};
}

// A business's VERIFIED custom sending domain (Stage 2), resolved to a full From
// address like "bookings@salon.co.za". Only a row with status='verified' counts —
// pending/failed domains must never send, so we filter on it here. Cached like
// the other per-business lookups. Returns undefined when there's no verified
// custom domain, which keeps Stage 1 Qwickly-domain sending for transactional
// email. Marketing campaigns treat "undefined" here as "not allowed to send" —
// see requireVerifiedDomainForCampaigns in email-campaigns.ts.
const senderDomainCache = new Map<string, { fromAddress: string | null; expires: number }>();

export async function getVerifiedSenderAddress(businessId: string): Promise<string | undefined> {
  if (!(await hasGrant(businessId, "branded_email"))) {
    return undefined;
  }

  const cached = senderDomainCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.fromAddress ?? undefined;

  let fromAddress: string | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("email_domains")
      .select("domain, from_local_part, status")
      .eq("business_id", businessId)
      .eq("status", "verified")
      .maybeSingle();
    if (data?.domain && data?.from_local_part) {
      fromAddress = `${data.from_local_part}@${data.domain}`;
    }
  } catch (err) {
    logger.error({ err }, "[Business Email Profile] Error getting verified sender domain");
    return undefined; // don't cache an error
  }

  senderDomainCache.set(businessId, { fromAddress, expires: Date.now() + TTL_MS });
  return fromAddress ?? undefined;
}

// The business's booking-page brand colour, used for the email header + button so
// the email matches their booking page. Cached like the other per-business lookups.
const brandColorCache = new Map<string, { color: string | null; expires: number }>();

export async function getBrandColor(businessId: string): Promise<string | undefined> {
  const cached = brandColorCache.get(businessId);
  if (cached && cached.expires > Date.now()) return cached.color ?? undefined;

  let color: string | null = null;
  try {
    const { data } = await getSupabaseAdmin()
      .from("booking_page_settings")
      .select("primary_color")
      .eq("business_id", businessId)
      // A business can have several pages, but only one online at a time.
      .eq("is_published", true)
      .maybeSingle();
    color = (data?.primary_color as string | undefined)?.trim() || null;
  } catch (err) {
    logger.error({ err }, "[Business Email Profile] Error getting brand color");
    return undefined; // don't cache an error
  }

  brandColorCache.set(businessId, { color, expires: Date.now() + TTL_MS });
  return color ?? undefined;
}
