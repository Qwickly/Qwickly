import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BotTone = "friendly" | "professional" | "casual" | "concise";
export type BotReviewMode = "auto" | "draft_only" | "approval_required";

export type BotSettings = {
  business_id: string;
  bot_enabled: boolean;
  auto_confirm: boolean;
  // Cancel/reschedule policy moved to the core `booking_policies` table
  // (see lib/booking-policies.ts + migration 046/047). No longer on bot settings.
  send_payment_links: boolean;
  answer_faqs: boolean;
  always_on: boolean;
  tone: BotTone;
  bot_name: string;
  welcome_message: string;
  fallback_message: string;
  review_mode: BotReviewMode;
  /** Ping the owner from the official Qwickly number when a reply needs approval. */
  owner_review_alerts_enabled: boolean;
  /** Optional override number; blank = the connected WhatsApp number. */
  owner_alert_phone: string;
  /** Quiet window (SAST, "HH:mm"); alerts inside it are deferred. */
  owner_alert_quiet_start: string;
  owner_alert_quiet_end: string;
};

export type BotWorkingHour = {
  business_id: string;
  day_name: string;
  is_open: boolean;
  open_time: string; // "HH:mm"
  close_time: string; // "HH:mm"
};

export type BotFaq = {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
};

/** Matches the DB CHECK constraints in migration 031. */
export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 600;
/** Per-business cap (app-level so it can be tiered by plan later). */
export const FAQ_COUNT_MAX = 30;

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_BOT_SETTINGS: Omit<BotSettings, "business_id"> = {
  bot_enabled: true,
  auto_confirm: false,
  send_payment_links: true,
  answer_faqs: true,
  always_on: false,
  tone: "friendly",
  bot_name: "Qwickly Assistant",
  welcome_message: "Hi! 👋 How can I help you today?",
  fallback_message: "I'll pass you to a human who can help. Please hold! 🙏",
  review_mode: "approval_required",
  owner_review_alerts_enabled: true,
  owner_alert_phone: "",
  owner_alert_quiet_start: "21:00",
  owner_alert_quiet_end: "07:00",
};

