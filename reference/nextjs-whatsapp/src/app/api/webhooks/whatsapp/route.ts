import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { mapEvolutionStateToStatus, type WhatsappSessionRow } from "@/lib/whatsapp";

type EvolutionWebhookPayload = {
  event?: string;
  instance?: string;
  instanceId?: string;
  data?: {
    instance?: string;
    instanceId?: string;
    state?: string;
    connection?: string;
    key?: {
      id?: string;
      remoteJid?: string;
    };
    pushName?: string;
    messageType?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: {
        text?: string;
      };
    };
  };
};

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function getInstanceId(payload: EvolutionWebhookPayload): string | null {
  return payload.instanceId ?? payload.instance ?? payload.data?.instanceId ?? payload.data?.instance ?? null;
}

function getMessageText(payload: EvolutionWebhookPayload): string {
  return payload.data?.message?.conversation ?? payload.data?.message?.extendedTextMessage?.text ?? "";
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("x-webhook-secret");
    if (process.env.EVOLUTION_WEBHOOK_SECRET && authHeader !== process.env.EVOLUTION_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const payload = (await request.json()) as EvolutionWebhookPayload;
    const event = payload.event ?? "";
    const instanceId = getInstanceId(payload);

    if (!instanceId) {
      return NextResponse.json({ error: "Missing instance id" }, { status: 400 });
    }

    const { data: session, error: sessionError } = await admin
      .from("whatsapp_sessions")
      .select("*")
      .eq("instance_id", instanceId)
      .maybeSingle<WhatsappSessionRow>();

    if (sessionError) throw new Error(sessionError.message);
    if (!session) {
      return NextResponse.json({ ok: true });
    }

    if (event === "connection.update") {
      const nextStatus = mapEvolutionStateToStatus(payload.data?.state ?? payload.data?.connection ?? null);

      const { error: updateError } = await admin
        .from("whatsapp_sessions")
        .update({
          status: nextStatus,
          qr_code: nextStatus === "connected" ? null : session.qr_code,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      if (updateError) throw new Error(updateError.message);
      return NextResponse.json({ ok: true });
    }

    if (event === "messages.upsert") {
      const { error: insertError } = await admin
        .from("inbound_messages")
        .insert({
          tenant_id: session.tenant_id,
          whatsapp_session_id: session.id,
          instance_id: session.instance_id,
          message_id: payload.data?.key?.id ?? null,
          remote_jid: payload.data?.key?.remoteJid ?? "unknown",
          sender_name: payload.data?.pushName ?? null,
          message_type: payload.data?.messageType ?? "text",
          text_body: getMessageText(payload),
          payload,
        });

      if (insertError) throw new Error(insertError.message);

      return NextResponse.json({
        ok: true,
        revalidate: [`tenant:${session.tenant_id}:messages`],
      });
    }

    return NextResponse.json({ ok: true, ignored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
