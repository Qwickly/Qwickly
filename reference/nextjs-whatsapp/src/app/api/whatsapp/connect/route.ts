import { NextResponse } from "next/server";
import {
  createEvolutionInstance,
  fetchEvolutionInstanceStatus,
  requireTenantContext,
  toWhatsappStatusResponse,
  type WhatsappSessionRow,
} from "@/lib/whatsapp";

export async function POST() {
  try {
    const { supabase, tenantId } = await requireTenantContext();

    const { data: existingSession, error: sessionError } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle<WhatsappSessionRow>();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    if (existingSession) {
      const liveStatus = await fetchEvolutionInstanceStatus(existingSession).catch(() => existingSession.status);
      const { data: updatedSession, error: updateError } = await supabase
        .from("whatsapp_sessions")
        .update({
          status: liveStatus,
          qr_code: liveStatus === "connected" ? null : existingSession.qr_code,
        })
        .eq("id", existingSession.id)
        .select("*")
        .single<WhatsappSessionRow>();

      if (updateError) throw new Error(updateError.message);
      return NextResponse.json(toWhatsappStatusResponse(updatedSession));
    }

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
    const instanceName = `tenant-${tenantId}`;
    const created = await createEvolutionInstance(instanceName, webhookUrl);

    const { data: insertedSession, error: insertError } = await supabase
      .from("whatsapp_sessions")
      .insert({
        tenant_id: tenantId,
        instance_id: created.instanceId,
        instance_token: created.instanceToken,
        status: created.qrCode ? "qrcode" : "disconnected",
        qr_code: created.qrCode,
      })
      .select("*")
      .single<WhatsappSessionRow>();

    if (insertError) throw new Error(insertError.message);

    return NextResponse.json(toWhatsappStatusResponse(insertedSession));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not initialize WhatsApp connection";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