const ALL_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const DEFAULT_WORKING_HOURS: Omit<BotWorkingHour, "business_id">[] = [
  {
    day_name: "monday",
    is_open: true,
    open_time: "08:00",
    close_time: "18:00",
  },
  {
    day_name: "tuesday",
    is_open: true,
    open_time: "08:00",
    close_time: "18:00",
  },
  {
    day_name: "wednesday",
    is_open: true,
    open_time: "08:00",
    close_time: "18:00",
  },
  {
    day_name: "thursday",
    is_open: true,
    open_time: "08:00",
    close_time: "18:00",
  },
  {
    day_name: "friday",
    is_open: true,
    open_time: "08:00",
    close_time: "18:00",
  },
  {
    day_name: "saturday",
    is_open: true,
    open_time: "08:00",
    close_time: "15:00",
  },
  {
    day_name: "sunday",
    is_open: false,
    open_time: "09:00",
    close_time: "13:00",
  },
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
      .from("services")
      .select("id")
      .eq("business_id", businessId)
      .eq("bookable_by_bot", true),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (servicesRes.error) throw new Error(servicesRes.error.message);

  // ── Bot settings row (upsert defaults if missing) ─────────────────────────
  let settings: BotSettings;
  if (!settingsRes.data) {
    const { data, error } = await supabase
      .from("whatsapp_bot_settings")
      .upsert(
        { business_id: businessId, ...DEFAULT_BOT_SETTINGS },
        { onConflict: "business_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    settings = data as BotSettings;
  } else {
    const row = settingsRes.data as Partial<BotSettings> & Record<string, unknown>;
    settings = {
      ...(settingsRes.data as BotSettings),
      review_mode:
        (row.review_mode as BotReviewMode | undefined) ?? DEFAULT_BOT_SETTINGS.review_mode,
      owner_review_alerts_enabled:
        (row.owner_review_alerts_enabled as boolean | undefined) ??
        DEFAULT_BOT_SETTINGS.owner_review_alerts_enabled,
      owner_alert_phone: (row.owner_alert_phone as string | null | undefined) ?? "",
      owner_alert_quiet_start: timeToInput(
        (row.owner_alert_quiet_start as string | undefined) ??
          DEFAULT_BOT_SETTINGS.owner_alert_quiet_start,
      ),
      owner_alert_quiet_end: timeToInput(
        (row.owner_alert_quiet_end as string | undefined) ??
          DEFAULT_BOT_SETTINGS.owner_alert_quiet_end,
      ),
    };
  }

  // ── Working hours (upsert defaults for any missing days) ──────────────────
  const existingDays = new Set(
    (hoursRes.data ?? []).map(
      (h: Record<string, unknown>) => h.day_name as string,
    ),
  );
  const missingDays = DEFAULT_WORKING_HOURS.filter(
    (d) => !existingDays.has(d.day_name),
  );

  if (missingDays.length > 0) {
    await supabase.from("whatsapp_bot_working_hours").upsert(
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
  finalHours.sort(
    (a, b) =>
      dayOrder.indexOf(a.day_name as (typeof ALL_DAYS)[number]) -
      dayOrder.indexOf(b.day_name as (typeof ALL_DAYS)[number]),
  );

  const allowedServiceIds = (servicesRes.data ?? []).map(
    (r: Record<string, unknown>) => r.id as string,
  );

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
        send_payment_links: settings.send_payment_links,
        answer_faqs: settings.answer_faqs,
        always_on: settings.always_on,
        tone: settings.tone,
        bot_name: settings.bot_name,
        welcome_message: settings.welcome_message,
        fallback_message: settings.fallback_message,
        review_mode: settings.review_mode ?? DEFAULT_BOT_SETTINGS.review_mode,
        owner_review_alerts_enabled: settings.owner_review_alerts_enabled,
        owner_alert_phone: settings.owner_alert_phone.trim() || null,
        owner_alert_quiet_start: timeToDb(settings.owner_alert_quiet_start),
        owner_alert_quiet_end: timeToDb(settings.owner_alert_quiet_end),
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

  // 3. Sync which services the bot may book by flipping services.bookable_by_bot.
  //    Allowed → true, everything else among the active services → false.
  const allowedSet = new Set(allowedServiceIds);
  const disallowed = allActiveServiceIds.filter((id) => !allowedSet.has(id));

  const ops: Promise<{ error: { message: string } | null }>[] = [];

  if (allowedServiceIds.length > 0) {
    ops.push(
      (async () => {
        const { error } = await supabase
          .from("services")
          .update({ bookable_by_bot: true })
          .eq("business_id", businessId)
          .in("id", allowedServiceIds);
        return { error: error ? { message: error.message } : null };
      })(),
    );
  }

  if (disallowed.length > 0) {
    ops.push(
      (async () => {
        const { error } = await supabase
          .from("services")
          .update({ bookable_by_bot: false })
          .eq("business_id", businessId)
          .in("id", disallowed);
        return { error: error ? { message: error.message } : null };
      })(),
    );
  }

  const results = await Promise.all(ops);
  const failed = results.filter((r) => r.error);
  if (failed.length > 0) {
    throw new Error(failed.map((r) => r.error!.message).join("; "));
  }
}

// ── Knowledge base (FAQs) ───────────────────────────────────────────────────────

export async function fetchBotFaqs(): Promise<BotFaq[]> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("whatsapp_bot_faqs")
    .select("id, question, answer, enabled")
    .eq("business_id", businessId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    question: (r.question as string) ?? "",
    answer: (r.answer as string) ?? "",
    enabled: (r.enabled as boolean) ?? true,
  }));
}

/**
 * Replaces the business's FAQ set with `faqs` (delete-then-insert keeps the save
 * path dead simple and ordering authoritative). Trims, drops blank rows, and
 * enforces the same caps as the DB so the user gets a clear error, not a 400.
 */
export async function saveBotFaqs(faqs: BotFaq[]): Promise<void> {
  const businessId = await ensureBusiness();

  const cleaned = faqs
    .map((f) => ({
      question: f.question.trim().slice(0, FAQ_QUESTION_MAX),
      answer: f.answer.trim().slice(0, FAQ_ANSWER_MAX),
      enabled: f.enabled,
    }))
    .filter((f) => f.question && f.answer);

  if (cleaned.length > FAQ_COUNT_MAX) {
    throw new Error(`You can have at most ${FAQ_COUNT_MAX} FAQs.`);
  }

  const { error: delError } = await supabase
    .from("whatsapp_bot_faqs")
    .delete()
    .eq("business_id", businessId);
  if (delError) throw new Error(delError.message);

  if (cleaned.length === 0) return;

  const { error: insError } = await supabase.from("whatsapp_bot_faqs").insert(
    cleaned.map((f, index) => ({
      business_id: businessId,
      question: f.question,
      answer: f.answer,
      enabled: f.enabled,
      position: index,
    })),
  );
  if (insError) throw new Error(insError.message);
}
