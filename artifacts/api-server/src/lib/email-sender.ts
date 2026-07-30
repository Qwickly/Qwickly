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
  // Client-facing
  booking_confirmations: "Your booking is confirmed",
  reminder_24h: "Reminder: your upcoming appointment",
  reminder_2h: "Your appointment is in 2 hours",
  review_requests: "How was your visit?",
  cancellation_notices: "Your booking has been cancelled",
  rescheduling_alerts: "Your booking has been rescheduled",
  // Staff-facing
  new_booking: "New booking assigned to you",
  reschedule: "A booking has been rescheduled",
  cancellation: "A booking has been cancelled",
  daily_summary: "Your schedule for today",
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
  /** Optional raw HTML body for marketing campaigns or richer email templates. */
  html?: string;
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
  /** Business's brand colour (hex) for the email header + buttons. Defaults to Qwickly green. */
  brandColor?: string;
  /**
   * White-label the email: drop the "Powered by Qwickly" footer. Set when sending
   * from a business's own verified custom domain — that's the paid tier, so the
   * Qwickly watermark only rides along on free Qwickly-domain sends.
   */
  whiteLabel?: boolean;
};

export async function sendEmail({
  to,
  subject,
  text,
  html,
  fromName,
  replyTo,
  fromOverride,
  manageUrl,
  brandColor,
  whiteLabel,
}: SendEmailArgs): Promise<void> {
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
      {
        type: "text/html",
        value: html
          ? html
          : renderHtml(subject, text, {
              manageUrl,
              brandName: fromName,
              brandColor,
              whiteLabel,
            }),
      },
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

type RenderOptions = {
  manageUrl?: string;
  brandName?: string;
  brandColor?: string;
  whiteLabel?: boolean;
};

/** Accept only a valid hex colour for inline styles (guards against CSS injection). */
function safeColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : DEFAULT_BRAND_COLOR;
}

// Matches the "Qwickly primary brand colour" used in the Supabase auth emails
// (confirm-email, magic link, etc.) — keeping the two systems visually
// consistent is the whole point, since customers see both.
const DEFAULT_BRAND_COLOR = "#29BC86";

// Public bucket asset already referenced by the Supabase auth email templates
// (see supabase/migrations for the auth email HTML). Swap this if a
// dedicated email-optimized logo gets uploaded later.
const LOGO_URL =
  "https://kzfixfcatknkkqttnvvi.supabase.co/storage/v1/object/public/public-assets/qwickly-logo-2.png";

/**
 * Branded HTML wrapper around the plain-text body. Deliberately mirrors the
 * Supabase auth email templates (confirm-email, magic link) — rounded card,
 * brand accent bar, same button treatment — so a customer who gets both a
 * Qwickly auth email and a Qwickly booking email doesn't see two different
 * products. Self-contained, no external assets beyond the one logo image;
 * table-based layout for Outlook/desktop-mail-client compatibility.
 *
 * The message body itself is NOT business-customizable (see notification-worker
 * / the 049 migration trigger) — the wording is fixed on purpose, so a business
 * typing something that breaks the layout isn't a risk here. Only `brandColor`
 * (and fromName/fromOverride/whiteLabel, handled elsewhere) vary per business.
 */
function renderHtml(subject: string, text: string, opts: RenderOptions = {}): string {
  const body = escapeHtml(text).replace(/\n/g, "<br>");
  const color = safeColor(opts.brandColor);
  const brand = escapeHtml((opts.brandName || DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME);
  const heading = escapeHtml(subject);
  const preheader = escapeHtml(subject);

  const manageButton = opts.manageUrl
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td align="center" style="padding-top:8px;padding-bottom:8px;">
            <!--[if mso]>
              <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(opts.manageUrl)}" style="height:48px;v-text-anchor:middle;width:220px;" arcsize="16%" strokecolor="${color}" fillcolor="${color}">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">Manage your booking</center>
              </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${escapeHtml(opts.manageUrl)}" style="display:inline-block;box-sizing:border-box;min-width:200px;padding:14px 28px;background-color:${color};border:1px solid ${color};border-radius:9px;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-align:center;">Manage your booking</a>
            <!--<![endif]-->
            <p style="margin:10px 0 0;font-size:12px;color:#87928c;">Reschedule or cancel any time.</p>
          </td>
        </tr>
      </table>`
    : "";

  // Free (Qwickly-domain) sends carry a subtle watermark; white-label (paid custom
  // domain) sends drop it entirely.
  const footer = opts.whiteLabel
    ? ""
    : `<p style="margin:0;color:#9aa49f;font-size:11px;line-height:1.6;">Powered by Qwickly</p>`;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<title>${heading}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0;mso-table-rspace:0;}
  table{border-collapse:collapse !important;}
  img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
  body{width:100% !important;margin:0 !important;padding:0 !important;}
  a{text-decoration:none;}
  @media screen and (max-width:600px){
    .email-shell{width:100% !important;}
    .email-card{border-radius:16px !important;}
    .content-padding{padding:32px 24px !important;}
    .heading{font-size:22px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f3fbf8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3fbf8;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="email-shell" width="560" cellspacing="0" cellpadding="0" border="0" style="width:560px;max-width:560px;">
          <tr>
            <td align="center" style="padding:0 0 28px;">
              <img src="${LOGO_URL}" width="130" alt="${brand}" style="display:block;width:130px;max-width:130px;height:auto;margin:0 auto;">
            </td>
          </tr>
          <tr>
            <td class="email-card" style="overflow:hidden;background-color:#ffffff;border:1px solid #d9f3e9;border-radius:20px;box-shadow:0 10px 30px rgba(41,188,134,0.12);">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="height:5px;padding:0;background-color:${color};font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="content-padding" style="padding:40px 40px 36px;">
                    <p class="heading" style="margin:0 0 16px;color:#10231c;font-size:24px;font-weight:700;line-height:1.3;letter-spacing:-0.4px;text-align:center;">${heading}</p>
                    <p style="margin:0 auto;max-width:420px;color:#53635b;font-size:15px;line-height:1.7;text-align:center;">${body}</p>
                    ${manageButton}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 20px 0;">
              <p style="margin:0 0 8px;color:#718078;font-size:12px;line-height:1.6;">
                Need help? <a href="mailto:support@qwickly.co.za" style="color:#19815f;font-weight:600;">Contact ${brand} Support</a>
              </p>
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
