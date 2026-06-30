/**
 * Official Qwickly outbound channel ("Qwickly Notify").
 *
 * This is the PLATFORM's own WhatsApp sender — distinct from the per-tenant
 * whatsapp-web.js sessions in whatsapp.ts. It exists so Qwickly can ping a
 * business owner ("3 replies waiting for approval") from a single official
 * number, instead of the owner having to watch the WhatsApp Hub.
 *
 * Why the Meta WhatsApp Cloud API (and not another whatsapp-web.js session):
 * business-INITIATED notifications to many businesses are exactly the pattern
 * that gets unofficial automated numbers banned. The Cloud API is purpose-built
 * for this and governs sending via pre-approved templates + rate tiers, so the
 * blocking risk goes away.
 *
 * A key Cloud API rule shapes this interface: outside the 24-hour customer
 * service window (which an owner alert always is, since WE initiate it), you may
 * only send a PRE-APPROVED TEMPLATE with ordered parameters — never free text.
 * So a send carries both:
 *   - templateParams: ordered body variables for the approved utility template
 *     (what the live CloudApiSender actually transmits), and
 *   - renderedText:   a human-readable rendering used by the dev LogOnlySender
 *     and stored on the queue row for history/UI.
 *
 * Until the Qwickly number clears Meta Business verification and the template is
 * approved, getOfficialSender() returns the LogOnlySender so the whole pipeline
 * (worker, batching, throttle) can be built and tested locally. Set the
 * QWICKLY_WABA_* env vars to switch to live sending — no code change.
 */

import { logger } from "./logger";

export type PlatformNotificationSend = {
  /** Recipient MSISDN: digits only, international form, no leading "+". */
  toPhone: string;
  /** Human-readable message; used by LogOnlySender and persisted for history. */
  renderedText: string;
  /** Ordered body variables for the approved Cloud API template. */
  templateParams: string[];
  /** Template to use; falls back to the sender's configured default when null. */
  templateName?: string | null;
};

export type PlatformNotificationResult = {
  /** Meta wamid (or null for the log sender). Stored for delivery tracing. */
  providerMessageId: string | null;
};

export interface OfficialSender {
  /** Identifies which sender produced a row; persisted as platform_whatsapp_notifications.channel. */
  readonly channel: string;
  sendNotification(message: PlatformNotificationSend): Promise<PlatformNotificationResult>;
}

// ── Cloud API configuration (all-or-nothing) ─────────────────────────────────

type CloudApiConfig = {
  phoneNumberId: string;
  token: string;
  templateName: string;
  apiVersion: string;
  templateLang: string;
};

function readCloudApiConfig(): CloudApiConfig | null {
  const phoneNumberId = process.env["QWICKLY_WABA_PHONE_NUMBER_ID"]?.trim();
  const token = process.env["QWICKLY_WABA_TOKEN"]?.trim();
  const templateName = process.env["QWICKLY_WABA_TEMPLATE_NAME"]?.trim();

  // Live sending needs all three. Anything missing → fall back to the log sender.
  if (!phoneNumberId || !token || !templateName) {
    return null;
  }

  return {
    phoneNumberId,
    token,
    templateName,
    apiVersion: process.env["QWICKLY_WABA_API_VERSION"]?.trim() || "v21.0",
    templateLang: process.env["QWICKLY_WABA_TEMPLATE_LANG"]?.trim() || "en",
  };
}

function digitsOnly(phone: string): string {
  return (phone ?? "").replace(/\D+/g, "");
}

// ── Meta WhatsApp Cloud API sender ───────────────────────────────────────────

class CloudApiSender implements OfficialSender {
  readonly channel = "cloud_api";
  private readonly config: CloudApiConfig;

  constructor(config: CloudApiConfig) {
    this.config = config;
  }

