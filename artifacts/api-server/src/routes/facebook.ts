import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { getSupabaseAdmin } from "../lib/supabase";
import { requireUser, type AuthenticatedRequest } from "../middleware/require-user";

const router = Router();
const OAuthVersion = process.env.FACEBOOK_OAUTH_API_VERSION ?? "v16.0";
const graphApiVersion = process.env.WHATSAPP_CLOUD_API_VERSION ?? "v17.0";

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getRedirectUri(req: Request): string {
  return (
    process.env.FACEBOOK_OAUTH_REDIRECT_URI ||
    `${req.protocol}://${req.get("host")}/api/facebook/callback`
  );
}

function requireStateSecret(): string {
  return process.env.FACEBOOK_OAUTH_STATE_SECRET ?? getEnv("FACEBOOK_OAUTH_APP_SECRET");
}

function base64urlEncode(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function base64urlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signState(payload: Record<string, unknown>): string {
  const encoded = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const secret = requireStateSecret();
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest();
  return `${encoded}.${base64urlEncode(signature)}`;
}

function verifyState(state: string): { userId: string; exp: number } {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid OAuth state parameter");
  }

  const secret = requireStateSecret();
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();

  const signatureBuffer = base64urlDecode(signature);
  if (signatureBuffer.length !== expected.length || !crypto.timingSafeEqual(signatureBuffer, expected)) {
    throw new Error("OAuth state validation failed");
  }

  const payload = JSON.parse(base64urlDecode(encoded).toString("utf8")) as {
    userId: string;
    exp: number;
  };

  if (!payload?.userId || typeof payload.exp !== "number") {
    throw new Error("Invalid OAuth state payload");
  }

  if (payload.exp < Date.now()) {
    throw new Error("OAuth state has expired");
  }

  return payload;
}

function setNoCacheHeaders(res: Response) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
}

async function getBusinessForUser(userId: string): Promise<{ id: string } | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("businesses")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string } | null;
}

function htmlResponse(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Meta WhatsApp Connect</title></head><body>${body}</body></html>`;
}

function renderPostMessageScript(payload: { success: boolean; message: string }) {
  const escapedMessage = payload.message
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  const pagePayload = {
    success: payload.success,
    message: escapedMessage,
  };

  return htmlResponse(`
    <script>
      const payload = ${JSON.stringify(pagePayload)};
      let posted = false;

      try {
        const message = {
          type: "MetaWhatsAppOAuthResponse",
          success: payload.success,
          error: payload.success ? null : payload.message,
        };

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(message, "*");
          posted = true;
        }
      } catch (error) {
        console.error("Failed to post OAuth response to opener", error);
      }

      const htmlContent =
        '<div style="font-family: system-ui, sans-serif; padding: 1rem;">' +
        '<h1 style="margin-bottom: 0.75rem;">' + (payload.success ? "Connected" : "Connection failed") + '</h1>' +
        '<p style="white-space: pre-wrap;">' + payload.message + '</p>' +
        '<p style="color: #666; margin-top: 1rem;">This window will close automatically.</p>' +
        '</div>';

      document.body.innerHTML = htmlContent;

      if (posted) {
        window.close();
      } else {
        setTimeout(() => window.close(), 1500);
      }
    </script>
  `);
}


function extractWhatsappConnectionData(metaResponse: any): {
  whatsappBusinessAccountId: string | null;
  phoneNumberId: string | null;
} {
  const businesses = metaResponse?.businesses?.data;
  if (!Array.isArray(businesses)) {
    return { whatsappBusinessAccountId: null, phoneNumberId: null };
  }

  for (const business of businesses) {
    const accounts =
      business?.owned_whatsapp_business_accounts?.data ??
      business?.whatsapp_business_accounts?.data;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      continue;
    }

    const account = accounts[0];
    const whatsappBusinessAccountId = String(account?.id || account?.whatsapp_business_account_id || "").trim() || null;
    const phoneNumbers = account?.phone_numbers?.data;
    const phoneNumberId = Array.isArray(phoneNumbers) && phoneNumbers.length > 0
      ? String(phoneNumbers[0]?.id || "").trim() || null
      : null;

    if (whatsappBusinessAccountId) {
      return { whatsappBusinessAccountId, phoneNumberId };
    }
  }

  return { whatsappBusinessAccountId: null, phoneNumberId: null };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const appId = getEnv("FACEBOOK_OAUTH_APP_ID");
  const appSecret = getEnv("FACEBOOK_OAUTH_APP_SECRET");
  const tokenUrl = new URL(`https://graph.facebook.com/${OAuthVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("grant_type", "fb_exchange_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await fetch(tokenUrl.toString());
  const payload: any = await response.json().catch(() => null);
  if (!response.ok || !(payload && typeof payload.access_token === "string")) {
    return shortLivedToken;
  }

  return String(payload.access_token);
}

