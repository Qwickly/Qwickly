import type { Message } from "whatsapp-web.js";
import { getSupabaseAdmin } from "./supabase";
import {
  buildPayFastSandboxFields,
  buildPayFastStartUrl,
  getConfiguredPublicOrigin,
} from "./payfast";
import { recordActivity } from "./activity";

// ── TYPES ────────────────────────────────────────────────────────────────────

export type BotWorkingHourRow = {
  day_name: string;
  is_open: boolean;
  open_time: string;
  close_time: string;
};

export type BotSettingsWithServices = {
  bot_enabled: boolean;
  auto_confirm: boolean;
  accept_cancellations: boolean;
  send_payment_links: boolean;
  answer_faqs: boolean;
  always_on: boolean;
  tone: string;
  bot_name: string;
  welcome_message: string;
  fallback_message: string;
  allowed_service_ids: string[];
};

export type ClientProfile = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  client_type: string;
  notes: string | null;
  no_show_count: number;
};

export type ServiceRow = {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  deposit_required: boolean;
  deposit_amount: number;
};

export type StaffRow = {
  id: string;
  name: string;
  position: string;
  working_days: string[];
};

export type DepositSettingsRow = {
  require_deposit: boolean;
  deposit_type: "percentage" | "fixed";
  deposit_amount: number;
};

export type BookingPageRuleRow = {
  slug: string;
  page_title: string;
  welcome_message: string;
  require_deposit: boolean;
  allow_rescheduling: boolean;
  show_staff_selection: boolean;
  is_published: boolean;
};

export type BookingRow = {
  id: string;
  client_id: string;
  service_id: string;
  start_time: string;
  end_time: string;
  status: string;
  staff_id: string | null;
  total_amount: number;
  deposit_paid: boolean;
  services: { name: string } | { name: string }[] | null;
  staff_members: { name: string } | { name: string }[] | null;
  clients: { name: string } | { name: string }[] | null;
};

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiPromptSettings = {
  bot_name: string;
  tone: string;
  welcome_message: string;
  fallback_message: string;
  auto_confirm: boolean;
  accept_cancellations: boolean;
  send_payment_links: boolean;
  answer_faqs: boolean;
  working_hours: string;
  always_on: boolean;
  client_name: string;
  client_id: string | null;
  is_first_message: boolean;
  within_business_hours: boolean;
  current_time: string;
  action_summary?: string;
};

export type BookingAction =
  | { type: "CREATE"; service_id: string; start_time_iso: string; staff_id: string | null; client_name?: string | null; notes?: string | null }
  | { type: "CANCEL"; booking_id: string | null; reason?: string | null; target_date?: string | null }
  | { type: "UPDATE_TIME"; booking_id: string | null; new_start_time_iso: string; staff_id?: string | null }
  | { type: "UPDATE_STAFF"; booking_id: string | null; new_staff_id: string | null }
  | { type: "NONE" };

export type AiAssistantDecision = {
  confidence: "high" | "medium" | "low";
  needs_human: boolean;
  missing_fields: string[];
  actions: BookingAction[];
};

export type AssistantActionResult = {
  outcome:
    | "none"
    | "success"
    | "booking_created"
    | "booking_failed"
    | "booking_cancelled"
    | "booking_cancel_failed"
    | "reschedule_failed"
    | "rescheduled"
    | "booking_already_exists"
    | "pipeline_failed";
  summary: string;
};

export type BusinessAiData = {
  businessName: string;
  businessDescription: string;
  services: ServiceRow[];
  staff: StaffRow[];
  bookings: BookingRow[];
  bookingPage: BookingPageRuleRow | null;
  depositSettings: DepositSettingsRow | null;
  allowedServiceIds: string[];
  workingHours: BotWorkingHourRow[];
};

export type BusinessContextBundle = {
  businessContext: string;
  workingHoursText: string;
  aiData: BusinessAiData;
};

// ── Constants ────────────────────────────────────────────────────────────────

const AI_MODEL = "gpt-oss-120b";
const AI_API_BASE = "https://api.cerebras.ai/v1";
const CONTEXT_CACHE_TTL_MS = 90_000;
const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_CHARS = 4000;
const MAX_USER_INPUT_CHARS = 1000;
const RATE_LIMIT_BACKOFF_MS = 10_000;
const MAX_429_RETRIES = 4;
const MIN_CALL_GAP_MS = 800;
const BUSINESS_TIMEZONE_OFFSET = "+02:00";
const BUSINESS_TIMEZONE = "Africa/Johannesburg";

const DAY_NAMES = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const contextCache = new Map<string, { expiresAt: number; bundle: BusinessContextBundle }>();

const EMPTY_AI_DATA: BusinessAiData = {
  businessName: "", businessDescription: "",
  services: [], staff: [], bookings: [],
  bookingPage: null, depositSettings: null,
  allowedServiceIds: [], workingHours: [],
};

// ── Serialization queues ─────────────────────────────────────────────────────

const _userQueues = new Map<string, { tail: Promise<unknown>; lastAt: number }>();

function getOrCreateQueue(userId: string) {
  if (!_userQueues.has(userId)) _userQueues.set(userId, { tail: Promise.resolve(), lastAt: 0 });
  return _userQueues.get(userId)!;
}

function enqueueForUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const q = getOrCreateQueue(userId);
  const result = q.tail.then(async () => {
    const gap = Date.now() - q.lastAt;
    if (gap < MIN_CALL_GAP_MS) await sleep(MIN_CALL_GAP_MS - gap);
    q.lastAt = Date.now();
    return fn();
  });
  q.tail = result.catch(() => undefined);
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Jitter Retrier ────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, label = "op"): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= MAX_429_RETRIES; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const is429 =
        msg.includes("429") ||
        msg.toLowerCase().includes("too_many_requests") ||
        msg.toLowerCase().includes("queue_exceeded");
      if (i < MAX_429_RETRIES) {
        const delay = is429
          ? RATE_LIMIT_BACKOFF_MS * (i + 1) + Math.random() * 3_000
          : 1_000 * Math.pow(2, i) + Math.random() * 500;
        console.warn(`[RETRY] ${label} attempt ${i + 1}/${MAX_429_RETRIES}. Wait ${Math.round(delay)}ms…`);
        await sleep(delay);
      }
    }
  }
  throw last;
}

// ── Formatters & Matchers ────────────────────────────────────────────────────

function relationName(rel: { name: string } | { name: string }[] | null | undefined): string | null {
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0]?.name ?? null;
  return rel.name ?? null;
}

function normalizeUuid(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function sameUuid(a: string | null | undefined, b: string | null | undefined): boolean {
  const l = normalizeUuid(a), r = normalizeUuid(b);
  return Boolean(l) && l === r;
}

function formatCurrency(v: number | string | null | undefined): string {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return `R${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function createBusinessDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${BUSINESS_TIMEZONE_OFFSET}`);
}

function getBusinessDateParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.year || 0),
    month: Number(map.month || 0),
    day: Number(map.day || 0),
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
    second: Number(map.second || 0),
  };
}

function formatBusinessDateTime(v: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof v === "string" ? parseIsoDateTime(v) ?? new Date(v) : v;
  return d.toLocaleString("en-ZA", { timeZone: BUSINESS_TIMEZONE, ...options });
}

