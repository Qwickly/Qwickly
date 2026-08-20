import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";
import type {
  BookingPolicy,
  Business,
  BusinessSettings,
  DepositSettings,
  NotificationSettings,
  OperatingHour,
  PaymentProviderKey,
  PaymentProviderSetting,
  TeamMember,
  TeamMemberInput,
  WhatsappSettings,
  Weekday,
} from "@/types/settings";
import { DEFAULT_BOOKING_POLICY, PAYMENT_PROVIDERS, WEEKDAYS } from "@/types/settings";

export type WhatsappSessionStatus = "qrcode" | "connected" | "disconnected";

export type WhatsappConnectionState = {
  status: WhatsappSessionStatus;
  instanceId: string | null;
  qrCode: string | null;
  connectedPhone: string | null;
  updatedAt: string | null;
};

async function getAuthenticatedRequestHeaders(extraHeaders?: HeadersInit): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  return {
    ...(extraHeaders ?? {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function timeToInput(value: string): string {
  return value?.slice(0, 5) ?? "08:00";
}

function timeToDb(value: string): string {
  if (!value) return "08:00:00";
  return value.length === 5 ? `${value}:00` : value;
}

function normalizeHour(row: OperatingHour): OperatingHour {
  return {
    ...row,
    open_time: timeToInput(row.open_time),
    close_time: timeToInput(row.close_time),
  };
}

function collectErrors(results: { error: { message: string } | null }[]): void {
  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    throw new Error(failed.map((r) => r.error!.message).join("; "));
  }
}

export async function ensureBusiness(): Promise<string> {
  // Team members (admin/user/viewer) are never businesses.user_id, so
  // ensure_my_business() below would wrongly create them a duplicate empty
  // business. Resolve their business via team_members first.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (userId) {
    const { data } = await supabase
      .from("team_members")
      .select("business_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.business_id) return data.business_id as string;
  }

  const { data, error } = await supabase.rpc("ensure_my_business");
  if (error) throw new Error(error.message);
  return data as string;
}

export async function fetchOpenDays(): Promise<string[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("business_operating_hours")
    .select("day_name, is_open")
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);
  return (data ?? []).filter((row) => row.is_open as boolean).map((row) => row.day_name as string);
}

export const WHATSAPP_CONNECTION_CHANGED = "bookza:whatsapp-connection-changed";

function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function normalizeWhatsappConnectionState(payload: Partial<WhatsappConnectionState> | null | undefined): WhatsappConnectionState {
  return {
    status: payload?.status ?? "disconnected",
    instanceId: payload?.instanceId ?? null,
    qrCode: payload?.qrCode ?? null,
    connectedPhone: payload?.connectedPhone ?? null,
    updatedAt: payload?.updatedAt ?? null,
  };
}

export function notifyWhatsappConnectionChanged(status: WhatsappSessionStatus): void {
  window.dispatchEvent(
    new CustomEvent(WHATSAPP_CONNECTION_CHANGED, { detail: { status } }),
  );
}

export async function fetchWhatsappConnectionStatus(): Promise<WhatsappConnectionState> {
  const headers = await getAuthenticatedRequestHeaders({
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
  });
  const cacheParam = `?_=${Date.now().toString()}`;
  const statusUrl = buildApiUrl(`/api/whatsapp/status${cacheParam}`);

  const response = await fetch(statusUrl, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers,
  });

  const payload = (await response.json().catch(() => null)) as Partial<WhatsappConnectionState> | { error?: string } | null;
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Failed to load WhatsApp status"));
  }

  return normalizeWhatsappConnectionState(payload as Partial<WhatsappConnectionState>);
}

export async function createWhatsappConnectionQr(force = false): Promise<WhatsappConnectionState> {
  const headers = await getAuthenticatedRequestHeaders({
    "Content-Type": "application/json",
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
  });

  const response = await fetch(buildApiUrl("/api/whatsapp/connect"), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers,
    body: JSON.stringify({ force }),
  });

  const payload = (await response.json().catch(() => null)) as Partial<WhatsappConnectionState> | { error?: string } | null;
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Failed to generate a WhatsApp QR code"));
  }

  return normalizeWhatsappConnectionState(payload as Partial<WhatsappConnectionState>);
}

