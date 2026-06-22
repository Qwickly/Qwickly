import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export type WhatsappSessionStatus = "qrcode" | "connected" | "disconnected";

export type WhatsappSessionRow = {
  id: string;
  tenant_id: string;
  instance_id: string;
  instance_token: string;
  status: WhatsappSessionStatus;
  qr_code: string | null;
  connected_phone: string | null;
  updated_at: string;
};

export type WhatsappStatusResponse = {
  status: WhatsappSessionStatus;
  instanceId: string | null;
  qrCode: string | null;
  connectedPhone: string | null;
  updatedAt: string | null;
};

type EvolutionInstanceCreateResponse = {
  instance?: {
    instanceId?: string;
    instanceName?: string;
    token?: string;
    qrcode?: {
      code?: string;
      base64?: string;
    };
  };
  qrcode?: {
    code?: string;
    base64?: string;
  };
};

type EvolutionConnectionStateResponse = {
  instance?: {
    state?: string;
  };
  state?: string;
  status?: string;
  connected?: boolean;
};

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    },
  );
}

export async function requireTenantContext() {
  const supabase = await createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    throw new Error("Unauthorized");
  }

  const { data: tenantId, error: tenantError } = await supabase.rpc("ensure_my_tenant");
  if (tenantError || !tenantId) {
    throw new Error(tenantError?.message ?? "Could not resolve tenant");
  }

  return { supabase, user: authData.user, tenantId: tenantId as string };
}

export function buildEvolutionHeaders(instanceToken?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: process.env.EVOLUTION_API_TOKEN!,
  };

  if (instanceToken) {
    headers.Authorization = `Bearer ${instanceToken}`;
  }

  return headers;
}

export async function evolutionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${process.env.EVOLUTION_API_URL}${path}`, init);
  const payload = (await response.json().catch(() => null)) as T | { message?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
        ? payload.message
        : `Evolution API request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function mapEvolutionStateToStatus(state: string | null | undefined): WhatsappSessionStatus {
  const normalized = state?.toLowerCase() ?? "";
  if (normalized.includes("open") || normalized.includes("connected")) return "connected";
  if (normalized.includes("qr")) return "qrcode";
  return "disconnected";
}

export function toWhatsappStatusResponse(session: Partial<WhatsappSessionRow> | null | undefined): WhatsappStatusResponse {
  return {
    status: session?.status ?? "disconnected",
    instanceId: session?.instance_id ?? null,
    qrCode: session?.qr_code ?? null,
    connectedPhone: session?.connected_phone ?? null,
    updatedAt: session?.updated_at ?? null,
  };
}

export async function createEvolutionInstance(instanceName: string, webhookUrl: string) {
  const payload = await evolutionFetch<EvolutionInstanceCreateResponse>("/instance/create", {
    method: "POST",
    headers: buildEvolutionHeaders(),
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: true,
        events: ["connection.update", "messages.upsert"],
      },
    }),
  });

  const instanceId = payload.instance?.instanceId ?? payload.instance?.instanceName ?? instanceName;
  const instanceToken = payload.instance?.token;
  const qrCode = payload.instance?.qrcode?.code ?? payload.instance?.qrcode?.base64 ?? payload.qrcode?.code ?? payload.qrcode?.base64 ?? null;

  if (!instanceId || !instanceToken) {
    throw new Error("Evolution API did not return an instance id or token");
  }

  return {
    instanceId,
    instanceToken,
    qrCode,
  };
}

export async function fetchEvolutionInstanceStatus(session: Pick<WhatsappSessionRow, "instance_id" | "instance_token">) {
  const payload = await evolutionFetch<EvolutionConnectionStateResponse>(
    `/instance/connectionState/${session.instance_id}`,
    {
      method: "GET",
      headers: buildEvolutionHeaders(session.instance_token),
    },
  );

  return mapEvolutionStateToStatus(payload.instance?.state ?? payload.state ?? payload.status ?? null);
}
