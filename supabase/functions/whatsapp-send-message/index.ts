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
  
  console.log("sendWhatsAppMessage calling Meta API", { 
    url, 
    phoneNumberId,
    toPhone: payload?.to,
    messageType: payload?.type,
    messageBody: payload?.text?.body || payload?.image?.caption || "[image]"
  });
  
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

  console.log("sendWhatsAppMessage Meta API response", { 
    status: response.status,
    statusText: response.statusText,
    hasMessageId: !!json?.messages?.[0]?.id,
    messageId: json?.messages?.[0]?.id,
    waId: json?.contacts?.[0]?.wa_id,
    error: json?.error?.message || json?.error,
    errorDetails: json?.error?.details,
    warnings: json?.warning || json?.warnings
  });

  if (!response.ok) {
    console.error("WhatsApp API send failed", { 
      status: response.status, 
      statusText: response.statusText,
      errorCode: json?.error?.code,
      errorMessage: json?.error?.message,
      errorDetails: json?.error?.details,
      errorUserTitle: json?.error?.error_user_title,
      errorUserMsg: json?.error?.error_user_msg,
      fullError: json?.error,
      responseText 
    });
    return {
      success: false,
      error: json?.error?.message || json?.error || response.statusText || "WhatsApp API send failed",
      payload: json,
    };
  }

  // Check for warnings even on success
  if (json?.warning) {
    console.warn("WhatsApp API returned warning", { 
      warning: json.warning,
      messageId: json?.messages?.[0]?.id
    });
  }

  console.log("WhatsApp API send successful", { 
    messageId: json?.messages?.[0]?.id,
    contacts: json?.contacts,
    messagingProduct: json?.messaging_product
  });
  
  return {
    success: true,
    payload: json,
  };
}

async function validatePhoneNumberId(id: string, accessToken: string, apiVersion: string) {
  try {
    const url = `https://graph.facebook.com/${apiVersion}/${id}?fields=id,display_phone_number,status,quality_rating`;
    console.log("validatePhoneNumberId checking", { id, url });
    
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    
    const text = await res.text().catch(() => "");
    let json: any;
    try { json = JSON.parse(text); } catch {}
    
    const result = {
      isValid: res.ok,
      status: json?.status,
      displayPhoneNumber: json?.display_phone_number,
      qualityRating: json?.quality_rating,
      error: json?.error?.message
    };
    
    console.log("validatePhoneNumberId response", { 
      status: res.status,
      phoneNumberId: id,
      ...result
    });
    
    return result;
  } catch (err) {
    console.error("validatePhoneNumberId error", err);
    return { isValid: false, error: String(err) };
  }
}

async function resolvePhoneNumberIdFromWaba(wabaId: string, accessToken: string, apiVersion: string) {
  try {
    const url = `https://graph.facebook.com/${apiVersion}/${wabaId}?fields=id,name,status,phone_numbers{id,display_phone_number,status}`;
    console.log("resolvePhoneNumberIdFromWaba checking", { wabaId, url });
    
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    const text = await res.text().catch(() => "");
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    
    if (!res.ok) {
      console.warn("resolvePhoneNumberIdFromWaba lookup failed", { 
        wabaId, 
        status: res.status, 
        error: json?.error?.message,
        body: json ?? text 
      });
      return null;
    }
    
    console.log("resolvePhoneNumberIdFromWaba found", {
      wabaId,
      wabaName: json?.name,
      wabaStatus: json?.status,
      phoneNumbersCount: json?.phone_numbers?.data?.length,
      phoneNumbers: json?.phone_numbers?.data?.map((pn: any) => ({
        id: pn.id,
        display: pn.display_phone_number,
        status: pn.status
      }))
    });
    
    const phoneNumbers = json?.phone_numbers?.data;
    if (Array.isArray(phoneNumbers) && phoneNumbers.length > 0) {
      return String(phoneNumbers[0].id);
    }
    return null;
  } catch (err) {
    console.error("resolvePhoneNumberIdFromWaba error", err);
    return null;
  }
}