export async function disconnectWhatsappConnection(): Promise<WhatsappConnectionState> {
  const headers = await getAuthenticatedRequestHeaders({
    "Content-Type": "application/json",
    Accept: "application/json",
    "Cache-Control": "no-cache, no-store, max-age=0",
    Pragma: "no-cache",
  });

  const response = await fetch(buildApiUrl("/api/whatsapp/disconnect"), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers,
  });

  const payload = (await response.json().catch(() => null)) as
    | Partial<WhatsappConnectionState>
    | { error?: string }
    | null;
  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Failed to disconnect WhatsApp"));
  }

  return normalizeWhatsappConnectionState(payload as Partial<WhatsappConnectionState>);
}

async function ensurePaymentProviders(
  businessId: string,
  existing: PaymentProviderSetting[],
): Promise<PaymentProviderSetting[]> {
  const byKey = new Map(existing.map((p) => [p.provider_key, p]));
  const missing = PAYMENT_PROVIDERS.filter((meta) => !byKey.has(meta.key));

  if (missing.length === 0) return existing;

  const { data, error } = await supabase
    .from("payment_provider_settings")
    .insert(
      missing.map((meta) => ({
        business_id: businessId,
        provider_key: meta.key,
        enabled: false,
        connected: false,
      })),
    )
    .select();

  if (error) throw new Error(error.message);
  return [...existing, ...(data as PaymentProviderSetting[])];
}

export type BusinessBasics = Pick<
  Business,
  "business_name" | "industry" | "phone" | "email" | "description"
>;

// Lean read/write for just the core business-identity fields — used by the
// Getting Started checklist's business-details step, which doesn't need the
// full BusinessSettings bundle (hours/notifications/deposits/whatsapp/team)
// that saveBusinessSettings() requires.
export async function fetchBusinessBasics(businessId: string): Promise<BusinessBasics> {
  const { data, error } = await supabase
    .from("businesses")
    .select("business_name, industry, phone, email, description")
    .eq("id", businessId)
    .single();
  if (error) throw new Error(error.message);
  return data as BusinessBasics;
}

export async function saveBusinessBasics(businessId: string, basics: BusinessBasics): Promise<void> {
  const { error } = await supabase.from("businesses").update(basics).eq("id", businessId);
  if (error) throw new Error(error.message);
}

