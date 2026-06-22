import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotTone = "friendly" | "professional" | "casual" | "concise";

export type BotSettings = {
  business_id: string;
  bot_enabled: boolean;
  auto_confirm: boolean;
  accept_cancellations: boolean;
  send_payment_links: boolean;
  answer_faqs: boolean;
  always_on: boolean;
  tone: BotTone;
  bot_name: string;
  welcome_message: string;
  fallback_message: string;
};

export type BotWorkingHour = {
  business_id: string;
  day_name: string;
  is_open: boolean;
  open_time: string;  // "HH:mm"
  close_time: string; // "HH:mm"
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_BOT_SETTINGS: Omit<BotSettings, "business_id"> = {
  bot_enabled: true,
  auto_confirm: false,
  accept_cancellations: true,
  send_payment_links: true,
  answer_faqs: true,
  always_on: false,
  tone: "friendly",
  bot_name: "inCheck Assistant",
  welcome_message: "Hi! 👋 How can I help you today?",
  fallback_message: "I'll pass you to a human who can help. Please hold! 🙏",
};

const ALL_DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"] as const;

const DEFAULT_WORKING_HOURS: Omit<BotWorkingHour, "business_id">[] = [
  { day_name: "monday",    is_open: true,  open_time: "08:00", close_time: "18:00" },
  { day_name: "tuesday",   is_open: true,  open_time: "08:00", close_time: "18:00" },
  { day_name: "wednesday", is_open: true,  open_time: "08:00", close_time: "18:00" },
  { day_name: "thursday",  is_open: true,  open_time: "08:00", close_time: "18:00" },
  { day_name: "friday",    is_open: true,  open_time: "08:00", close_time: "18:00" },
  { day_name: "saturday",  is_open: true,  open_time: "08:00", close_time: "15:00" },
  { day_name: "sunday",    is_open: false, open_time: "09:00", close_time: "13:00" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeToInput(value: string): string {
  return value?.slice(0, 5) ?? "08:00";
}

function timeToDb(value: string): string {
  if (!value) return "08:00:00";
  return value.length === 5 ? `${value}:00` : value;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export type BotFullSettings = {
  settings: BotSettings;
  workingHours: BotWorkingHour[];
  allowedServiceIds: string[];
};

export async function fetchBotSettings(): Promise<BotFullSettings> {
  const businessId = await ensureBusiness();

  const [settingsRes, hoursRes, servicesRes] = await Promise.all([
    supabase
      .from("whatsapp_bot_settings")
      .select("*")
      .eq("business_id", businessId)
      .maybeSingle(),
    supabase
      .from("whatsapp_bot_working_hours")
      .select("*")
      .eq("business_id", businessId)
      .order("day_name"),
    supabase
      .from("whatsapp_bot_allowed_services")
      .select("service_id")
      .eq("business_id", businessId),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (servicesRes.error) throw new Error(servicesRes.error.message);

  // ── Bot settings row (upsert defaults if missing) ─────────────────────────
  let settings: BotSettings;
  if (!settingsRes.data) {
    const { data, error } = await supabase
      .from("whatsapp_bot_settings")
      .upsert({ business_id: businessId, ...DEFAULT_BOT_SETTINGS }, { onConflict: "business_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    settings = data as BotSettings;
  } else {
    settings = settingsRes.data as BotSettings;
  }

  // ── Working hours (upsert defaults for any missing days) ──────────────────
  const existingDays = new Set((hoursRes.data ?? []).map((h: Record<string, unknown>) => h.day_name as string));
  const missingDays = DEFAULT_WORKING_HOURS.filter((d) => !existingDays.has(d.day_name));

  if (missingDays.length > 0) {
    await supabase
      .from("whatsapp_bot_working_hours")
      .upsert(
        missingDays.map((d) => ({ business_id: businessId, ...d })),
        { onConflict: "business_id,day_name" },
      );
  }

  // Re-fetch if we just inserted missing rows
  const finalHours: BotWorkingHour[] =
    missingDays.length > 0
      ? await supabase
          .from("whatsapp_bot_working_hours")
          .select("*")
          .eq("business_id", businessId)
          .order("day_name")
          .then(({ data }) =>
            (data ?? []).map((h: Record<string, unknown>) => ({
              business_id: h.business_id as string,
              day_name: h.day_name as string,
              is_open: h.is_open as boolean,
              open_time: timeToInput(h.open_time as string),
              close_time: timeToInput(h.close_time as string),
            })),
          )
      : (hoursRes.data ?? []).map((h: Record<string, unknown>) => ({
          business_id: h.business_id as string,
          day_name: h.day_name as string,
          is_open: h.is_open as boolean,
          open_time: timeToInput(h.open_time as string),
          close_time: timeToInput(h.close_time as string),
        }));

  // Sort by canonical day order
  const dayOrder = [...ALL_DAYS];
  finalHours.sort((a, b) => dayOrder.indexOf(a.day_name as typeof ALL_DAYS[number]) - dayOrder.indexOf(b.day_name as typeof ALL_DAYS[number]));

  const allowedServiceIds = (servicesRes.data ?? []).map((r: Record<string, unknown>) => r.service_id as string);

  return { settings, workingHours: finalHours, allowedServiceIds };
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function saveBotSettings(
  settings: BotSettings,
  workingHours: BotWorkingHour[],
  allowedServiceIds: string[],
  allActiveServiceIds: string[],
): Promise<void> {
  const businessId = settings.business_id;

  // 1. Upsert main settings row
  const { error: settingsError } = await supabase
    .from("whatsapp_bot_settings")
    .upsert(
      {
        business_id: businessId,
        bot_enabled: settings.bot_enabled,
        auto_confirm: settings.auto_confirm,
        accept_cancellations: settings.accept_cancellations,
        send_payment_links: settings.send_payment_links,
        answer_faqs: settings.answer_faqs,
        always_on: settings.always_on,
        tone: settings.tone,
        bot_name: settings.bot_name,
        welcome_message: settings.welcome_message,
        fallback_message: settings.fallback_message,
      },
      { onConflict: "business_id" },
    );
  if (settingsError) throw new Error(settingsError.message);

  // 2. Upsert working hours rows
  const { error: hoursError } = await supabase
    .from("whatsapp_bot_working_hours")
    .upsert(
      workingHours.map((h) => ({
        business_id: businessId,
        day_name: h.day_name,
        is_open: h.is_open,
        open_time: timeToDb(h.open_time),
        close_time: timeToDb(h.close_time),
      })),
      { onConflict: "business_id,day_name" },
    );
  if (hoursError) throw new Error(hoursError.message);

  // 3. Sync allowed services:
  //    Delete services that are now disallowed, insert newly allowed ones
  const allowedSet = new Set(allowedServiceIds);
  const disallowed = allActiveServiceIds.filter((id) => !allowedSet.has(id));

  const ops: Promise<{ error: { message: string } | null }>[] = [];

  // Remove disallowed services
  if (disallowed.length > 0) {
    ops.push(
      (async () => {
        const { error } = await supabase
          .from("whatsapp_bot_allowed_services")
          .delete()
          .eq("business_id", businessId)
          .in("service_id", disallowed);
        return { error: error ? { message: error.message } : null };
      })()
    );
  }

  // Insert allowed services (ignore conflicts)
  if (allowedServiceIds.length > 0) {
    ops.push(
      (async () => {
        const { error } = await supabase
          .from("whatsapp_bot_allowed_services")
          .upsert(
            allowedServiceIds.map((id) => ({ business_id: businessId, service_id: id })),
            { onConflict: "business_id,service_id" },
          );
        return { error: error ? { message: error.message } : null };
      })()
    );
  }

  const results = await Promise.all(ops);
  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    throw new Error(failed.map((r) => r.error!.message).join("; "));
  }
}