function formatDateTimeFriendly(v: string | Date): string {
  return formatBusinessDateTime(v, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function extractJsonObject(raw: string): string | null {
  try {
    const t = raw.trim();
    const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const c = fenced?.[1]?.trim() ?? t;
    const s = c.indexOf("{"), e = c.lastIndexOf("}");
    if (s === -1 || e === -1 || e <= s) return null;
    return c.slice(s, e + 1);
  } catch { return null; }
}

function repairJsonString(raw: string): string {
  return raw
    .replace(/,\s*([\]}])/g, "$1")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeStringIdentifier(val: unknown): string | null {
  return typeof val === "string" ? val.trim() || null : null;
}

function parseIsoDateTime(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  const localIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

  if (localIso.test(raw)) {
    const normalized = raw.length === 16 ? `${raw}:00` : raw;
    return new Date(`${normalized}${BUSINESS_TIMEZONE_OFFSET}`);
  }

  if (dateOnly.test(raw)) {
    return new Date(`${raw}T00:00:00${BUSINESS_TIMEZONE_OFFSET}`);
  }

  if (raw.endsWith("Z")) {
    return new Date(raw.replace(/Z$/, BUSINESS_TIMEZONE_OFFSET));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sanitizeAction(v: unknown): BookingAction {
  const obj = (v ?? {}) as Record<string, unknown>;
  const type = String(obj["type"] ?? "").toUpperCase();

  switch (type) {
    case "CREATE":
      return {
        type: "CREATE",
        service_id: String(obj["service_id"] ?? "").trim(),
        start_time_iso: String(obj["start_time_iso"] ?? "").trim(),
        staff_id: normalizeStringIdentifier(obj["staff_id"]),
        client_name: normalizeStringIdentifier(obj["client_name"]),
        notes: normalizeStringIdentifier(obj["notes"]),
      };
    case "CANCEL":
      return {
        type: "CANCEL",
        booking_id: normalizeStringIdentifier(obj["booking_id"]),
        reason: normalizeStringIdentifier(obj["reason"]),
        target_date: normalizeStringIdentifier(obj["target_date"]),
      };
    case "UPDATE_TIME":
      return {
        type: "UPDATE_TIME",
        booking_id: normalizeStringIdentifier(obj["booking_id"]),
        new_start_time_iso: String(obj["new_start_time_iso"] ?? "").trim(),
        staff_id: normalizeStringIdentifier(obj["staff_id"]),
      };
    case "UPDATE_STAFF":
      return {
        type: "UPDATE_STAFF",
        booking_id: normalizeStringIdentifier(obj["booking_id"]),
        new_staff_id: normalizeStringIdentifier(obj["new_staff_id"]),
      };
    default:
      return { type: "NONE" };
  }
}

function sanitizeDecision(v: unknown): AiAssistantDecision {
  const i = (v ?? {}) as Record<string, unknown>;
  const conf = String(i["confidence"] ?? "low");
  const actions: BookingAction[] = Array.isArray(i["actions"])
    ? (i["actions"] as unknown[]).map(sanitizeAction).filter((a) => a.type !== "NONE")
    : [];

  if (!actions.length && typeof i["intent"] === "string") {
    const intent = String(i["intent"]).toLowerCase();
    const b = (i["booking"] ?? {}) as Record<string, unknown>;
    const c = (i["cancellation"] ?? {}) as Record<string, unknown>;
    const r = (i["reschedule"] ?? {}) as Record<string, unknown>;

    if (intent === "book" && Boolean(b["should_create"])) {
      actions.push({
        type: "CREATE",
        service_id: String(b["service_id"] ?? "").trim(),
        start_time_iso: String(b["start_time_iso"] ?? "").trim(),
        staff_id: normalizeStringIdentifier(b["staff_id"]),
        client_name: normalizeStringIdentifier(b["client_name"]),
        notes: normalizeStringIdentifier(b["notes"]),
      });
    } else if (intent === "cancel" && Boolean(c["should_cancel"])) {
      actions.push({
        type: "CANCEL",
        booking_id: normalizeStringIdentifier(c["booking_id"]),
        reason: undefined,
        target_date: undefined,
      });
    } else if (intent === "reschedule" && Boolean(r["should_reschedule"])) {
      actions.push({
        type: "UPDATE_TIME",
        booking_id: normalizeStringIdentifier(r["booking_id"]),
        new_start_time_iso: String(r["start_time_iso"] ?? "").trim(),
        staff_id: normalizeStringIdentifier(r["staff_id"]),
      });
    }
  }

  return {
    confidence: conf === "high" || conf === "medium" ? conf : "low",
    missing_fields: Array.isArray(i["missing_fields"])
      ? i["missing_fields"].map(String).filter(Boolean)
      : [],
    needs_human: Boolean(i["needs_human"]),
    actions,
  };
}

function makeDefaultDecision(): AiAssistantDecision {
  return {
    confidence: "low",
    needs_human: false,
    missing_fields: [],
    actions: [],
  };
}

// ── Phone Helpers ────────────────────────────────────────────────────────────

export function normalizePhoneLikeValue(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

export function phoneMatchesTarget(phone: string, target: string): boolean {
  const d = normalizePhoneLikeValue(phone);
  const t = normalizePhoneLikeValue(target);
  if (!d || !t) return false;
  if (d === t) return true;
  if (d.startsWith("27") && d.slice(2) === t.slice(1)) return true;
  if (t.startsWith("27") && t.slice(2) === d.slice(1)) return true;
  return d.slice(-9).length >= 9 && d.slice(-9) === t.slice(-9);
}

function phonesMatch(a: string, b: string): boolean { return phoneMatchesTarget(a, b); }

// ── Bot Settings ─────────────────────────────────────────────────────────────

export async function fetchBotSettingsForBusiness(businessId: string) {
  const [sr, hr, ar] = await Promise.all([
    getSupabaseAdmin().from("whatsapp_bot_settings").select("*").eq("business_id", businessId).maybeSingle(),
    getSupabaseAdmin().from("whatsapp_bot_working_hours").select("*").eq("business_id", businessId),
    getSupabaseAdmin().from("whatsapp_bot_allowed_services").select("service_id").eq("business_id", businessId),
  ]);
  return {
    settings: sr.data
      ? ({ ...sr.data, allowed_service_ids: (ar.data ?? []).map((r: { service_id: string }) => r.service_id) } as BotSettingsWithServices)
      : null,
    workingHours: (hr.data ?? []) as BotWorkingHourRow[],
  };
}

export function isWithinWorkingHours(wh: BotWorkingHourRow[], alwaysOn: boolean): boolean {
  if (alwaysOn) return true;
  const now = new Date();
  const dayName = DAY_NAMES[getBusinessWeekdayIndex(now)];
  const h = wh.find((x) => x.day_name === dayName);
  if (!h?.is_open) return false;
  const parts = getBusinessDateParts(now);
  const t = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return t >= h.open_time.slice(0, 5) && t <= h.close_time.slice(0, 5);
}

export function formatWorkingHoursText(wh: BotWorkingHourRow[]): string {
  const o = wh.filter((h) => h.is_open);
  if (!o.length) return "Closed";
  return o.map((h) => `${cap(h.day_name.slice(0, 3))}: ${h.open_time.slice(0, 5)}–${h.close_time.slice(0, 5)}`).join(", ");
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Client Directories ───────────────────────────────────────────────────────

export async function findClientByPhoneForBusiness(businessId: string, phone: string): Promise<ClientProfile | null> {
  const n = normalizePhoneLikeValue(phone);
  if (!n) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("clients").select("id, name, phone, email, client_type, notes, no_show_count").eq("business_id", businessId);
  if (error || !data?.length) return null;
  const m = data.find((r) => phonesMatch(String(r.phone ?? ""), n));
  return m ? (m as ClientProfile) : null;
}

async function getClientBookingHistory(businessId: string, clientId: string): Promise<string> {
  const now = new Date().toISOString();
  const [up, past] = await Promise.all([
    getSupabaseAdmin().from("bookings")
      .select("id, start_time, status, services(name), staff_members(name)")
      .eq("business_id", businessId).eq("client_id", clientId)
      .gte("start_time", now).neq("status", "cancelled")
      .order("start_time", { ascending: true }).limit(3),
    getSupabaseAdmin().from("bookings")
      .select("id, start_time, status, services(name), staff_members(name)")
      .eq("business_id", businessId).eq("client_id", clientId)
      .lt("start_time", now).order("start_time", { ascending: false }).limit(2),
  ]);
  const fmt = (b: any) =>
    `[ID:${b.id}] ${formatBusinessDateTime(b.start_time, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — ${relationName(b.services) ?? "?"}`;
  const u = (up.data ?? []) as any[], p = (past.data ?? []) as any[];
  if (!u.length && !p.length) return "";
  return [
    u.length ? `Upcoming bookings:\n${u.map(fmt).join("\n")}` : "",
    p.length ? `Past bookings:\n${p.map(fmt).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

function formatClientContext(client: ClientProfile | null, senderName: string): string {
  if (!client) return `Customer: ${senderName || "Unknown"} (new)`;
  const tags: string[] = [];
  if (client.client_type === "vip") tags.push("VIP");
  else if (client.client_type === "returning") tags.push("Returning");
  if (client.no_show_count > 0) tags.push(`${client.no_show_count} no-show(s)`);
  if (client.notes?.trim()) tags.push(client.notes.trim());
  return `Customer: ${client.name}${tags.length ? ` (${tags.join(", ")})` : ""}`;
}

// ── Overlaps & Availabilities ────────────────────────────────────────────────

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function bookingOverlaps(
  sS: Date, sE: Date,
  b: { start_time: string; end_time: string; staff_id: string | null },
  staffId: string | null,
): boolean {
  if (staffId && b.staff_id && b.staff_id !== staffId) return false;
  return sS.getTime() < new Date(b.end_time).getTime() && sE.getTime() > new Date(b.start_time).getTime();
}

function bookingIsActive(s: string): boolean { return s !== "cancelled" && s !== "no_show"; }

function computeAvailabilitySummary(
  wh: BotWorkingHourRow[], staff: StaffRow[], bookings: BookingRow[], dur: number, days = 5,
): string {
  const businessNow = getBusinessDateParts(new Date());
  const baseDay = createBusinessDate(businessNow.year, businessNow.month, businessNow.day, 0, 0, 0);
  const now = new Date();
  const lines: string[] = [];
  for (let o = 0; o < days; o++) {
    const day = new Date(baseDay);
    day.setUTCDate(baseDay.getUTCDate() + o);
    const dn = DAY_NAMES[getBusinessWeekdayIndex(day)];
    const hc = wh.find((h) => h.day_name === dn);
    const label = formatBusinessDateTime(day, { weekday: "short", month: "short", day: "numeric" });
    if (!hc?.is_open) { lines.push(`${label}: closed`); continue; }
    const availStaff = staff.filter((s) => (s.working_days ?? []).includes(dn));
    if (!availStaff.length) { lines.push(`${label}: no staff`); continue; }
    const om = parseTimeToMinutes(hc.open_time), cm = parseTimeToMinutes(hc.close_time);
    const daySlots: string[] = [];
    const dayParts = getBusinessDateParts(day);
    for (const member of availStaff) {
      const free: string[] = [];
      for (let m = om; m + dur <= cm; m += 30) {
        const s = createBusinessDate(dayParts.year, dayParts.month, dayParts.day, Math.floor(m / 60), m % 60, 0);
        if (s.getTime() <= now.getTime()) continue;
        const e = new Date(s.getTime() + dur * 60_000);
        const taken = bookings.filter((b) => bookingIsActive(b.status)).some((b) => bookingOverlaps(s, e, b, member.id));
        if (!taken) {
          const h12 = Math.floor(m / 60) % 12 || 12;
          const mins = m % 60 ? `:${String(m % 60).padStart(2, "0")}` : "";
          free.push(`${h12}${mins}${Math.floor(m / 60) >= 12 ? "pm" : "am"}`);
        }
      }
      if (free.length) daySlots.push(`  ${member.name} (${member.id}): ${free.slice(0, 5).join(", ")}${free.length > 5 ? ` +${free.length - 5}` : ""}`);
    }
    lines.push(daySlots.length ? `${label}:\n${daySlots.join("\n")}` : `${label}: fully booked`);
  }
  return lines.join("\n");
}

// ── Invalidate Business Context ───────────────────────────────────────────────

export function invalidateBusinessContext(businessId: string): void {
  for (const k of contextCache.keys()) if (k.startsWith(businessId)) contextCache.delete(k);
}

// ── Loader & Synthesizer ─────────────────────────────────────────────────────

async function loadBusinessData(businessId: string, allowedServiceIds: string[]) {
  const start = new Date(), end = new Date(); end.setDate(start.getDate() + 14);
  let sq = getSupabaseAdmin().from("services")
    .select("id, name, description, price, duration, deposit_required, deposit_amount")
    .eq("business_id", businessId).eq("is_active", true);
  if (allowedServiceIds.length > 0) sq = sq.in("id", allowedServiceIds);
  return Promise.all([
    getSupabaseAdmin().from("businesses").select("business_name, description").eq("id", businessId).maybeSingle(),
    sq,
    getSupabaseAdmin().from("staff_members").select("id, name, position, working_days").eq("business_id", businessId).eq("is_active", true),
    getSupabaseAdmin().from("bookings")
      .select("id, client_id, service_id, start_time, end_time, status, staff_id, total_amount, deposit_paid, services(name), staff_members(name), clients(name)")
      .eq("business_id", businessId).gte("start_time", start.toISOString()).lte("start_time", end.toISOString())
      .neq("status", "cancelled").neq("status", "no_show").order("start_time", { ascending: true }),
    getSupabaseAdmin().from("booking_page_settings")
      .select("slug, page_title, welcome_message, require_deposit, allow_rescheduling, show_staff_selection, is_published")
      .eq("business_id", businessId).maybeSingle(),
    getSupabaseAdmin().from("deposit_settings").select("require_deposit, deposit_type, deposit_amount").eq("business_id", businessId).maybeSingle(),
  ]);
}

function formatServicesList(services: ServiceRow[]): string {
  if (!services.length) return "No services available.";
  return services.map((s) =>
    `• "${s.name}" | id=${s.id} | ${formatCurrency(s.price)} | ${s.duration}min${s.deposit_required ? ` | deposit ${formatCurrency(s.deposit_amount)}` : ""}`
  ).join("\n");
}

function formatStaffList(staff: StaffRow[]): string {
  if (!staff.length) return "No staff available.";
  return staff.map((s) =>
    `• "${s.name}" | id=${s.id} | works: ${(s.working_days ?? []).map(cap).join(", ")}`
  ).join("\n");
}

function formatBookedCalendar(bookings: BookingRow[]): string {
  if (!bookings.length) return "No booked blocks.";
  const byDay: Record<string, string[]> = {};
  for (const b of bookings) {
    const d = formatBusinessDateTime(b.start_time, { weekday: "short", month: "short", day: "numeric" });
    const t = formatBusinessDateTime(b.start_time, { hour: "numeric", minute: "2-digit" });
    (byDay[d] ??= []).push(`${t} ${relationName(b.services) ?? "?"}`);
  }
  return Object.entries(byDay).map(([day, list]) => `${day}: ${list.join("; ")}`).join("\n");
}

export async function buildBookingAiContext(
  businessId: string,
  allowedServiceIds: string[],
  workingHours: BotWorkingHourRow[],
  client: ClientProfile | null,
  senderName: string,
): Promise<{ businessContext: string; workingHoursText: string; clientHistory: string; aiData: BusinessAiData }> {
  const cacheKey = `${businessId}:${[...allowedServiceIds].sort().join(",")}`;
  const cached = contextCache.get(cacheKey);
  const workingHoursText = formatWorkingHoursText(workingHours);

  let sharedContext: string, aiData: BusinessAiData;

  if (cached && cached.expiresAt > Date.now()) {
    sharedContext = cached.bundle.businessContext;
    aiData = cached.bundle.aiData;
  } else {
    const [bizRes, servicesRes, staffRes, bookingsRes, pageRes, depositRes] = await loadBusinessData(businessId, allowedServiceIds);
    const bizName = bizRes.data?.business_name ?? "Salon";
    const services = (servicesRes.data ?? []) as ServiceRow[];
    const staff = ((staffRes.data ?? []) as StaffRow[]).map((s) => ({
      ...s,
      working_days: (s.working_days as string[] | null) ?? ["monday", "tuesday", "wednesday", "thursday", "friday"],
    }));
    const bookings = (bookingsRes.data ?? []) as unknown as BookingRow[];
    const avgDuration = services.length ? Math.round(services.reduce((s, sv) => s + sv.duration, 0) / services.length) : 60;

    aiData = {
      businessName: bizName, businessDescription: bizRes.data?.description ?? "",
      services, staff, bookings,
      bookingPage: (pageRes.data as BookingPageRuleRow | null) ?? null,
      depositSettings: (depositRes.data as DepositSettingsRow | null) ?? null,
      allowedServiceIds: [...allowedServiceIds], workingHours: [...workingHours],
    };

    sharedContext = [
      `BUSINESS: ${bizName}`,
      bizRes.data?.description ? `About: ${bizRes.data.description}` : "",
      `HOURS: ${workingHoursText}`,
      `SERVICES CATALOG:\n${formatServicesList(services)}`,
      `STAFF OPERATORS:\n${formatStaffList(staff)}`,
      `BOOKED SLOTS CALENDAR:\n${formatBookedCalendar(bookings)}`,
      `AVAILABLE TIMEFRAMES:\n${computeAvailabilitySummary(workingHours, staff, bookings, avgDuration)}`,
    ].filter(Boolean).join("\n\n");

    contextCache.set(cacheKey, { expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS, bundle: { businessContext: sharedContext, workingHoursText, aiData } });
  }

  const clientBlock = formatClientContext(client, senderName);
  const clientHistory = client ? await getClientBookingHistory(businessId, client.id) : "";
  const fullContext = [sharedContext, `\n\n${clientBlock}`, clientHistory ? `\n\nCLIENT HISTORY:\n${clientHistory}` : ""].join("");
  return { businessContext: fullContext, workingHoursText, clientHistory, aiData };
}

// ── Chat logs compilation ────────────────────────────────────────────────────

export async function getGroqChatHistory(
  chat: { fetchMessages: (opts: { limit: number }) => Promise<Message[]> },
  currentMessage: Message,
): Promise<{ history: GroqMessage[]; isFirstMessage: boolean }> {
  try {
    const fetched = await chat.fetchMessages({ limit: 40 });
    const sorted = [...fetched].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const messages: GroqMessage[] = [];

    for (const msg of sorted) {
      const body = msg.body?.trim();
      if (!body) continue;
      const clipped = body.length > MAX_USER_INPUT_CHARS ? body.slice(0, MAX_USER_INPUT_CHARS) + "…" : body;
      messages.push({ role: msg.fromMe ? "assistant" : "user", content: clipped });
    }

    if (currentMessage.body?.trim()) {
      const clipped = currentMessage.body.trim().length > MAX_USER_INPUT_CHARS
        ? currentMessage.body.trim().slice(0, MAX_USER_INPUT_CHARS) + "…"
        : currentMessage.body.trim();
      const last = messages[messages.length - 1];
      if (!last || last.role !== "user" || last.content !== clipped) {
        messages.push({ role: "user", content: clipped });
      }
    }

    const trimmed = trimHistoryWindow(messages);
    const userCount = trimmed.filter((m) => m.role === "user").length;
    return { history: trimmed, isFirstMessage: userCount <= 1 };
  } catch {
    const clipped = currentMessage.body?.trim().slice(0, MAX_USER_INPUT_CHARS) ?? "";
    return { history: [{ role: "user", content: clipped }], isFirstMessage: true };
  }
}

function trimHistoryWindow(messages: GroqMessage[]): GroqMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars <= MAX_HISTORY_CHARS) return messages;
  }

  let userCount = 0;
  let startIndex = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount += 1;
      if (userCount >= 3) {
        startIndex = i;
        break;
      }
    }
  }

  let trimmed = messages.slice(startIndex);
  while (trimmed.length > 1 && trimmed.reduce((sum, m) => sum + m.content.length, 0) > MAX_HISTORY_CHARS) {
    trimmed.shift();
  }

  return trimmed;
}

// ── Helper Matchings ─────────────────────────────────────────────────────────

function getDayHoursForDate(wh: BotWorkingHourRow[], date: Date): BotWorkingHourRow | null {
  return wh.find((e) => e.day_name === DAY_NAMES[getBusinessWeekdayIndex(date)]) ?? null;
}

function staffWorksOnDate(s: StaffRow, date: Date): boolean {
  return (s.working_days ?? []).includes(DAY_NAMES[getBusinessWeekdayIndex(date)]);
}

function slotFallsWithinBusinessHours(start: Date, end: Date, wh: BotWorkingHourRow[]): boolean {
  const dh = getDayHoursForDate(wh, start);
  if (!dh?.is_open) return false;
  const startParts = getBusinessDateParts(start);
  const endParts = getBusinessDateParts(end);
  const sm = startParts.hour * 60 + startParts.minute;
  const em = endParts.hour * 60 + endParts.minute;
  return sm >= parseTimeToMinutes(dh.open_time) && em <= parseTimeToMinutes(dh.close_time);
}

function getAvailableStaffForSlot(
  aiData: BusinessAiData, service: ServiceRow, requestedStart: Date, preferredStaffId: string | null,
): StaffRow[] {
  const end = new Date(requestedStart.getTime() + service.duration * 60_000);
  if (!slotFallsWithinBusinessHours(requestedStart, end, aiData.workingHours)) return [];
  const pool = preferredStaffId ? aiData.staff.filter((m) => sameUuid(m.id, preferredStaffId)) : aiData.staff;
  return pool.filter(
    (m) => staffWorksOnDate(m, requestedStart) &&
      !aiData.bookings.some((b) => bookingIsActive(b.status) && sameUuid(b.staff_id, m.id) && bookingOverlaps(requestedStart, end, b, m.id)),
  );
}

function buildAlternativeSlots(
  aiData: BusinessAiData, service: ServiceRow, preferredStaffId: string | null, limit = 3,
): { time: string; staffName: string }[] {
  const results: { time: string; staffName: string }[] = [];
  const now = new Date();
  const businessNow = getBusinessDateParts(new Date());
  const baseDay = createBusinessDate(businessNow.year, businessNow.month, businessNow.day, 0, 0, 0);
  for (let o = 0; o < 14 && results.length < limit; o++) {
    const day = new Date(baseDay);
    day.setUTCDate(baseDay.getUTCDate() + o);
    const hours = getDayHoursForDate(aiData.workingHours, day);
    if (!hours?.is_open) continue;
    const dayParts = getBusinessDateParts(day);
    for (let m = parseTimeToMinutes(hours.open_time); m + service.duration <= parseTimeToMinutes(hours.close_time) && results.length < limit; m += 30) {
      const s = createBusinessDate(dayParts.year, dayParts.month, dayParts.day, Math.floor(m / 60), m % 60, 0);
      if (s.getTime() <= now.getTime()) continue;
      const avail = getAvailableStaffForSlot(aiData, service, s, preferredStaffId);
      if (avail.length) results.push({ time: formatDateTimeFriendly(s), staffName: avail[0].name });
    }
  }
  return results;
}

function unavailableResult(aiData: BusinessAiData, service: ServiceRow, staffId: string | null, reason: string): AssistantActionResult {
  const alts = buildAlternativeSlots(aiData, service, staffId);
  return {
    outcome: "booking_failed",
    summary: `BOOKING: failed\nReason: ${reason}\nService: ${service.name}\n${alts.length
      ? `Alternatives:\n${alts.map((a, i) => `  ${i + 1}. ${a.time} with ${a.staffName}`).join("\n")}`
      : "No alternatives available in next 2 weeks."}`,
  };
}

// ── Database Assertions ──────────────────────────────────────────────────────

async function ensureClient(businessId: string, phone: string, name: string): Promise<ClientProfile> {
  const existing = await findClientByPhoneForBusiness(businessId, phone);
  if (existing) {
    const cleanName = name.trim();
    if (cleanName && existing.name !== cleanName) {
      await getSupabaseAdmin().from("clients").update({ name: cleanName }).eq("id", existing.id);
      return { ...existing, name: cleanName };
    }
    return existing;
  }
  const { data, error } = await getSupabaseAdmin().from("clients").insert({
    business_id: businessId, name: name.trim() || "Guest",
    phone: normalizePhoneLikeValue(phone), email: null,
    client_type: "new", no_show_count: 0, avatar_url: null, notes: null,
  }).select("id, name, phone, email, client_type, notes, no_show_count").single();
  if (error || !data) throw new Error(error?.message ?? "Could not create client record.");
  return data as ClientProfile;
}

async function checkDuplicateBooking(businessId: string, clientId: string, serviceId: string, startTime: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin().from("bookings").select("id")
    .eq("business_id", businessId).eq("client_id", clientId)
    .eq("service_id", serviceId).eq("start_time", startTime)
    .neq("status", "cancelled").maybeSingle();
  return !!data;
}

function calculateDepositAmount(
  service: ServiceRow,
  aiData: BusinessAiData,
): { required: boolean; amount: number } {
  const required =
    service.deposit_required ||
    Boolean(aiData.bookingPage?.require_deposit) ||
    Boolean(aiData.depositSettings?.require_deposit);

  if (!required) return { required: false, amount: 0 };

  if (service.deposit_amount > 0) {
    return { required: true, amount: service.deposit_amount };
  }

  const depositSettings = aiData.depositSettings;
  if (!depositSettings) return { required: true, amount: 0 };

  if (depositSettings.deposit_type === "percentage") {
    return {
      required: true,
      amount: Math.round(service.price * (depositSettings.deposit_amount / 100) * 100) / 100,
    };
  }

  return { required: true, amount: depositSettings.deposit_amount };
}

async function createWhatsAppPaymentLink(input: {
  businessId: string;
  client: ClientProfile;
  bookingId: string;
  service: ServiceRow;
  amount: number;
}): Promise<string | null> {
  if (input.amount <= 0) return null;

  const origin = getConfiguredPublicOrigin();
  const paymentId = `bookza-wa-${Date.now()}`;
  const amount = input.amount.toFixed(2);
  const nameParts = input.client.name.trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || "Bookza";
  const lastName = nameParts.slice(1).join(" ") || "Client";
  const fields = buildPayFastSandboxFields({
    origin,
    paymentId,
    amount,
    itemName: `${input.service.name} deposit`,
    itemDescription: `Deposit for ${input.service.name} booking.`,
    customerFirstName: firstName,
    customerLastName: lastName,
    customerEmail: input.client.email,
    businessId: input.businessId,
    customSource: "bookza_whatsapp_ai",
  });

  const { error } = await getSupabaseAdmin()
    .from("payments")
    .insert({
      business_id: input.businessId,
      client_id: input.client.id,
      booking_id: input.bookingId,
      amount,
      method: "payfast",
      status: "pending",
      type: "deposit",
      paid_at: new Date().toISOString(),
      notes: `WhatsApp AI deposit payment for ${input.service.name}.`,
      provider_reference: paymentId,
      provider_payload: {
        source: "whatsapp_ai",
        event: "created",
        booking_id: input.bookingId,
        created_at: new Date().toISOString(),
        payfast_fields: fields,
      },
    });

  if (error) {
    console.warn("[WhatsApp AI] Could not create payment link:", error.message);
    return null;
  }

  await recordActivity({
    businessId: input.businessId,
    actorType: "ai",
    entityType: "payment",
    entityId: paymentId,
    eventType: "payment_link_created",
    title: "Deposit payment link created",
    description: `Payment link created for ${input.service.name}.`,
    metadata: {
      bookingId: input.bookingId,
      clientId: input.client.id,
      amount: input.amount,
      method: "payfast",
      source: "whatsapp_ai",
    },
  });

  return buildPayFastStartUrl(origin, paymentId);
}

// ── MUTATIONS CONTROLLERS ────────────────────────────────────────────────────

function sameDay(a: Date, b: Date): boolean {
  const pA = getBusinessDateParts(a);
  const pB = getBusinessDateParts(b);
  return pA.year === pB.year && pA.month === pB.month && pA.day === pB.day;
}

function getBusinessWeekdayIndex(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIMEZONE, weekday: "long" })
    .format(date)
    .toLowerCase();
  return DAY_NAMES.indexOf(weekday as typeof DAY_NAMES[number]);
}

function resolveStaffMember(aiData: BusinessAiData, candidate: string | null | undefined): StaffRow | null {
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  const exactStaff = aiData.staff.find((s) => sameUuid(s.id, candidate));
  if (exactStaff) return exactStaff;
  const exactName = aiData.staff.find((s) => s.name.toLowerCase() === normalized);
  if (exactName) return exactName;

  const idStarts = aiData.staff.filter((s) => s.id.toLowerCase().startsWith(normalized));
  if (idStarts.length === 1) return idStarts[0];

  const nameIncludes = aiData.staff.filter((s) => s.name.toLowerCase().includes(normalized));
  if (nameIncludes.length === 1) return nameIncludes[0];

  return null;
}

function findClientBookingByTargetDate(bookings: BookingRow[], clientId: string, targetDate: string): BookingRow | null {
  const normalized = targetDate.toLowerCase();
  const now = new Date();

  const candidate = bookings.filter((b) => bookingIsActive(b.status) && sameUuid(b.client_id, clientId));
  const directMatches = candidate.filter((b) => {
    const start = new Date(b.start_time);
    const dayName = DAY_NAMES[getBusinessWeekdayIndex(start)];
    const timeString = formatBusinessDateTime(start, { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
    const datePhrase = formatBusinessDateTime(start, { weekday: "long", month: "short", day: "numeric" }).toLowerCase();

    if (normalized.includes(dayName) || normalized.includes(dayName.slice(0, 3))) return true;
    if (normalized.includes(datePhrase)) return true;
    if (normalized.includes(timeString)) return true;
    if (normalized.includes("today") && sameDay(start, now)) return true;
    if (normalized.includes("tomorrow")) {
      const t = new Date(now);
      t.setDate(t.getDate() + 1);
      if (sameDay(start, t)) return true;
    }
    const startParts = getBusinessDateParts(start);
    if (normalized.includes("morning") && startParts.hour < 12) return true;
    if (normalized.includes("afternoon") && startParts.hour >= 12 && startParts.hour < 17) return true;
    if (normalized.includes("evening") && startParts.hour >= 17) return true;
    return false;
  });

  if (directMatches.length === 1) return directMatches[0];
  if (candidate.length === 1) return candidate[0];

  const parsed = new Date(targetDate);
  if (!Number.isNaN(parsed.getTime())) {
    const sameDayMatch = candidate.find((b) => sameDay(new Date(b.start_time), parsed));
    if (sameDayMatch) return sameDayMatch;
  }

  return null;
}

function resolveBookingIdForAction(
  aiData: BusinessAiData,
  clientId: string | null,
  bookingId: string | null,
  targetDate?: string | null,
): string | null {
  if (bookingId && bookingId !== "PENDING_RESOLVE") return bookingId;
  if (!clientId) return null;
  if (targetDate) {
    const resolved = findClientBookingByTargetDate(aiData.bookings, clientId, targetDate);
    if (resolved) return resolved.id;
  }
  const clientBookings = aiData.bookings.filter((b) => bookingIsActive(b.status) && sameUuid(b.client_id, clientId));
  return clientBookings.length === 1 ? clientBookings[0].id : null;
}

async function executeCreateAction(args: {
  businessId: string; phone: string; fallbackClientName: string;
  settings: AiPromptSettings; aiData: BusinessAiData; action: Extract<BookingAction, { type: "CREATE" }>;
}): Promise<AssistantActionResult> {
  const { businessId, phone, fallbackClientName, settings, aiData, action } = args;
  const serviceId = action.service_id;
  const requestedTime = action.start_time_iso;

  if (!serviceId || !requestedTime) {
    return { outcome: "booking_failed", summary: "BOOKING: failed\nMissing service or requested time." };
  }

  const normalizedServiceId = serviceId.toLowerCase();
  const exactServiceId = aiData.services.find((e) => sameUuid(e.id, serviceId));
  const exactServiceName = aiData.services.find((e) => e.name.toLowerCase() === normalizedServiceId);
  const startMatches = aiData.services.filter((e) => e.id.toLowerCase().startsWith(normalizedServiceId));
  const includesMatches = aiData.services.filter((e) => e.name.toLowerCase().includes(normalizedServiceId));
  const service = exactServiceId
    ?? exactServiceName
    ?? startMatches[0]
    ?? (includesMatches.length === 1 ? includesMatches[0] : null);

  if (!service) {
    return { outcome: "booking_failed", summary: "BOOKING: failed\nService was not found." };
  }

  if (!exactServiceId && !exactServiceName && includesMatches.length > 1) {
    return {
      outcome: "booking_failed",
      summary: `BOOKING: failed\nService choice was ambiguous. Please specify the exact service name or id.`,
    };
  }

  const resolvedStaffRow = resolveStaffMember(aiData, action.staff_id);
  const resolvedStaffId = resolvedStaffRow?.id ?? null;
  const requestedStart = parseIsoDateTime(requestedTime);
  if (!requestedStart || Number.isNaN(requestedStart.getTime()) || requestedStart.getTime() <= Date.now()) {
    return { outcome: "booking_failed", summary: "BOOKING: failed\nInvalid or past requested time." };
  }

  const requestedEnd = new Date(requestedStart.getTime() + service.duration * 60_000);
  if (!slotFallsWithinBusinessHours(requestedStart, requestedEnd, aiData.workingHours)) {
    return unavailableResult(aiData, service, resolvedStaffId, "Requested slot is outside business hours.");
  }

  const availableStaff = getAvailableStaffForSlot(aiData, service, requestedStart, resolvedStaffId);
  if (resolvedStaffId && !availableStaff.length) {
    return unavailableResult(aiData, service, resolvedStaffId, `${resolvedStaffRow?.name} is unavailable at that time.`);
  }

  const assigned = availableStaff[0] ?? null;
  if (!assigned && aiData.staff.length > 0) {
    return unavailableResult(aiData, service, null, "No available team member is free at that time.");
  }

  const clientName = action.client_name || fallbackClientName || settings.client_name || "Guest";
  const client = await ensureClient(businessId, phone, clientName);

  if (await checkDuplicateBooking(businessId, client.id, service.id, requestedStart.toISOString())) {
    return { outcome: "booking_already_exists", summary: `BOOKING: exists\nService: ${service.name}\nTime: ${formatDateTimeFriendly(requestedStart)}` };
  }

  const status = settings.auto_confirm ? "confirmed" : "pending";
  const { data, error } = await getSupabaseAdmin().from("bookings").insert({
    business_id: businessId,
    client_id: client.id,
    service_id: service.id,
    staff_id: assigned?.id ?? null,
    start_time: requestedStart.toISOString(),
    end_time: requestedEnd.toISOString(),
    status,
    deposit_paid: false,
    total_amount: service.price,
    notes: action.notes?.trim() || null,
  }).select("id").single();

  if (error || !data?.id) {
    return { outcome: "booking_failed", summary: `BOOKING: failed\n${error?.message ?? "DB insertion error"}` };
  }

  await recordActivity({
    businessId,
    actorType: "ai",
    entityType: "booking",
    entityId: data.id,
    eventType: "booking_created_by_ai",
    title: "AI created a booking",
    description: `${service.name} for ${client.name} on ${formatDateTimeFriendly(requestedStart)}.`,
    metadata: {
      clientId: client.id,
      clientPhone: normalizePhoneLikeValue(phone),
      serviceId: service.id,
      serviceName: service.name,
      staffId: assigned?.id ?? null,
      staffName: assigned?.name ?? null,
      startTime: requestedStart.toISOString(),
      endTime: requestedEnd.toISOString(),
      status,
      totalAmount: service.price,
    },
  });

  invalidateBusinessContext(businessId);
  const deposit = calculateDepositAmount(service, aiData);
  const paymentLink =
    deposit.required && settings.send_payment_links
      ? await createWhatsAppPaymentLink({
          businessId,
          client,
          bookingId: data.id,
          service,
          amount: deposit.amount,
        })
      : null;

  return {
    outcome: "booking_created",
    summary: [
      `BOOKING: success`,
      `Service: ${service.name}`,
      `Staff: ${assigned?.name ?? "Any available operator"}`,
      `Time: ${formatDateTimeFriendly(requestedStart)}`,
      `Price: ${formatCurrency(service.price)}`,
      deposit.required ? `Deposit: ${formatCurrency(deposit.amount)}` : "",
      paymentLink ? `Payment link: ${paymentLink}` : "",
      `Status: ${status}`,
    ].filter(Boolean).join("\n"),
  };
}

async function executeCancelAction(args: {
  businessId: string; clientId: string | null; settings: AiPromptSettings; aiData: BusinessAiData; action: Extract<BookingAction, { type: "CANCEL" }>;
}): Promise<AssistantActionResult> {
  const { businessId, clientId, settings, aiData, action } = args;
  if (!settings.accept_cancellations) {
    return { outcome: "booking_cancel_failed", summary: "CANCEL: failed\nCancellations must be processed directly over call." };
  }

  const bookingId = resolveBookingIdForAction(aiData, clientId, action.booking_id, action.target_date);
  if (!bookingId) {
    return { outcome: "booking_cancel_failed", summary: "CANCEL: failed\nUnable to identify the requested booking from client history." };
  }

  const { data: ex, error: le } = await getSupabaseAdmin().from("bookings")
    .select("id, start_time, status, services(name)")
    .eq("business_id", businessId)
    .eq("id", bookingId)
    .maybeSingle();

  if (le || !ex || !bookingIsActive(ex.status)) {
    return { outcome: "booking_cancel_failed", summary: "CANCEL: failed\nBooking was not found or is already inactive." };
  }

  const cutoffMs = 24 * 60 * 60 * 1000;
  if (new Date(ex.start_time).getTime() - Date.now() < cutoffMs) {
    return { outcome: "booking_cancel_failed", summary: "CANCEL: failed\nThis reservation cannot be cancelled within 24 hours of the appointment." };
  }

  const { error } = await getSupabaseAdmin().from("bookings").update({ status: "cancelled" })
    .eq("id", bookingId).eq("business_id", businessId);
  if (error) {
    return { outcome: "booking_cancel_failed", summary: `CANCEL: failed\n${error.message}` };
  }

  invalidateBusinessContext(businessId);
  return { outcome: "booking_cancelled", summary: `CANCEL: success\nCancelled ${relationName((ex as any).services) ?? "?"} on ${formatDateTimeFriendly(ex.start_time as string)}` };
}

async function executeUpdateTimeAction(args: {
  businessId: string; settings: AiPromptSettings; aiData: BusinessAiData; action: Extract<BookingAction, { type: "UPDATE_TIME" }>;
}): Promise<AssistantActionResult> {
  const { businessId, settings, aiData, action } = args;
  const bookingId = resolveBookingIdForAction(aiData, settings.client_id, action.booking_id);
  if (!bookingId) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nUnable to identify which booking to reschedule." };
  }

  const { data: ex, error: le } = await getSupabaseAdmin().from("bookings")
    .select("id, service_id, staff_id, status, clients(name), services(name)")
    .eq("business_id", businessId)
    .eq("id", bookingId)
    .maybeSingle();
  if (le || !ex || !bookingIsActive(ex.status)) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nActive booking not found." };
  }

  const svc = aiData.services.find((s) => sameUuid(s.id, ex.service_id));
  if (!svc) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nAssociated service not found." };
  }

  const ns = parseIsoDateTime(action.new_start_time_iso);
  if (!ns || Number.isNaN(ns.getTime()) || ns.getTime() <= Date.now()) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nNew requested time is invalid or in the past." };
  }

  const ne = new Date(ns.getTime() + svc.duration * 60_000);
  if (!slotFallsWithinBusinessHours(ns, ne, aiData.workingHours)) {
    return unavailableResult(aiData, svc, action.staff_id || ex.staff_id || null, "New requested slot is outside working hours.");
  }

  const preferredStaff = action.staff_id ? resolveStaffMember(aiData, action.staff_id) : resolveStaffMember(aiData, ex.staff_id ?? null);
  const staffId = preferredStaff?.id ?? null;
  const available = getAvailableStaffForSlot(aiData, svc, ns, staffId);
  if (staffId && !available.length) {
    return unavailableResult(aiData, svc, staffId, "Requested specialist is unavailable at that time.");
  }

  const assigned = available[0] ?? null;
  const { error: ue } = await getSupabaseAdmin().from("bookings").update({
    start_time: ns.toISOString(),
    end_time: ne.toISOString(),
    staff_id: assigned?.id ?? staffId,
    status: settings.auto_confirm ? "confirmed" : ex.status,
  }).eq("id", bookingId).eq("business_id", businessId);

  if (ue) {
    return { outcome: "reschedule_failed", summary: `RESCHEDULE: failed\n${ue.message}` };
  }

  invalidateBusinessContext(businessId);
  return { outcome: "rescheduled", summary: `RESCHEDULE: success\nMoved booking to ${formatDateTimeFriendly(ns)} with ${assigned?.name ?? "selected specialist"}` };
}

async function executeUpdateStaffAction(args: {
  businessId: string; settings: AiPromptSettings; aiData: BusinessAiData; action: Extract<BookingAction, { type: "UPDATE_STAFF" }>;
}): Promise<AssistantActionResult> {
  const { businessId, settings, aiData, action } = args;
  const bookingId = resolveBookingIdForAction(aiData, settings.client_id, action.booking_id);
  if (!bookingId || !action.new_staff_id) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nUnable to identify booking or new staff member." };
  }

  const { data: ex, error: le } = await getSupabaseAdmin().from("bookings")
    .select("id, service_id, start_time, status, staff_id")
    .eq("business_id", businessId)
    .eq("id", bookingId)
    .maybeSingle();
  if (le || !ex || !bookingIsActive(ex.status)) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nActive booking not found." };
  }

  const svc = aiData.services.find((s) => sameUuid(s.id, ex.service_id));
  if (!svc) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nAssociated service not found." };
  }

  const newStaff = resolveStaffMember(aiData, action.new_staff_id);
  if (!newStaff || !staffWorksOnDate(newStaff, new Date(ex.start_time))) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nThe requested specialist is not available on that booking date." };
  }

  const start = new Date(ex.start_time);
  const end = new Date(start.getTime() + svc.duration * 60_000);
  const overlap = aiData.bookings.some((b) => bookingIsActive(b.status) && sameUuid(b.staff_id, newStaff.id) && bookingOverlaps(start, end, b, newStaff.id) && b.id !== bookingId);
  if (overlap) {
    return { outcome: "reschedule_failed", summary: "RESCHEDULE: failed\nThe requested specialist already has another booking at that time." };
  }

  const { error: ue } = await getSupabaseAdmin().from("bookings").update({ staff_id: newStaff.id })
    .eq("id", bookingId).eq("business_id", businessId);
  if (ue) {
    return { outcome: "reschedule_failed", summary: `RESCHEDULE: failed\n${ue.message}` };
  }

  invalidateBusinessContext(businessId);
  return { outcome: "rescheduled", summary: `RESCHEDULE: success\nUpdated specialist to ${newStaff.name} for the existing appointment.` };
}

async function executeActionPipeline(args: {
  businessId: string; phone: string; fallbackClientName: string;
  settings: AiPromptSettings; aiData: BusinessAiData; decision: AiAssistantDecision;
}): Promise<AssistantActionResult> {
  const { decision } = args;
  if (decision.confidence === "low" || !decision.actions.length) {
    return { outcome: "none", summary: "BOOKING: none" };
  }

  const results: AssistantActionResult[] = [];
  for (const action of decision.actions) {
    let result: AssistantActionResult = { outcome: "none", summary: "BOOKING: none" };

    switch (action.type) {
      case "CREATE":
        result = await executeCreateAction({ ...args, action });
        break;
      case "CANCEL":
        result = await executeCancelAction({
          businessId: args.businessId,
          clientId: args.settings.client_id,
          settings: args.settings,
          aiData: args.aiData,
          action,
        });
        break;
      case "UPDATE_TIME":
        result = await executeUpdateTimeAction({
          businessId: args.businessId,
          settings: args.settings,
          aiData: args.aiData,
          action,
        });
        break;
      case "UPDATE_STAFF":
        result = await executeUpdateStaffAction({
          businessId: args.businessId,
          settings: args.settings,
          aiData: args.aiData,
          action,
        });
        break;
      case "NONE":
        result = { outcome: "none", summary: "BOOKING: none" };
        break;
      default:
        result = { outcome: "booking_failed", summary: "PIPELINE: unsupported action type" };
    }

    results.push(result);
    if (result.outcome === "booking_failed" || result.outcome === "booking_cancel_failed" || result.outcome === "reschedule_failed" || result.outcome === "pipeline_failed") {
      break;
    }
  }

  const summary = results.length === 1
    ? results[0].summary
    : results.map((r, index) => `STEP ${index + 1}: ${r.summary}`).join("\n\n");
  const failed = results.some((r) => r.outcome.endsWith("_failed") || r.outcome === "booking_failed");
  return { outcome: failed ? "pipeline_failed" : "success", summary };
}

export async function executeAssistantAction(args: {
  businessId: string; phone: string; fallbackClientName: string;
  settings: AiPromptSettings; aiData: BusinessAiData; decision: AiAssistantDecision;
}): Promise<AssistantActionResult> {
  const { decision } = args;
  console.log(`[EXECUTE] actions=${decision.actions.length} confidence=${decision.confidence}`);
  return executeActionPipeline(args);
}

// ── Deterministic Safe Offsets Extractors ─────────────────────────────────────

interface ExtractedBookingState {
  service: string | null;
  dateRaw: string | null;
  timeRaw: string | null;
  staffRaw: string | null;
  resolvedDate: string | null;
}

function extractBookingStateFromHistory(history: GroqMessage[], aiData?: BusinessAiData): ExtractedBookingState {
  const state: ExtractedBookingState = { service: null, dateRaw: null, timeRaw: null, staffRaw: null, resolvedDate: null };
  if (!history.length) return state;

  const userMessages = history.filter((m) => m.role === "user").map((m) => m.content.toLowerCase());

  const services = aiData?.services ?? [];
  for (const svc of services) {
    const name = svc.name.toLowerCase();
    if (userMessages.some((m) => m.includes(name))) {
      state.service = svc.name;
      break;
    }
  }

  const staff = aiData?.staff ?? [];
  for (const s of staff) {
    const name = s.name.toLowerCase();
    if (userMessages.some((m) => m.includes(name))) {
      state.staffRaw = s.name;
      break;
    }
  }

  const dayWords = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun", "tomorrow", "today", "next week"];
  const datePatterns = [
    /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/,  
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i,  
  ];

  for (const msg of userMessages) {
    for (const day of dayWords) {
      if (msg.includes(day) && !state.dateRaw) state.dateRaw = day;
    }
    for (const pat of datePatterns) {
      const m = msg.match(pat);
      if (m && !state.dateRaw) state.dateRaw = m[0];
    }
  }

  const timePatterns = [
    /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,          
    /\b(\d{1,2})\s*(am|pm)\b/i,                    
    /\b(morning|afternoon|evening|noon|midday)\b/i, 
  ];
  for (const msg of userMessages) {
    for (const pat of timePatterns) {
      const m = msg.match(pat);
      if (m && !state.timeRaw) { state.timeRaw = m[0]; break; }
    }
  }

  if (state.dateRaw) {
    const now = new Date();
    const dayMap: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const key = state.dateRaw.toLowerCase().slice(0, 3);
    if (state.dateRaw === "today") {
      const nowParts = getBusinessDateParts(now);
      const today = createBusinessDate(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0);
      state.resolvedDate = formatBusinessDateTime(today, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } else if (state.dateRaw === "tomorrow") {
      const nowParts = getBusinessDateParts(now);
      const tomorrow = new Date(createBusinessDate(nowParts.year, nowParts.month, nowParts.day, 0, 0, 0));
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      state.resolvedDate = formatBusinessDateTime(tomorrow, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } else if (key in dayMap) {
      const target = dayMap[key];
      const businessWeekday = getBusinessWeekdayIndex(now);
      let diff = target - businessWeekday;
      if (diff <= 0) diff += 7;
      const targetDate = new Date(createBusinessDate(getBusinessDateParts(now).year, getBusinessDateParts(now).month, getBusinessDateParts(now).day, 0, 0, 0));
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      state.resolvedDate = formatBusinessDateTime(targetDate, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
  }

  return state;
}

function formatBookingStateBlock(state: ExtractedBookingState): string {
  const known: string[] = [];
  const needed: string[] = [];

  if (state.service) known.push(`Service: "${state.service}"`);
  else needed.push("service");

  if (state.dateRaw || state.resolvedDate) {
    const dateStr = state.resolvedDate ? `${state.dateRaw} (= ${state.resolvedDate})` : state.dateRaw!;
    if (state.timeRaw) known.push(`Date/Time: ${dateStr} at ${state.timeRaw}`);
    else { known.push(`Date: ${dateStr}`); needed.push("time"); }
  } else {
    needed.push("date & time");
  }

  if (state.staffRaw) known.push(`Staff: "${state.staffRaw}"`);

  const lines: string[] = ["── BOT EXTRACTIONS BUFFER: ──"];
  lines.push(known.length ? `• Candidate details: ${known.join(" | ")}` : "• Candidate details: None yet.");
  lines.push(needed.length ? `• Missing: ${needed.join(", ")}` : "• Missing: None. Confirm before completing.");
  lines.push("• NOTE: Treat candidate details as suggestions only. Confirm them before booking or rescheduling.");
  return lines.join("\n");
}

function buildCombinedPrompt(ctx: string, s: AiPromptSettings, history: GroqMessage[] = [], aiData?: BusinessAiData): string {
  const toneGuide = s.tone === "casual"
    ? "Casual and friendly — end sentences casually, like texting a mate."
    : s.tone === "formal" ? "Professional and extremely polished."
    : "Warm, supportive and clear.";

  let actionBlock = "";
  if (s.action_summary?.startsWith("BOOKING: success")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Booked successfully. Summarize details (svc, staff, date/time, price) and confirm in 2 short lines. If ACTION RES includes a Payment link, include that full link exactly once.`;
  } else if (s.action_summary?.startsWith("BOOKING: failed")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Slot busy. Apologize and list the alternative slot suggestions clearly. Use short lines or bullets for available times, not a long comma-separated sentence.`;
  } else if (s.action_summary?.startsWith("BOOKING: exists")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Inform them this block has already been reserved. Keep the message short and clear.`;
  } else if (s.action_summary?.startsWith("CANCEL: success")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Cancellation complete. Confirm with user, offer to book something else.`;
  } else if (s.action_summary?.startsWith("CANCEL: failed")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Explain cancellation was unsuccessful.`;
  } else if (s.action_summary?.startsWith("RESCHEDULE: success")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Rescheduled complete. Confirm new date/time.`;
  } else if (s.action_summary?.startsWith("RESCHEDULE: failed")) {
    actionBlock = `\n[ACTION RES]: ${s.action_summary}\nINSTRUCTION: Reschedule unsuccessful. Explain reason.`;
  }

  const jsonExample = `{"confidence":"high","needs_human":false,"missing_fields":[],"actions":[{"type":"CREATE","service_id":"svc-haircut","staff_id":"staff-torben","start_time_iso":"2026-06-20T10:00:00+02:00","client_name":null,"notes":"Short haircut"}]}`;

  const stateBlock = formatBookingStateBlock(extractBookingStateFromHistory(history, aiData));
  const customerBlock = `CUSTOMER PROFILE:\n  Name: ${s.client_name}\n  Known customer: ${s.client_id ? "yes" : "no"}\n  First message: ${s.is_first_message ? "yes" : "no"}\n  Within business hours: ${s.within_business_hours ? "yes" : "no"}\n  Auto-confirm: ${s.auto_confirm ? "yes" : "no"}`;

  return `You are "${s.bot_name}", an elegant salon assistant. Time: ${s.current_time}. Tone: ${toneGuide}. Hours: ${s.working_hours}.
${actionBlock}

${stateBlock}

${customerBlock}

BUSINESS DIRECTORIES (Use full id= keys for JSON):
${ctx}

IMPORTANT: The BOT EXTRACTIONS BUFFER contains candidate details only. Treat these as unconfirmed suggestions, not final booking details. Always ask the user to confirm service, date/time, and stylist before making or changing a booking unless they explicitly agree.
- Do not guess a service or stylist when the match is ambiguous. Ask for the exact service name or staff name if needed.
- Do not reuse prior appointment details from history unless the user explicitly requests the same booking or clearly references it.

If the user is asking for a new booking, handle it as a fresh booking request. Do not reuse previous booking details from history unless the user clearly says they want the same appointment or same details.

When cancelling or updating a booking, choose the exact booking_id from the CLIENT HISTORY block. If the customer cannot name the UUID, use booking_id: "PENDING_RESOLVE" and include target_date with the human slot description.

If the user asks to reschedule and there is exactly one clear upcoming booking, resolve that booking automatically. If the booking is ambiguous, return missing_fields or booking_id: "PENDING_RESOLVE" and ask the user to clarify which appointment (date/time/service/staff).

IMPORTANT: If the customer name is already known from WhatsApp, do not ask for it again. Use the known customer name in confirmations. For CREATE actions, client_name may be null when the name is already known.

IMPORTANT: For new bookings, return start_time_iso in local South Africa time (+02:00) or in plain local ISO format without \`Z\`. Do not return UTC \`Z\` timestamps.

MANDATORY OUTPUT PATTERN:
[single line raw JSON]
---REPLY---
[custom WhatsApp reply]

EXAMPLE:
${jsonExample}
---REPLY---
Sounds perfect! Checking calendar availability for that blowout.

RULES:
- Keep the REPLY short and WhatsApp-friendly.
- Never show day + times in a single comma-separated sentence. Use bullet lines or one line per slot instead.
- If you are listing available times, use separate lines or bullets instead of a long comma-separated list.
- When a booking detail is missing, ask only one question at a time.
- If service is missing, ask only for the service.
- If date/day is missing, ask only for the date or day.
- If time is missing, ask only for the time.
- If staff is missing, ask only for the stylist preference.
- Do not bundle multiple follow-up questions in the same reply.
- Do not ask for service, date, time, and stylist all in one message.
- If both date and time are missing, ask the date first, then ask the time in a separate reply.
- Do not offer available slots unless the user explicitly asks for availability.
- If you are not sure about a detail, ask a confirming question rather than making a booking.
- Use full literal UUID values for ids. Never truncate.
- NEVER disclose technical code blocks or JSON schema to user in REPLY.

GOOD EXAMPLES:
Please tell me which service you’d like to book.
What day would you like for your appointment?
What time works for you on that day?

GOOD AVAILABILITY EXAMPLE:
Monday 22 June 2026:
• 9:30 am
• 10:00 am
• 10:30 am
Which time works best for you?

BAD EXAMPLE:
Sure! For a hair cut, could you let me know which day and time you’d like, and if you have a preferred stylist?
GOOD AVAILABILITY EXAMPLE:
We have hair-cut slots on Monday 22 June 2026:
• 9:00 am
• 9:30 am
• 10:00 am
Which time works best for you?`;
}

// ── Cerebras Fetch Connector ──────────────────────────────────────────────────

async function callCerebras(messages: GroqMessage[], userId: string, label = "call"): Promise<string> {
  const key = process.env["CEREBRAS_API_KEY"]?.trim();
  if (!key) throw new Error("CEREBRAS_API_KEY is missing in environment secrets.");

  return enqueueForUser(userId, () =>
    withRetry(async () => {
      const res = await fetch(`${AI_API_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: AI_MODEL, messages, temperature: 0.15, max_tokens: 900 }),
      });
      if (!res.ok) {
        throw new Error(`Cerebras Status: ${res.status}`);
      }
      const json = (await res.json()) as any;
      return json.choices[0]?.message?.content?.trim() ?? "";
    }, label),
  );
}

function parseCombinedResponse(raw: string, aiData?: BusinessAiData): { decision: AiAssistantDecision; reply: string } {
  const SEP = "---REPLY---";
  const sepIdx = raw.indexOf(SEP);

  let jsonPart = raw;
  let replyPart = "";
  if (sepIdx !== -1) {
    jsonPart = raw.slice(0, sepIdx).trim();
    replyPart = raw.slice(sepIdx + SEP.length).trim();
  }

  let decision = makeDefaultDecision();
  let reply = replyPart;

  try {
    const jsonStr = extractJsonObject(jsonPart);
    if (jsonStr) {
      try {
        decision = sanitizeDecision(JSON.parse(jsonStr));
      } catch (innerError) {
        const repaired = repairJsonString(jsonStr);
        decision = sanitizeDecision(JSON.parse(repaired));
      }
    } else {
      reply = reply || raw.trim();
      return { decision, reply: formatAvailabilityReply(reply) };
    }
  } catch (e) {
    console.warn("[DECISION] Parse exception:", e, "raw response:", raw);
    reply = reply || raw.trim();
  }

  if (!reply) {
    reply = raw.trim();
  }

  return { decision, reply: formatAvailabilityReply(reply) };
}

function formatAvailabilityReply(reply: string): string {
  return reply
    .split("\n")
    .map((line) => {
      const match = line.match(/(.*\b(?:slots|available times|available slots|open slots|times available|slots available)\b.*?\b(?:on|for)\s+)(.+?)\s+at\s+([0-9][0-9:\sapm, ]+?)([.?!]?)(.*)$/i);
      if (!match) return line;
      const prefix = match[1].trim();
      const dateText = match[2].trim();
      const timesText = match[3].trim();
      const trailing = match[5] ? ` ${match[5].trim()}` : "";
      const slots = timesText.split(/\s*,\s*/).map((t) => t.trim()).filter(Boolean);
      if (slots.length < 2) return line;
      return `${prefix}${dateText}:\n${slots.map((s) => `• ${s}`).join("\n")}${match[4] || ""}${trailing}`;
    })
    .join("\n");
}

// ── ORCHESTRATOR ENTRYPOINT ──────────────────────────────────────────────────

export async function getDecisionAndReply(
  history: GroqMessage[],
  ctx: string,
  settings: AiPromptSettings,
  aiData: BusinessAiData | undefined,
  userId: string,
): Promise<{ decision: AiAssistantDecision; reply: string }> {
  const safeAiData = aiData ?? EMPTY_AI_DATA;
  let raw: string;
  try {
    raw = await callCerebras(
      [{ role: "system", content: buildCombinedPrompt(ctx, settings, history, safeAiData) }, ...history],
      userId,
      "combined-pass1",
    );
  } catch (e) {
    return {
      decision: makeDefaultDecision(),
      reply: settings.fallback_message || "Apologies, I'm experiencing cognitive load errors. Try shortly!",
    };
  }

  const { decision, reply } = parseCombinedResponse(raw, safeAiData);
  return { decision, reply: reply || buildFallbackReply(decision, settings) };
}

export async function getConfirmationReply(
  history: GroqMessage[],
  ctx: string,
  settings: AiPromptSettings,
  aiData: BusinessAiData,
  userId: string,
  actionSummary: string,
): Promise<string> {
  const updatedSettings: AiPromptSettings = { ...settings, action_summary: actionSummary };
  let raw: string;
  try {
    raw = await callCerebras(
      [{ role: "system", content: buildCombinedPrompt(ctx, updatedSettings, history, aiData) }, ...history],
      userId,
      "combined-confirm",
    );
  } catch (e) {
    return buildActionFallbackReply(actionSummary, settings);
  }

  const SEP = "---REPLY---";
  const sepIdx = raw.indexOf(SEP);
  const reply = sepIdx !== -1 ? raw.slice(sepIdx + SEP.length).trim() : "";
  return reply || buildActionFallbackReply(actionSummary, settings);
}

function buildActionFallbackReply(actionSummary: string, s: AiPromptSettings): string {
  if (actionSummary.startsWith("BOOKING: success")) {
    const lines = actionSummary.split("\n");
    const svc = lines.find((l) => l.startsWith("Service:"))?.replace("Service:", "").trim() ?? "Appointment";
    const time = lines.find((l) => l.startsWith("Time:"))?.replace("Time:", "").trim() ?? "";
    const staff = lines.find((l) => l.startsWith("Staff:"))?.replace("Staff:", "").trim() ?? "";
    const price = lines.find((l) => l.startsWith("Price:"))?.replace("Price:", "").trim() ?? "";
    const deposit = lines.find((l) => l.startsWith("Deposit:"))?.replace("Deposit:", "").trim() ?? "";
    const paymentLink = lines.find((l) => l.startsWith("Payment link:"))?.replace("Payment link:", "").trim() ?? "";
    const result = [
      "✅ Booking confirmed!",
      `• Service: ${svc}`,
      time ? `• Time: ${time}` : "",
      staff ? `• Stylist: ${staff}` : "",
      price ? `• Price: ${price}` : "",
      deposit ? `• Deposit: ${deposit}` : "",
      paymentLink ? `Pay your deposit here: ${paymentLink}` : "",
      "See you soon!",
    ].filter(Boolean).join("\n");
    return result;
  }
  if (actionSummary.startsWith("BOOKING: failed")) {
    const reason = actionSummary.split("\n").find((l) => l.startsWith("Reason:"))?.replace("Reason:", "").trim();
    const alts = actionSummary.split("\n").filter((l) => l.trim().match(/^\d+\./));
    const lines = [
      "Sorry, I couldn't book that slot.",
      reason ? `Reason: ${reason}` : "",
    ];
    if (alts.length) {
      lines.push("\nAvailable options:");
      lines.push(...alts.map((alt) => alt.trim()));
      lines.push("Please choose one of these times.");
    }
    return lines.filter(Boolean).join("\n");
  }
  if (actionSummary.startsWith("CANCEL: success")) {
    return [
      "✅ Booking cancelled.",
      "If you'd like, I can help you book another appointment.",
    ].join("\n");
  }
  if (actionSummary.startsWith("CANCEL: failed")) {
    const reason = actionSummary.split("\n").slice(1).join(" ").trim();
    return [
      "I couldn't cancel that booking right now.",
      reason ? `Reason: ${reason}` : "Please check the booking details and try again.",
    ].filter(Boolean).join("\n");
  }
  if (actionSummary.startsWith("RESCHEDULE: success")) {
    const time = (actionSummary.split("\n").find((l) => l.startsWith("Moved booking to"))?.replace("Moved booking to", "").trim() || actionSummary.split("\n").find((l) => l.startsWith("New time:"))?.replace("New time:", "").trim()) ?? "";
    return [
      "✅ Appointment updated.",
      time ? `New time: ${time}` : "",
      "Let me know if you'd like to change anything else.",
    ].filter(Boolean).join("\n");
  }
  if (actionSummary.startsWith("RESCHEDULE: failed")) {
    const reason = actionSummary.split("\n").slice(1).join(" ").trim();
    return [
      "I couldn't move that booking right now.",
      reason ? `Reason: ${reason}` : "Please try a different time.",
    ].filter(Boolean).join("\n");
  }
  return s.fallback_message || "I'm sorry, something went wrong. Let me try that again for you.";
}

function buildFallbackReply(decision: AiAssistantDecision, s: AiPromptSettings): string {
  const primaryAction = decision.actions[0];
  if (decision.missing_fields.length) {
    let first = decision.missing_fields[0];
    if (decision.missing_fields.includes("date") && decision.missing_fields.includes("time")) {
      first = "date";
    }
    if (first === "service") return "Which service would you like to book?";
    if (first === "date") return "Which day or date would you like for your appointment?";
    if (first === "time" || first === "start_time_iso") return "What time would you like for that appointment?";
    if (first === "staff_id") return "Do you have a preferred stylist for this booking?";
    if (first === "client_name") return "What name should I use for this booking?";
    return `Can you share your preferred ${first} so I can continue?`;
  }

  if (primaryAction?.type === "CANCEL") {
    return "Which booking would you like to cancel?";
  }

  if (primaryAction?.type === "UPDATE_TIME") {
    return "What date would you like to reschedule the appointment to?";
  }

  if (primaryAction?.type === "UPDATE_STAFF") {
    return "Which specialist would you like for this appointment?";
  }

  if (primaryAction?.type === "CREATE") {
    if (decision.missing_fields.includes("service")) return "Which service would you like to book?";
    if (decision.missing_fields.includes("date")) return "Which day or date works best for you?";
    if (decision.missing_fields.includes("time") || decision.missing_fields.includes("start_time_iso")) return "What time would you like for your appointment?";
    if (decision.missing_fields.includes("staff_id")) return "Do you have a preferred stylist for this booking?";
    return "What would you like to book?";
  }

  if (decision.needs_human) {
    if (!decision.actions.length) {
      return "I’m not sure I understood that yet. Can you tell me which service you want to book?";
    }
    return s.fallback_message || "I’m sorry, this request needs a human to help you. Please hold on while I connect you.";
  }

  const customer = s.client_name && s.client_name.toLowerCase() !== "there" ? s.client_name : "there";
  return `Hi ${customer}! How can I help you with your booking today?`;
}

// ── BACKWARDS COMPATIBILITIES ────────────────────────────────────────────────

export async function getGroqDecision(
  history: GroqMessage[],
  ctx: string,
  settings: AiPromptSettings,
  aiData?: BusinessAiData,
  userId?: string,
): Promise<AiAssistantDecision> {
  const { decision } = await getDecisionAndReply(history, ctx, settings, aiData, userId ?? "global");
  return decision;
}

export async function getGroqCompletion(
  history: GroqMessage[],
  ctx: string,
  settings: AiPromptSettings,
  aiData?: BusinessAiData,
  userId?: string,
): Promise<string> {
  const { reply } = await getDecisionAndReply(history, ctx, settings, aiData, userId ?? "global");
  return reply;
}

// ── Dev phone configurations ─────────────────────────────────────────────────

export function parseDevOnlyPhones(): string[] {
  const raw = process.env["WHATSAPP_AI_DEV_ONLY_PHONES"]?.trim();
  return raw ? raw.split(",").map((p) => p.trim()).filter(Boolean) : [];
}

export function shouldReplyToPhone(phone: string): boolean {
  const devPhones = parseDevOnlyPhones();
  return !devPhones.length || devPhones.some((t) => phoneMatchesTarget(phone, t));
}
