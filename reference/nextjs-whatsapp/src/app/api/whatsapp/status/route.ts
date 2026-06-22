import { NextResponse } from "next/server";
import {
  fetchEvolutionInstanceStatus,
  requireTenantContext,
  toWhatsappStatusResponse,
  type WhatsappSessionRow,
} from "@/lib/whatsapp";

export async function GET() {
  try {
    const { supabase, tenantId } = await requireTenantContext();

    const { data: session, error: sessionError } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle<WhatsappSessionRow>();

    if (sessionError) throw new Error(sessionError.message);
    if (!session) {
      return NextResponse.json(
        {
          status: "disconnected",
          instanceId: null,
          qrCode: null,
          connectedPhone: null,
          updatedAt: null,
        },
      );
    }

    const liveStatus = await fetchEvolutionInstanceStatus(session).catch(() => session.status);
    const { data: updatedSession, error: updateError } = await supabase
      .from("whatsapp_sessions")
      .update({
        status: liveStatus,
        qr_code: liveStatus === "connected" ? null : session.qr_code,
      })
      .eq("id", session.id)
      .select("*")
      .single<WhatsappSessionRow>();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json(toWhatsappStatusResponse(updatedSession));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not fetch WhatsApp status";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