/**
 * Normalize phone number to E.164-like numeric string using a default country code.
 * - strips non-digits
 * - if number starts with leading 0, replaces it with the default country code
 * - if number already starts with the country code, leaves it
 * - does NOT add a + sign (Graph API expects digits only)
 */
function normalizePhone(input: string, defaultCountry = "27") {
  const digits = String(input || "").replace(/\D+/g, "");
  if (!digits) return "";

  // If already starts with default country code, return
  if (digits.startsWith(defaultCountry)) return digits;

  // If starts with leading zero, drop it and prepend country
  if (digits.startsWith("0")) {
    return defaultCountry + digits.slice(1);
  }

  // If it's a local number without leading zero but length suggests local (e.g., 9-10 digits), prepend
  if (digits.length <= 10) {
    return defaultCountry + digits;
  }

  // Otherwise return digits (best-effort)
  return digits;
}

async function markClientAsMetaApiStatus(
  supabase: SupabaseClient,
  businessId: string,
  phone: string,
) {
  const normalizedPhone = normalizePhone(phone, Deno.env.get("DEFAULT_COUNTRY_CODE") || "27");
  if (!businessId || !normalizedPhone) {
    return;
  }

  const phoneVariants = [normalizedPhone];
  if (normalizedPhone.startsWith("27")) {
    phoneVariants.push(`+${normalizedPhone}`);
  }
  if (normalizedPhone.startsWith("0")) {
    phoneVariants.push(`27${normalizedPhone.slice(1)}`);
  }
  if (normalizedPhone.length === 9) {
    phoneVariants.push(`27${normalizedPhone}`);
  }

  const uniquePhones = [...new Set(phoneVariants.filter(Boolean))];

  const { data: matchingClients, error: selectError } = await supabase
    .from("clients")
    .select("id")
    .eq("business_id", businessId)
    .in("phone", uniquePhones);

  if (selectError) {
    console.warn("Failed to resolve client for api status update", {
      businessId,
      phone: normalizedPhone,
      error: selectError.message,
    });
    return;
  }

  const ids = (matchingClients ?? []).map((row: { id: string }) => row.id).filter(Boolean);
  if (ids.length === 0) {
    console.warn("No matching client found for api status update", {
      businessId,
      phone: normalizedPhone,
      phoneVariants: uniquePhones,
    });
    return;
  }

  const { error: updateError } = await supabase
    .from("clients")
    .update({ status: "api" })
    .in("id", ids);

  if (updateError) {
    console.warn("Failed to mark client as api via Meta send", {
      businessId,
      phone: normalizedPhone,
      error: updateError.message,
    });
  } else {
    console.log("Marked client as api via Meta send", {
      businessId,
      phone: normalizedPhone,
      clientIds: ids,
    });
  }
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

    const cleanedPhone = normalizePhone(phone, Deno.env.get("DEFAULT_COUNTRY_CODE") || "27");
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

    // Ensure we are using a valid phone_number_id (not a WABA id)
    let phoneNumberId: string | null = connection.phone_number_id || null;
    const accessToken = connection.access_token;
    const wabaId = connection.whatsapp_business_account_id || null;

    const diagnostics: any = {
      cleanedPhone,
      initial_phone_number_id: connection.phone_number_id ?? null,
      whatsapp_business_account_id: wabaId ?? null,
      phoneNumberId_resolved: null,
      phoneNumberId_valid_before: false,
      phoneNumberId_valid_after: false,
      used_phone_number_id: null,
      phoneNumberId_display: null,
      phoneNumberId_status: null,
      phoneNumberId_quality: null,
    };

    diagnostics.phoneNumberId_valid_before = phoneNumberId ? Boolean(await validatePhoneNumberId(phoneNumberId, accessToken, apiVersion)) : false;
    let validationResult = phoneNumberId ? await validatePhoneNumberId(phoneNumberId, accessToken, apiVersion) : null;
    if (validationResult) {
      diagnostics.phoneNumberId_display = validationResult.displayPhoneNumber;
      diagnostics.phoneNumberId_status = validationResult.status;
      diagnostics.phoneNumberId_quality = validationResult.qualityRating;
      diagnostics.phoneNumberId_valid_before = validationResult.isValid;
    }
    let isValid = diagnostics.phoneNumberId_valid_before;
    if (!isValid && wabaId) {
      // Try resolving a phone_number_id from the WABA
      const resolved = await resolvePhoneNumberIdFromWaba(wabaId, accessToken, apiVersion);
      if (resolved) {
        diagnostics.phoneNumberId_resolved = resolved;
        phoneNumberId = resolved;
        // Persist the resolved phone_number_id for future sends
        try {
          await supabase.from("meta_whatsapp_connections").update({ phone_number_id: phoneNumberId }).eq("business_id", business.id);
        } catch (err) {
          console.warn("Failed to persist resolved phone_number_id", err);
        }
        isValid = true;
      }
    }

    diagnostics.phoneNumberId_valid_after = isValid;
    if (!phoneNumberId || !isValid) {
      console.error("No valid phone_number_id available. connection:", connection, diagnostics);
      return new Response(
        JSON.stringify({ success: false, error: "No valid phone_number_id available for this Meta WhatsApp connection", diagnostics }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    diagnostics.used_phone_number_id = phoneNumberId;

    console.log("whatsapp-send-message diagnostics", diagnostics);
    
    // Log a warning if phone number region doesn't match recipient region
    if (diagnostics.phoneNumberId_valid_before && diagnostics.phoneNumberId_display) {
      // Extract country code from recipient phone (first 1-3 digits)
      const recipientCountryCode = cleanedPhone.substring(0, 3);
      const senderCountryCode = diagnostics.phoneNumberId_display.replace(/\D+/g, "").substring(0, 3);
      
      if (recipientCountryCode !== senderCountryCode) {
        console.warn("⚠️  REGIONAL MISMATCH - Messages may not deliver", {
          senderPhoneNumber: diagnostics.phoneNumberId_display,
          senderCountryCode,
          recipientPhone: cleanedPhone,
          recipientCountryCode,
          qualityRating: diagnostics.phoneNumberId_quality,
          status: diagnostics.phoneNumberId_status,
          SOLUTION: "Use a phone number from the same region as the recipient (e.g., use a South African +27 number to send to South African numbers)"
        });
      }
    }

    const result = await sendWhatsAppMessage(phoneNumberId, accessToken, payload, apiVersion);
    
    console.log("whatsapp-send-message result", { 
      success: result.success, 
      messageId: result?.payload?.messages?.[0]?.id,
      error: result?.error,
      metaPayload: result?.payload 
    });

    // Persist the send attempt for auditing and delivery troubleshooting
    try {
      await supabase.from("meta_whatsapp_messages").insert({
        business_id: business.id,
        phone_number_id: phoneNumberId,
        to_phone: cleanedPhone,
        message_id: result?.payload?.messages?.[0]?.id ?? null,
        success: result.success,
        response_payload: result.payload ?? null,
      });
      console.log("whatsapp-send-message persisted to database", { 
        success: result.success,
        messageId: result?.payload?.messages?.[0]?.id,
        toPhone: cleanedPhone 
      });
    } catch (err) {
      console.warn("Failed to persist meta_whatsapp_messages row", err);
    }

    if (result.success) {
      await markClientAsMetaApiStatus(supabase, business.id, cleanedPhone);
    }

    const responseBody = { ...result, diagnostics };
    console.log("whatsapp-send-message response ready", { 
      status: result.success ? 200 : 500,
      success: result.success 
    });
    
    return new Response(
      JSON.stringify(responseBody),
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
