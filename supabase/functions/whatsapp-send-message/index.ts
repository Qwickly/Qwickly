import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

type SendMessageRequest = {
  phone: string;
  message?: string;
  imageUrl?: string;
  messagePayload?: Record<string, unknown>;
};

type MetaWhatsappConnection = {
  phone_number_id: string;
  access_token: string;
  whatsapp_business_account_id: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function getAuthToken(req: Request): string | null {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authHeader.slice(7).trim();
}

async function getSupabaseClient(): Promise<SupabaseClient> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getUserId(supabase: SupabaseClient, token: string): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    console.error("Supabase auth failed", error);
    return null;
  }
  return data.user.id;
}

function buildTextPayload(toPhoneNumber: string, message: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhoneNumber,
    type: "text",
    text: {
      preview_url: true,
      body: message,
    },
  };
}

function buildImagePayload(toPhoneNumber: string, imageUrl: string, caption?: string) {
  const payload: any = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toPhoneNumber,
    type: "image",
    image: {
      link: imageUrl,
    },
  };

  if (caption) {
    payload.image.caption = String(caption).slice(0, 1024);
  }

  return payload;
}

async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  payload: any,
  apiVersion: string,
) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text().catch(() => "");
  let json: any;
  try {
    json = JSON.parse(responseText);
  } catch {
    json = null;
  }

  if (!response.ok) {
    console.error("WhatsApp API send failed", { status: response.status, responseText });
    return {
      success: false,
      error: json?.error?.message || json?.error || response.statusText || "WhatsApp API send failed",
      payload: json,
    };
  }

  return {
    success: true,
    payload: json,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const token = getAuthToken(req);
    if (!token) {
      return new Response(
        JSON.stringify({ success: false, error: "Authorization token is required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = await getSupabaseClient();
    const userId = await getUserId(supabase, token);
    if (!userId) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: SendMessageRequest = await req.json().catch(() => ({} as SendMessageRequest));
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : undefined;
    const messagePayload = body.messagePayload;

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!message && !imageUrl && !messagePayload) {
      return new Response(
        JSON.stringify({ success: false, error: "Message or imageUrl or messagePayload is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId)
      .single();

    if (businessError || !business) {
      console.error("Business not found for user", { userId, businessError });
      return new Response(
        JSON.stringify({ success: false, error: "Business not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: connection, error: connectionError } = await supabase
      .from("meta_whatsapp_connections")
      .select("phone_number_id, access_token, whatsapp_business_account_id")
      .eq("business_id", business.id)
      .single();

    if (connectionError || !connection) {
      console.error("Meta WhatsApp connection missing", { businessId: business.id, connectionError });
      return new Response(
        JSON.stringify({ success: false, error: "Meta WhatsApp API connection not configured" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cleanedPhone = String(phone).replace(/\D+/g, "");
    if (!cleanedPhone) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid phone number" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiVersion = Deno.env.get("WHATSAPP_CLOUD_API_VERSION") || "v17.0";

    let payload: any;
    if (messagePayload && typeof messagePayload === "object") {
      payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanedPhone,
        ...messagePayload,
      };
    } else if (imageUrl) {
      payload = buildImagePayload(cleanedPhone, imageUrl, message || undefined);
    } else {
      payload = buildTextPayload(cleanedPhone, message || "");
    }

    const result = await sendWhatsAppMessage(
      connection.phone_number_id,
      connection.access_token,
      payload,
      apiVersion,
    );

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error: any) {
    console.error("whatsapp-send-message error", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unexpected server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