  async sendNotification(message: PlatformNotificationSend): Promise<PlatformNotificationResult> {
    const to = digitsOnly(message.toPhone);
    if (!to) {
      throw new Error("Platform notification has no valid recipient phone number");
    }

    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: message.templateName?.trim() || this.config.templateName,
        language: { code: this.config.templateLang },
        components: [
          {
            type: "body",
            parameters: message.templateParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Surface Meta's error so the worker can decide retry vs. permanent.
      const detail = await response.text().catch(() => "");
      throw new Error(`Cloud API send failed: ${response.status} ${response.statusText} ${detail}`.trim());
    }

    const json = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ id?: string }>;
    };
    return { providerMessageId: json.messages?.[0]?.id ?? null };
  }
}

// ── Dev / not-yet-live sender ────────────────────────────────────────────────

class LogOnlySender implements OfficialSender {
  readonly channel = "log";

  async sendNotification(message: PlatformNotificationSend): Promise<PlatformNotificationResult> {
    logger.info(
      { toPhone: message.toPhone, text: message.renderedText },
      "[Qwickly Notify] (log sender) notification — set QWICKLY_WABA_* to send for real",
    );
    return { providerMessageId: null };
  }
}

// ── Factory / channel selection ──────────────────────────────────────────────
//
// The official channel is chosen globally via QWICKLY_OFFICIAL_CHANNEL so the
// platform can run on whatsapp-web.js early and "flip" to the Cloud API as it
// grows — a one-line config change, no code change:
//   'auto' (default) : Cloud API if QWICKLY_WABA_* configured, else log.
//                       (Future: fall back to whatsapp_web when a platform
//                       session is provisioned, before falling back to log.)
//   'cloud_api'       : force Cloud API; falls back to log if not configured.
//   'whatsapp_web'    : platform whatsapp-web.js sender — NOT BUILT YET. Selects
//                       log for now (see the seam below).
//   'log'             : always the dev log sender.

type OfficialChannel = "auto" | "cloud_api" | "whatsapp_web" | "log";

function readSelectedChannel(): OfficialChannel {
  const raw = process.env["QWICKLY_OFFICIAL_CHANNEL"]?.trim().toLowerCase();
  if (raw === "cloud_api" || raw === "whatsapp_web" || raw === "log") return raw;
  return "auto";
}

let cachedSender: OfficialSender | null = null;

/**
 * Resolve the official sender per QWICKLY_OFFICIAL_CHANNEL. Cached after first
 * resolution. To add the whatsapp-web.js channel later: implement a
 * WhatsAppWebSender (delegating to whatsapp.ts sendTenantMessageByPhone for a
 * reserved platform "system tenant", sending message.renderedText as free text)
 * and return it from the 'whatsapp_web' / 'auto' branches below.
 */
export function getOfficialSender(): OfficialSender {
  if (cachedSender) return cachedSender;

  const channel = readSelectedChannel();
  const cloudConfig = readCloudApiConfig();

  if (channel === "log") {
    cachedSender = new LogOnlySender();
  } else if (channel === "whatsapp_web") {
    // Seam: platform whatsapp-web.js sender not built yet — log for now.
    logger.warn("[Qwickly Notify] QWICKLY_OFFICIAL_CHANNEL=whatsapp_web is not implemented yet; using log sender");
    cachedSender = new LogOnlySender();
  } else if (channel === "cloud_api") {
    if (!cloudConfig) {
      logger.warn("[Qwickly Notify] QWICKLY_OFFICIAL_CHANNEL=cloud_api but QWICKLY_WABA_* is not configured; using log sender");
    }
    cachedSender = cloudConfig ? new CloudApiSender(cloudConfig) : new LogOnlySender();
  } else {
    // 'auto': Cloud API when configured, else log. (Future: whatsapp_web here.)
    cachedSender = cloudConfig ? new CloudApiSender(cloudConfig) : new LogOnlySender();
  }

  logger.info(
    { selected: channel, channel: cachedSender.channel },
    "[Qwickly Notify] official sender initialised",
  );
  return cachedSender;
}

/** True when the resolved official channel sends for real (i.e. not log-only). */
export function isOfficialSenderLive(): boolean {
  return getOfficialSender().channel !== "log";
}
