import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response("Server configuration error", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401, headers });
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return new Response("Invalid auth token", { status: 401, headers });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (businessError || !business) {
    return new Response("Business not found", { status: 404, headers });
  }

  let body;
  try {
    body = await req.json();
  } catch (error) {
    return new Response("Invalid JSON", { status: 400, headers });
  }

  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : null;
  const whatsappBusinessAccountId = typeof body.whatsappBusinessAccountId === "string"
    ? body.whatsappBusinessAccountId.trim()
    : null;
  const metaAppId = typeof body.metaAppId === "string" ? body.metaAppId.trim() : null;
  const embeddedSignupConfigId = typeof body.embeddedSignupConfigId === "string"
    ? body.embeddedSignupConfigId.trim()
    : null;

  if (!accessToken || !whatsappBusinessAccountId) {
    return new Response(
      "Missing required fields: accessToken and whatsappBusinessAccountId",
      { status: 400, headers },
    );
  }

  const { error: insertError } = await supabase
    .from("meta_whatsapp_connections")
    .upsert(
      {
        business_id: business.id,
        access_token: accessToken,
        whatsapp_business_account_id: whatsappBusinessAccountId,
        meta_app_id: metaAppId,
        embedded_signup_config_id: embeddedSignupConfigId,
      },
      { onConflict: ["business_id"] },
    );

  if (insertError) {
    console.error("Failed to save Meta WhatsApp connection", insertError);
    return new Response("Failed to save connection", { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
  });
});
