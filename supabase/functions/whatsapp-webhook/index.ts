import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") || "qwickly2026";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env for webhook function");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

serve(async (req) => {
  const url = new URL(req.url);

  // Verification handshake
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const bodyText = await req.text();
  let json: any = null;
  try {
    json = JSON.parse(bodyText);
  } catch (err) {
    console.error("whatsapp-webhook: invalid JSON", err);
    return new Response("Bad Request", { status: 400 });
  }

  // Normalize entries/changes
  const entries = Array.isArray(json?.entry) ? json.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const ch of changes) {
      const value = ch?.value ?? {};

      // Handle status updates (message_status)
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const st of statuses) {
        const msgId = st?.id;
        if (!msgId) continue;
        const status = st?.status ?? null;
        const recipient = st?.recipient_id ?? st?.recipient ?? null;

        try {
          // Try updating existing row
          const { data: updated, error: updateError } = await supabase
            .from("meta_whatsapp_messages")
            .update({
              response_payload: st,
              success: status === "delivered" || status === "read",
            })
            .eq("message_id", msgId);

          if (updateError) {
            console.warn("webhook: failed to update meta_whatsapp_messages", updateError);
          }

          // If no row was updated, insert a new audit row
          if (!updated || (Array.isArray(updated) && updated.length === 0)) {
            const insertRow: any = {
              message_id: msgId,
              to_phone: recipient,
              success: status === "delivered" || status === "read",
              response_payload: st,
            };
            try {
              await supabase.from("meta_whatsapp_messages").insert(insertRow);
            } catch (err) {
              console.warn("webhook: failed to insert meta_whatsapp_messages", err);
            }
          }
        } catch (err) {
          console.error("webhook: error persisting status", err);
        }
      }

      // Optionally handle incoming messages (messages array) - store for audit
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const m of messages) {
        const inboundId = m?.id ?? null;
        const from = m?.from ?? null;
        const text = m?.text?.body ?? null;
        try {
          await supabase.from("meta_whatsapp_messages").insert({
            message_id: inboundId,
            to_phone: from,
            response_payload: m,
            success: true,
          });
        } catch (err) {
          // ignore insert errors
        }
      }
    }
  }

  return new Response("ok", { status: 200 });
});