export async function fetchBusinessSettings(businessId: string): Promise<BusinessSettings> {
  const [
    businessRes,
    hoursRes,
    notificationsRes,
    providersRes,
    depositsRes,
    whatsappRes,
    bookingPolicyRes,
    teamRes,
  ] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).single(),
    supabase.from("business_operating_hours").select("*").eq("business_id", businessId),
    supabase.from("notification_settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("payment_provider_settings").select("*").eq("business_id", businessId),
    supabase.from("deposit_settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("whatsapp_settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("booking_policies").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("team_members").select("*").eq("business_id", businessId).order("created_at"),
  ]);

  if (businessRes.error) throw new Error(businessRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (providersRes.error) throw new Error(providersRes.error.message);
  if (teamRes.error) throw new Error(teamRes.error.message);

  if (notificationsRes.error) throw new Error(notificationsRes.error.message);
  if (depositsRes.error) throw new Error(depositsRes.error.message);
  if (whatsappRes.error) throw new Error(whatsappRes.error.message);
  if (bookingPolicyRes.error) throw new Error(bookingPolicyRes.error.message);

  let notifications = notificationsRes.data as NotificationSettings | null;
  if (!notifications) {
    const { data, error } = await supabase
      .from("notification_settings")
      .upsert({ business_id: businessId }, { onConflict: "business_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    notifications = data as NotificationSettings;
  }

  let deposits = depositsRes.data as DepositSettings | null;
  if (!deposits) {
    const { data, error } = await supabase
      .from("deposit_settings")
      .upsert({ business_id: businessId }, { onConflict: "business_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    deposits = { ...(data as DepositSettings), deposit_amount: Number((data as DepositSettings).deposit_amount) };
  }

  let whatsapp = whatsappRes.data as WhatsappSettings | null;
  if (!whatsapp) {
    const { data, error } = await supabase
      .from("whatsapp_settings")
      .upsert({ business_id: businessId }, { onConflict: "business_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    whatsapp = data as WhatsappSettings;
  }

  const bp = bookingPolicyRes.data as Record<string, unknown> | null;
  const bookingPolicy: BookingPolicy = bp
    ? {
        acceptCancellations: bp["accept_cancellations"] as boolean,
        cancellationMinNoticeHours: bp["cancellation_min_notice_hours"] as number,
        cancellationDeclineMessage: (bp["cancellation_decline_message"] as string) ?? "",
        acceptReschedules: bp["accept_reschedules"] as boolean,
        rescheduleMinNoticeHours: bp["reschedule_min_notice_hours"] as number,
        rescheduleDeclineMessage: (bp["reschedule_decline_message"] as string) ?? "",
      }
    : DEFAULT_BOOKING_POLICY;

  const paymentProviders = await ensurePaymentProviders(
    businessId,
    (providersRes.data ?? []) as PaymentProviderSetting[],
  );

  const operatingHours = (hoursRes.data as OperatingHour[])
    .map(normalizeHour)
    .sort((a, b) => WEEKDAYS.indexOf(a.day_name as Weekday) - WEEKDAYS.indexOf(b.day_name as Weekday));

  const business = businessRes.data as Business;
  return {
    business: {
      ...business,
      onboarding_completed: business.onboarding_completed ?? false,
      onboarding_tabs_visited: Array.isArray(business.onboarding_tabs_visited)
        ? business.onboarding_tabs_visited
        : [],
    },
    operatingHours,
    notifications,
    paymentProviders,
    deposits: {
      ...deposits,
      deposit_amount: Number(deposits.deposit_amount),
    },
    whatsapp,
    bookingPolicy,
    teamMembers: teamRes.data as TeamMember[],
  };
}

/**
 * The week's opening times on their own, in weekday order.
 *
 * `fetchBusinessSettings` already returns these, but it pulls the whole settings
 * bundle — notifications, deposits, payment providers, team — to do it. The
 * onboarding hours step needs seven rows and nothing else.
 */
export async function fetchOperatingHours(): Promise<OperatingHour[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("business_operating_hours")
    .select("*")
    .eq("business_id", businessId);

  if (error) throw new Error(error.message);
  return (data as OperatingHour[])
    .map(normalizeHour)
    .sort((a, b) => WEEKDAYS.indexOf(a.day_name as Weekday) - WEEKDAYS.indexOf(b.day_name as Weekday));
}

export async function saveOperatingHours(hours: OperatingHour[]): Promise<void> {
  const results = await Promise.all(
    hours.map((h) =>
      supabase
        .from("business_operating_hours")
        .update({
          is_open: h.is_open,
          open_time: timeToDb(h.open_time),
          close_time: timeToDb(h.close_time),
        })
        .eq("id", h.id),
    ),
  );
  collectErrors(results);
}

export async function saveNotificationSettings(notifications: NotificationSettings): Promise<void> {
  const { business_id, ...fields } = notifications;
  const { error } = await supabase
    .from("notification_settings")
    .upsert({ business_id, ...fields }, { onConflict: "business_id" });
  if (error) throw new Error(error.message);
}

export async function savePaymentProviders(providers: PaymentProviderSetting[]): Promise<void> {
  const results = await Promise.all(
    providers.map((p) =>
      supabase
        .from("payment_provider_settings")
        .upsert(
          {
            id: p.id,
            business_id: p.business_id,
            provider_key: p.provider_key,
            enabled: p.enabled,
            connected: p.connected,
          },
          { onConflict: "id" },
        ),
    ),
  );
  collectErrors(results);
}

export async function saveWhatsappMessaging(whatsapp: WhatsappSettings): Promise<void> {
  const { error } = await supabase
    .from("whatsapp_settings")
    .update({
      reminder_lead_hours: whatsapp.reminder_lead_hours,
      reply_hours_mode: whatsapp.reply_hours_mode,
      include_service_name: whatsapp.include_service_name,
      include_staff_name: whatsapp.include_staff_name,
      send_confirmation_immediately: whatsapp.send_confirmation_immediately,
      allow_cancel_via_whatsapp: whatsapp.allow_cancel_via_whatsapp,
    })
    .eq("business_id", whatsapp.business_id);
  if (error) throw new Error(error.message);
}

export async function saveBusinessSettings(settings: BusinessSettings): Promise<void> {
  const { business, operatingHours, notifications, paymentProviders, deposits, whatsapp, bookingPolicy } = settings;

  const results = await Promise.all([
    supabase
      .from("businesses")
      .update({
        business_name: business.business_name,
        industry: business.industry,
        phone: business.phone,
        email: business.email,
        description: business.description,
        address: business.address,
        website_url: business.website_url,
      })
      .eq("id", business.id),
    supabase
      .from("deposit_settings")
      .upsert(
        {
          business_id: business.id,
          require_deposit: deposits.require_deposit,
          deposit_type: deposits.deposit_type,
          deposit_amount: deposits.deposit_amount,
        },
        { onConflict: "business_id" },
      ),
    supabase
      .from("whatsapp_settings")
      .upsert(
        {
          business_id: business.id,
          reminder_lead_hours: whatsapp.reminder_lead_hours,
          reply_hours_mode: whatsapp.reply_hours_mode,
          include_service_name: whatsapp.include_service_name,
          include_staff_name: whatsapp.include_staff_name,
          send_confirmation_immediately: whatsapp.send_confirmation_immediately,
          allow_cancel_via_whatsapp: whatsapp.allow_cancel_via_whatsapp,
        },
        { onConflict: "business_id" },
      ),
    supabase
      .from("booking_policies")
      .upsert(
        {
          business_id: business.id,
          accept_cancellations: bookingPolicy.acceptCancellations,
          cancellation_min_notice_hours: Math.max(0, Math.trunc(bookingPolicy.cancellationMinNoticeHours) || 0),
          cancellation_decline_message: bookingPolicy.cancellationDeclineMessage.trim(),
          accept_reschedules: bookingPolicy.acceptReschedules,
          reschedule_min_notice_hours: Math.max(0, Math.trunc(bookingPolicy.rescheduleMinNoticeHours) || 0),
          reschedule_decline_message: bookingPolicy.rescheduleDeclineMessage.trim(),
        },
        { onConflict: "business_id" },
      ),
  ]);

  collectErrors(results);
  await saveOperatingHours(operatingHours);
  await saveNotificationSettings(notifications);
  await savePaymentProviders(paymentProviders);
}

export async function updateTeamMember(
  id: string,
  updates: Partial<TeamMemberInput & { role: TeamMember["role"] }>,
): Promise<void> {
  const { error } = await supabase.from("team_members").update(updates).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function inviteTeamMember(
  businessId: string,
  member: TeamMemberInput,
): Promise<TeamMember> {
  const { data, error } = await supabase
    .from("team_members")
    .insert({ business_id: businessId, ...member })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as TeamMember;
}

export async function removeTeamMember(id: string): Promise<void> {
  const { error } = await supabase.from("team_members").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteBusinessData(businessId: string): Promise<void> {
  const { error } = await supabase.from("businesses").delete().eq("id", businessId);
  if (error) throw new Error(error.message);
}

export function getProviderSetting(
  providers: PaymentProviderSetting[],
  key: PaymentProviderKey,
): PaymentProviderSetting | undefined {
  return providers.find((p) => p.provider_key === key);
}