router.get("/facebook/config", requireUser, async (req, res) => {
  try {
    setNoCacheHeaders(res);

    const appId = getEnv("FACEBOOK_OAUTH_APP_ID");
    const redirectUri = getRedirectUri(req);
    const user = (req as AuthenticatedRequest).user;

    const state = signState({
      userId: user.id,
      exp: Date.now() + 5 * 60 * 1000,
    });

    const authUrl = new URL(`https://www.facebook.com/${OAuthVersion}/dialog/oauth`);
    authUrl.searchParams.set("client_id", appId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "whatsapp_business_management,whatsapp_business_messaging");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("auth_type", "rerequest");

    return res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not build Facebook OAuth config";
    return res.status(500).json({ error: message });
  }
});

router.get("/facebook/callback", async (req, res) => {
  try {
    setNoCacheHeaders(res);

    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    const appId = getEnv("FACEBOOK_OAUTH_APP_ID");
    const appSecret = getEnv("FACEBOOK_OAUTH_APP_SECRET");
    const redirectUri = getRedirectUri(req);

    if (!code) {
      throw new Error("Missing authorization code from Facebook");
    }

    const statePayload = verifyState(state);
    const businessUserId = statePayload.userId;

    const tokenRequestUrl = new URL(`https://graph.facebook.com/${OAuthVersion}/oauth/access_token`);
    tokenRequestUrl.searchParams.set("client_id", appId);
    tokenRequestUrl.searchParams.set("redirect_uri", redirectUri);
    tokenRequestUrl.searchParams.set("client_secret", appSecret);
    tokenRequestUrl.searchParams.set("code", code);

    const tokenResponse = await fetch(tokenRequestUrl.toString());
    const tokenPayload: any = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !(tokenPayload && typeof tokenPayload.access_token === "string")) {
      const errorMessage =
        (tokenPayload && tokenPayload.error && tokenPayload.error.message) ||
        JSON.stringify(tokenPayload) ||
        "Failed to exchange Facebook authorization code";
      throw new Error(errorMessage);
    }

    let accessToken = String(tokenPayload.access_token);
    accessToken = await exchangeForLongLivedToken(accessToken);

    const profileUrl = new URL(`https://graph.facebook.com/${OAuthVersion}/me`);
    profileUrl.searchParams.set("fields", "businesses{owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number}}}");
    profileUrl.searchParams.set("access_token", accessToken);

    const profileResponse = await fetch(profileUrl.toString());
    const profilePayload: any = await profileResponse.json().catch(() => null);
    if (!profileResponse.ok || !profilePayload) {
      const errorMessage =
        (profilePayload && profilePayload.error && profilePayload.error.message) ||
        JSON.stringify(profilePayload) ||
        "Failed to fetch Facebook business data";
      throw new Error(errorMessage);
    }

    const { whatsappBusinessAccountId, phoneNumberId: initialPhoneNumberId } = extractWhatsappConnectionData(profilePayload);
    if (!whatsappBusinessAccountId) {
      throw new Error("No WhatsApp Business Account found in Facebook response.");
    }

    let phoneNumberId = initialPhoneNumberId;
    if (!phoneNumberId) {
      const lookupUrl = new URL(`https://graph.facebook.com/${OAuthVersion}/${whatsappBusinessAccountId}`);
      lookupUrl.searchParams.set("fields", "phone_numbers{id,display_phone_number}");
      lookupUrl.searchParams.set("access_token", accessToken);

      const lookupResponse = await fetch(lookupUrl.toString());
      const lookupPayload: any = await lookupResponse.json().catch(() => null);
      if (
        lookupResponse.ok &&
        Array.isArray(lookupPayload?.phone_numbers?.data) &&
        lookupPayload.phone_numbers.data.length > 0
      ) {
        phoneNumberId = String(lookupPayload.phone_numbers.data[0]?.id || "").trim() || null;
      }
    }

    if (!phoneNumberId) {
      throw new Error("No WhatsApp phone number was found for the connected WhatsApp Business Account.");
    }

    const validationUrl = new URL(`https://graph.facebook.com/${OAuthVersion}/${phoneNumberId}`);
    validationUrl.searchParams.set("fields", "id,display_phone_number");
    validationUrl.searchParams.set("access_token", accessToken);

    const validationResponse = await fetch(validationUrl.toString());
    const validationPayload: any = await validationResponse.json().catch(() => null);
    if (!validationResponse.ok || !(validationPayload && validationPayload.id)) {
      const errorMessage =
        (validationPayload && validationPayload.error && validationPayload.error.message) ||
        JSON.stringify(validationPayload) ||
        "Failed to validate WhatsApp phone number ID.";
      throw new Error(errorMessage);
    }

    const business = await getBusinessForUser(businessUserId);
    if (!business) {
      throw new Error("Business not found for connected user");
    }

    const supabase = getSupabaseAdmin();
    const { error: upsertError } = await (supabase as any)
      .from("meta_whatsapp_connections")
      .upsert(
        {
          business_id: business.id,
          phone_number_id: phoneNumberId,
          whatsapp_business_account_id: whatsappBusinessAccountId,
          access_token: accessToken,
          meta_app_id: appId,
        },
        { onConflict: "business_id" } as any,
      );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    return res.send(renderPostMessageScript({
      success: true,
      message: "Meta WhatsApp API connected successfully.",
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meta WhatsApp OAuth callback failed.";
    return res.status(400).send(renderPostMessageScript({ success: false, message }));
  }
});

export default router;
