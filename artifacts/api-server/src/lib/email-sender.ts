import { logger } from "./logger";

/**
 * Thin SendGrid wrapper for transactional client emails (booking confirmations,
 * reminders, cancellations). Mirrors how whatsapp-ai.ts talks to Cerebras: a
 * single fetch to an HTTP API keyed off an env var, no SDK.
 *
 * Stage 1 — Qwickly-domain sending only:
 *   Every email goes out From the verified Qwickly address (EMAIL_FROM_ADDRESS),
 *   with the display name "<business> via Qwickly", and Reply-To set to the
 *   business's own email so customer replies reach the provider directly. The
 *   customer's own domain is never used in From yet — that's Stage 2.
 *
 * Config (both required to send):
 *   SENDGRID_API_KEY   — from sendgrid.com (Settings → API Keys, "Mail Send").
 *                        The send happens on SendGrid's trusted IPs.
 *   EMAIL_FROM_ADDRESS — verified sender on the Qwickly domain, e.g.
 *                        "bookings@qwickly.co.za". The domain must be
 *                        DNS-authenticated in SendGrid (SPF/DKIM) or receivers
 *                        will spam-folder / reject the mail.
 *   EMAIL_FROM_NAME    — base brand name for the From display (default "Qwickly").
 *                        A per-business name is prefixed onto it →
 *                        "Glow Salon via Qwickly".
 *
 * The notification worker owns retry/backoff; this module just sends or throws.
 */

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";
const DEFAULT_FROM_NAME = "Qwickly";

/** Subject line per notification_type; falls back to a generic booking subject. */
const SUBJECTS: Record<string, string> = {
  booking_confirmations: "Your booking",
  reminder_24h: "Reminder: your upcoming appointment",
  reminder_2h: "Your appointment is in 2 hours",
  review_requests: "How was your visit?",
  cancellation_notices: "Your booking has been cancelled",
  rescheduling_alerts: "Your booking has been rescheduled",
};

export function subjectForType(notificationType: string): string {
  return SUBJECTS[notificationType] ?? "An update about your booking";
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env["SENDGRID_API_KEY"] && process.env["EMAIL_FROM_ADDRESS"]);
}

type SendEmailArgs = {
  to: string;
  subject: string;
  /** Plain-text body — the same message text already rendered for WhatsApp. */
  text: string;
  /** Optional business name; becomes "<fromName> via Qwickly" as the From display. */
  fromName?: string;
  /** Optional Reply-To (the business's own email) so customer replies reach them. */
  replyTo?: string;
  /**
   * Stage 2: a full From address on the business's own VERIFIED custom domain
   * (e.g. "bookings@salon.co.za"). When present, mail is sent from that address
   * with a plain "<business>" display name (no "via Qwickly", since it's their
   * own domain). Callers must only pass this for a verified domain — this module
   * trusts it. Falls back to the Qwickly address when absent/invalid.
   */
  fromOverride?: string;
  /**
   * Optional "Manage booking" link (the per-booking magic link). When present a
   * button is rendered in the HTML and the URL appended to the plain-text body,
   * so the customer can cancel/reschedule from the email.
   */
  manageUrl?: string;
};

export async function sendEmail({ to, subject, text, fromName, replyTo, fromOverride, manageUrl }: SendEmailArgs): Promise<void> {
  const apiKey = process.env["SENDGRID_API_KEY"];
  const from = buildFrom(process.env["EMAIL_FROM_ADDRESS"], fromName, fromOverride);
  if (!apiKey || !from) {
    // Thrown before any network call — the worker treats "not configured" as
    // retryable, so queued rows wait rather than fail once the key is set.
    throw new Error("Email provider not configured");
  }

  const plainText = manageUrl ? `${text}\n\nManage your booking: ${manageUrl}` : text;

  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: to }] }],
    from,
    subject,
    content: [
      { type: "text/plain", value: plainText },
      { type: "text/html", value: renderHtml(subject, text, manageUrl) },
    ],
  };

  const replyToAddress = sanitizeAddress(replyTo);
  if (replyToAddress) {
    body["reply_to"] = { email: replyToAddress };
  }

  const res = await fetch(SENDGRID_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // SendGrid returns 202 Accepted on success (empty body).
  if (res.status !== 202) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`SendGrid send failed (${res.status}): ${errBody.slice(0, 300)}`);
  }

  logger.debug({ to, subject }, "[Email] Sent via SendGrid");
}

/**
 * Build the SendGrid From object.
 *
 * Stage 2 — when `fromOverride` is a valid address on the business's own verified
 * domain, send from it with a plain "<business>" name (no "via Qwickly", it's
 * genuinely their domain).
 *
 * Stage 1 (default) — send from the verified Qwickly address (only that domain
 * can send, so the address never changes) with a "<business> via Qwickly" name,
 * or just the base brand name when no business name is supplied.
 */
function buildFrom(
  envAddress: string | undefined,
  fromName?: string,
  fromOverride?: string,
): { email: string; name: string } | null {
  const baseName = (process.env["EMAIL_FROM_NAME"] || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME;
  const business = fromName?.replace(/["<>\r\n]/g, "").trim();

  const customEmail = sanitizeAddress(fromOverride);
  if (customEmail) {
    return { email: customEmail, name: business || baseName };
  }

  const email = sanitizeAddress(envAddress);
  if (!email) return null;

  const name = business ? `${business} via ${baseName}` : baseName;
  return { email, name };
}

/** Trim an address and drop anything with header-breaking characters or no "@". */
function sanitizeAddress(value: string | undefined): string | null {
  const trimmed = value?.replace(/[<>\r\n]/g, "").trim();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal branded HTML wrapper around the plain-text body. Self-contained, no external assets. */
function renderHtml(subject: string, text: string, manageUrl?: string): string {
  const body = escapeHtml(text).replace(/\n/g, "<br>");
  const manageButton = manageUrl
    ? `<div style="margin-top:20px;">
        <a href="${escapeHtml(manageUrl)}" style="display:inline-block;background:#42A324;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px;">Manage your booking</a>
        <p style="margin:10px 0 0;font-size:12px;color:#8a8f98;">Reschedule or cancel any time.</p>
      </div>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
      <div style="background:#42A324;padding:16px 24px;">
        <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.01em;">Qwickly</span>
      </div>
      <div style="padding:24px;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 16px;font-weight:600;">${escapeHtml(subject)}</p>
        <p style="margin:0;">${body}</p>
        ${manageButton}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #eef0f2;font-size:12px;color:#8a8f98;">
        Sent by Qwickly on behalf of your service provider.
      </div>
    </div>
  </body>
</html>`;
}
