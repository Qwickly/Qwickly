/**
 * WhatsApp AI unit test suite.
 *
 * Fast and free — no Cerebras API calls, no database access.
 * Tests all deterministic logic: phone matching, date parsing, JSON repair,
 * entity resolution, booking ID disambiguation, availability, and AI response
 * parsing.
 *
 * Run: pnpm wa:unit-test
 *
 * Key regressions covered by this suite:
 *   - Wrong-booking cancel bug (resolveBookingIdForAction must return null when
 *     multiple bookings exist and no date hint was given — never guess the soonest)
 *   - False-confirm bug (parsedOk:false → never relay reply that claims booking
 *     happened when JSON was unreadable)
 *   - UUID-in-reply bug (redactInternalIds must strip UUIDs before sending)
 *   - Month-mismatch cancel (findClientBookingByTargetDate must reject "7 August"
 *     when the booking is on 7 July)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Load .env before any imports that read process.env ────────────────────────

const __dir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dir, "../../artifacts/api-server");

function loadEnvFile(filepath: string): void {
  try {
    const text = readFileSync(filepath, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* .env not present — ok */ }
}

loadEnvFile(path.join(apiRoot, ".env"));
loadEnvFile(path.join(apiRoot, ".env.local"));

// ── Import module under test ───────────────────────────────────────────────────

const waAi = await import(
  "../../artifacts/api-server/src/lib/whatsapp-ai.ts"
) as typeof import("../../artifacts/api-server/src/lib/whatsapp-ai.ts");

const {
  phoneMatchesTarget,
  normalizePhoneLikeValue,
  isWithinWorkingHours,
  formatWorkingHoursText,
  nextOpeningTime,
  getDecisionAndReply,
} = waAi;

// Private helpers exposed via _forTesting
const {
  parseIsoDateTime,
  extractJsonObject,
  repairJsonString,
  sanitizeDecision,
  resolveEntity,
  findClientBookingByTargetDate,
  resolveBookingIdForAction,
  slotFallsWithinBusinessHours,
  bookingOverlaps,
  parseCombinedResponse,
  redactInternalIds,
  formatAvailabilityReply,
  policyDeclineMessage,
} = waAi._forTesting!;

// ── Mini sequential async test runner ─────────────────────────────────────────

let _currentGroup = "";
let passed = 0;
let failed = 0;
const failures: { name: string; error: string }[] = [];
const tests: { label: string; fn: () => void | Promise<void> }[] = [];

function describe(label: string, fn: () => void): void {
  _currentGroup = label;
  fn();
  _currentGroup = "";
}

function it(name: string, fn: () => void | Promise<void>): void {
  tests.push({
    label: _currentGroup ? `${_currentGroup} → ${name}` : name,
    fn,
  });
}

async function run(): Promise<void> {
  console.log("\x1b[1mWhatsApp AI — Unit Tests\x1b[0m\n");
  for (const t of tests) {
    try {
      await t.fn();
      process.stdout.write(`  \x1b[32m✓\x1b[0m ${t.label}\n`);
      passed++;
    } catch (e: any) {
      const msg = (e?.message ?? String(e)).replace(/\n/g, "\n    ");
      process.stdout.write(
        `  \x1b[31m✗\x1b[0m ${t.label}\n    \x1b[2m${msg}\x1b[0m\n`,
      );
      failures.push({ name: t.label, error: e?.message ?? String(e) });
      failed++;
    }
  }

  console.log(`\n${"─".repeat(62)}`);
  console.log(
    `\x1b[32m${passed} passed\x1b[0m` +
      (failed ? `, \x1b[31m${failed} failed\x1b[0m` : "") +
      `  (${tests.length} total)`,
  );

  if (failures.length) {
    console.log("\nFailed:");
    for (const f of failures)
      console.log(`  \x1b[31m✗\x1b[0m ${f.name}\n    ${f.error}`);
    process.exit(1);
  }
}

// ── Date helper ───────────────────────────────────────────────────────────────
// Calendar anchors (all SAST +02:00):
//   2026-08-03 = Monday    2026-08-04 = Tuesday   2026-08-05 = Wednesday
//   2026-08-06 = Thursday  2026-08-07 = Friday    2026-08-08 = Saturday
//   2026-08-09 = Sunday

function sast(localIso: string): Date {
  return new Date(localIso + "+02:00");
}

// ── Fixture builders ──────────────────────────────────────────────────────────

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

const SVC_HAIRCUT = {
  id: "aaaa0000-0000-0000-0000-000000000001",
  name: "Haircut",
  description: "",
  price: 150,
  duration: 30,
  deposit_required: false,
  deposit_amount: 0,
};

const SVC_COLOUR = {
  id: "bbbb0000-0000-0000-0000-000000000002",
  name: "Hair Colour",
  description: "",
  price: 350,
  duration: 90,
  deposit_required: true,
  deposit_amount: 100,
};

const STAFF_TORBEN = {
  id: "cccc0000-0000-0000-0000-000000000001",
  name: "Torben",
  position: "Stylist",
  working_days: [...WEEKDAYS],
};

const STAFF_KAYLIN = {
  id: "dddd0000-0000-0000-0000-000000000002",
  name: "Kaylin",
  position: "Nail Tech",
  working_days: [...WEEKDAYS, "saturday"],
};

const HOURS_MON_FRI = [
  ...WEEKDAYS.map((d) => ({
    day_name: d,
    is_open: true,
    open_time: "09:00",
    close_time: "17:00",
  })),
  { day_name: "saturday", is_open: false, open_time: "09:00", close_time: "17:00" },
  { day_name: "sunday", is_open: false, open_time: "09:00", close_time: "17:00" },
];

const HOURS_MON_SAT = [
  ...WEEKDAYS.map((d) => ({
    day_name: d,
    is_open: true,
    open_time: "09:00",
    close_time: "17:00",
  })),
  { day_name: "saturday", is_open: true, open_time: "09:00", close_time: "13:00" },
  { day_name: "sunday", is_open: false, open_time: "09:00", close_time: "17:00" },
];

let _bkgSeq = 1;

function makeBooking(
  overrides: Partial<{
    id: string;
    client_id: string;
    service_id: string;
    start_time: string;
    end_time: string;
    status: string;
    staff_id: string | null;
  }> = {},
): any {
  return {
    id: `bkg-test-${_bkgSeq++}`,
    client_id: "client-1",
    service_id: SVC_HAIRCUT.id,
    start_time: "2026-08-03T10:00:00+02:00",
    end_time: "2026-08-03T10:30:00+02:00",
    status: "confirmed",
    staff_id: STAFF_TORBEN.id,
    total_amount: 150,
    deposit_paid: false,
    services: { name: "Haircut" },
    staff_members: { name: "Torben" },
    clients: { name: "Test User" },
    ...overrides,
  };
}

function makeAiData(overrides: Partial<any> = {}): any {
  return {
    businessName: "Test Salon",
    businessDescription: "A test hair salon.",
    services: [SVC_HAIRCUT, SVC_COLOUR],
    staff: [STAFF_TORBEN, STAFF_KAYLIN],
    bookings: [],
    bookingPage: null,
    depositSettings: null,
    workingHours: HOURS_MON_SAT,
    faqs: [],
    ...overrides,
  };
}

function makeSettings(overrides: Partial<any> = {}): any {
  return {
    bot_name: "Sunny",
    tone: "professional",
    welcome_message: "Hi! Welcome.",
    fallback_message: "Sorry, something went wrong. A team member will follow up.",
    auto_confirm: false,
    accept_cancellations: true,
    cancellation_min_notice_hours: 0,
    cancellation_decline_message: "",
    accept_reschedules: true,
    reschedule_min_notice_hours: 0,
    reschedule_decline_message: "",
    send_payment_links: false,
    answer_faqs: false,
    working_hours: "Mon–Fri: 09:00–17:00",
    always_on: true,
    client_name: "Test User",
    client_id: null,
    is_first_message: true,
    within_business_hours: true,
    current_time: "Monday, 3 August 2026 at 10:00 (SAST)",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Phone utilities ────────────────────────────────────────────────────────

describe("phoneMatchesTarget", () => {
  it("exact match", () => {
    assert(phoneMatchesTarget("27821234567", "27821234567"));
  });
  it("SA 0xx format matches 27xx format", () => {
    assert(phoneMatchesTarget("27821234567", "0821234567"));
  });
  it("reversed — 0xx compared against 27xx", () => {
    assert(phoneMatchesTarget("0821234567", "27821234567"));
  });
  it("trailing 9 digits match", () => {
    assert(phoneMatchesTarget("27821234567", "821234567"));
  });
  it("different numbers do not match", () => {
    assert(!phoneMatchesTarget("27821234567", "27839999999"));
  });
  it("empty string returns false", () => {
    assert(!phoneMatchesTarget("", "27821234567"));
  });
  it("non-digit characters stripped before compare", () => {
    assert(phoneMatchesTarget("+27 82 123 4567", "0821234567"));
  });
});

describe("normalizePhoneLikeValue", () => {
  it("strips non-digit characters", () => {
    assert.equal(normalizePhoneLikeValue("+27 82 123 4567"), "27821234567");
  });
  it("null → empty string", () => {
    assert.equal(normalizePhoneLikeValue(null), "");
  });
  it("digits pass through unchanged", () => {
    assert.equal(normalizePhoneLikeValue("0821234567"), "0821234567");
  });
});

// ── 2. Date parsing ───────────────────────────────────────────────────────────

describe("parseIsoDateTime", () => {
  it("local ISO with seconds → treats as SAST (+02:00)", () => {
    const d = parseIsoDateTime("2026-08-03T10:00:00");
    assert.notEqual(d, null);
    assert.equal(d!.getUTCHours(), 8); // 10:00 SAST = 08:00 UTC
  });
  it("16-char format (no seconds) → same hour interpretation", () => {
    const d = parseIsoDateTime("2026-08-03T10:00");
    assert.notEqual(d, null);
    assert.equal(d!.getUTCHours(), 8);
  });
  it("date-only → midnight SAST (22:00 UTC the previous calendar day)", () => {
    const d = parseIsoDateTime("2026-08-03");
    assert.notEqual(d, null);
    // midnight SAST on Aug 3 = 22:00 UTC on Aug 2
    assert.equal(d!.getUTCHours(), 22);
    assert.equal(d!.getUTCDate(), 2);
  });
  it("Z suffix reinterpreted as +02:00 (design choice to avoid 2-hour lag)", () => {
    const d = parseIsoDateTime("2026-08-03T10:00:00Z");
    assert.notEqual(d, null);
    assert.equal(d!.getUTCHours(), 8);
  });
  it("already offset ISO parses as-is", () => {
    const d = parseIsoDateTime("2026-08-03T10:00:00+02:00");
    assert.notEqual(d, null);
    assert.equal(d!.getUTCHours(), 8);
  });
  it("garbage string returns null", () => {
    assert.equal(parseIsoDateTime("not-a-date"), null);
  });
  it("empty string returns null", () => {
    assert.equal(parseIsoDateTime(""), null);
  });
});

// ── 3. JSON extraction ────────────────────────────────────────────────────────

describe("extractJsonObject", () => {
  it("bare JSON object returned verbatim", () => {
    const j = '{"confidence":"high","actions":[]}';
    assert.equal(extractJsonObject(j), j);
  });
  it("JSON surrounded by prose → only the object extracted", () => {
    const j = '{"confidence":"high"}';
    assert.equal(extractJsonObject(`Preamble ${j} more text`), j);
  });
  it("JSON in markdown code fence → extracted", () => {
    const j = '{"confidence":"low","actions":[]}';
    assert.equal(extractJsonObject("```json\n" + j + "\n```"), j);
  });
  it("nested objects correctly balanced", () => {
    const j = '{"a":{"b":"c"},"d":[1,2]}';
    assert.equal(extractJsonObject(j), j);
  });
  it("truncated JSON (missing closing brace) → returns the remainder starting at {", () => {
    const raw = '{"confidence":"high","actions":[{"type":"CREATE"}';
    const result = extractJsonObject(raw);
    assert.notEqual(result, null);
    assert.ok(result!.startsWith("{"));
  });
  it("no JSON at all → null", () => {
    assert.equal(extractJsonObject("just plain text"), null);
  });
  it("takes the FIRST object when multiple are present", () => {
    assert.equal(extractJsonObject('{"first":1} {"second":2}'), '{"first":1}');
  });
});

// ── 4. JSON repair ────────────────────────────────────────────────────────────

describe("repairJsonString", () => {
  it("already-valid JSON passes through", () => {
    const j = '{"confidence":"high","actions":[]}';
    JSON.parse(repairJsonString(j)); // must not throw
  });
  it("trailing comma before } removed", () => {
    const repaired = repairJsonString('{"key":"val",}');
    JSON.parse(repaired);
    assert.ok(!repaired.includes(",}"));
  });
  it("unclosed string → quote and brace appended", () => {
    const repaired = repairJsonString('{"key":"val');
    JSON.parse(repaired);
    assert.ok(repaired.endsWith("}"));
  });
  it("unclosed array + object → both closers appended", () => {
    const repaired = repairJsonString('{"items":[1,2');
    JSON.parse(repaired);
    assert.ok(repaired.endsWith("]}"));
  });
  it("curly/smart quotes replaced with straight quotes", () => {
    // U+201C " and U+201D "
    const repaired = repairJsonString('{“key”:“val”}');
    JSON.parse(repaired);
    assert.ok(repaired.includes('"key"'));
  });
  it("trailing comma before ] removed", () => {
    const repaired = repairJsonString('{"a":[1,2,]}');
    JSON.parse(repaired);
  });
});

// ── 5. Decision sanitization ──────────────────────────────────────────────────

describe("sanitizeDecision", () => {
  it("new actions-array CREATE format", () => {
    const d = sanitizeDecision({
      confidence: "high",
      needs_human: false,
      missing_fields: [],
      actions: [{
        type: "CREATE",
        service_id: SVC_HAIRCUT.id,
        start_time_iso: "2026-08-03T10:00:00+02:00",
        staff_id: null,
      }],
    });
    assert.equal(d.confidence, "high");
    assert.equal(d.actions[0]?.type, "CREATE");
  });
  it("CANCEL action preserved with booking_id", () => {
    const d = sanitizeDecision({
      confidence: "high",
      actions: [{ type: "CANCEL", booking_id: "bkg-123", reason: "customer request" }],
    });
    const a = d.actions[0];
    assert.equal(a?.type, "CANCEL");
    if (a?.type === "CANCEL") assert.equal(a.booking_id, "bkg-123");
  });
  it("UPDATE_TIME action preserved with new_start_time_iso", () => {
    const d = sanitizeDecision({
      confidence: "medium",
      actions: [{
        type: "UPDATE_TIME",
        booking_id: "PENDING_RESOLVE",
        new_start_time_iso: "2026-08-05T14:00:00+02:00",
        target_date: "Wednesday",
      }],
    });
    const a = d.actions[0];
    assert.equal(a?.type, "UPDATE_TIME");
    if (a?.type === "UPDATE_TIME")
      assert.equal(a.new_start_time_iso, "2026-08-05T14:00:00+02:00");
  });
  it("unknown confidence → 'low'", () => {
    assert.equal(sanitizeDecision({ confidence: "very_high", actions: [] }).confidence, "low");
  });
  it("'medium' confidence allowed through", () => {
    assert.equal(sanitizeDecision({ confidence: "medium", actions: [] }).confidence, "medium");
  });
  it("NONE action entries filtered out of array", () => {
    const d = sanitizeDecision({
      confidence: "high",
      actions: [
        { type: "NONE" },
        { type: "CREATE", service_id: SVC_HAIRCUT.id, start_time_iso: "2026-08-03T10:00:00+02:00", staff_id: null },
      ],
    });
    assert.equal(d.actions.length, 1);
    assert.equal(d.actions[0]?.type, "CREATE");
  });
  it("missing missing_fields defaults to []", () => {
    assert.deepEqual(sanitizeDecision({ confidence: "high", actions: [] }).missing_fields, []);
  });
  it("legacy flat intent:book format migrated to CREATE action", () => {
    const d = sanitizeDecision({
      confidence: "high",
      intent: "book",
      booking: {
        should_create: true,
        service_id: SVC_HAIRCUT.id,
        start_time_iso: "2026-08-03T10:00:00+02:00",
      },
    });
    assert.equal(d.actions.length, 1);
    assert.equal(d.actions[0]?.type, "CREATE");
  });
  it("legacy intent:cancel migrated to CANCEL action", () => {
    const d = sanitizeDecision({
      confidence: "high",
      intent: "cancel",
      cancellation: { should_cancel: true, booking_id: "bkg-999" },
    });
    assert.equal(d.actions[0]?.type, "CANCEL");
  });
});

// ── 6. Entity resolution ──────────────────────────────────────────────────────

describe("resolveEntity", () => {
  const list = [
    { id: "aaaa0000-0000-0000-0000-000000000001", name: "Haircut" },
    { id: "bbbb0000-0000-0000-0000-000000000002", name: "Hair Colour" },
    { id: "cccc0000-0000-0000-0000-000000000003", name: "Blowout" },
  ];

  it("exact UUID match", () => {
    const { match, ambiguous } = resolveEntity(list, "aaaa0000-0000-0000-0000-000000000001");
    assert.equal(match?.name, "Haircut");
    assert.equal(ambiguous, false);
  });
  it("exact name match (case-insensitive)", () => {
    assert.equal(resolveEntity(list, "haircut").match?.name, "Haircut");
  });
  it("unique ID prefix match", () => {
    assert.equal(resolveEntity(list, "aaaa").match?.name, "Haircut");
  });
  it("unique name substring match", () => {
    assert.equal(resolveEntity(list, "blowout").match?.name, "Blowout");
  });
  it("ambiguous substring (multiple contain 'hair') → null + ambiguous:true", () => {
    const r = resolveEntity(list, "hair");
    assert.equal(r.match, null);
    assert.equal(r.ambiguous, true);
  });
  it("no match → null + ambiguous:false", () => {
    const r = resolveEntity(list, "manicure");
    assert.equal(r.match, null);
    assert.equal(r.ambiguous, false);
  });
  it("empty candidate → null + ambiguous:false", () => {
    const r = resolveEntity(list, "");
    assert.equal(r.match, null);
    assert.equal(r.ambiguous, false);
  });
});

// ── 7. Booking date matching (findClientBookingByTargetDate) ──────────────────
// Critical: guards the wrong-booking cancel bug.
// Fixture dates: bkgMon = Monday Aug 3 10am, bkgTue = Tuesday Aug 4 2pm

describe("findClientBookingByTargetDate", () => {
  const CLIENT = "client-1";

  const bkgMon = makeBooking({
    id: "bkg-mon",
    start_time: "2026-08-03T10:00:00+02:00",
    end_time: "2026-08-03T10:30:00+02:00",
  });
  const bkgTue = makeBooking({
    id: "bkg-tue",
    start_time: "2026-08-04T14:00:00+02:00",
    end_time: "2026-08-04T14:30:00+02:00",
  });

  it("single booking always returned regardless of description", () => {
    const r = findClientBookingByTargetDate([bkgMon], CLIENT, "something vague");
    assert.equal(r?.id, "bkg-mon");
  });
  it("'monday' matches the Monday booking", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "monday")?.id, "bkg-mon");
  });
  it("'tuesday' matches the Tuesday booking", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "tuesday")?.id, "bkg-tue");
  });
  it("'3rd' (day-of-month) matches booking on the 3rd", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "the 3rd")?.id, "bkg-mon");
  });
  it("'4 August' matches August 4 booking", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "4 August")?.id, "bkg-tue");
  });
  it("'4 September' does NOT match August 4 booking (month mismatch — regression)", () => {
    // This was the specific bug: "7 August" would match a booking on 7 July
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "4 September"), null);
  });
  it("'morning' matches 10am booking (before noon)", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "morning")?.id, "bkg-mon");
  });
  it("'afternoon' matches 2pm booking", () => {
    assert.equal(findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "afternoon")?.id, "bkg-tue");
  });
  it("no hint with multiple bookings → null (never guess)", () => {
    // The wrong-booking bug: previously returned the soonest. Now it must return null.
    const r = findClientBookingByTargetDate([bkgMon, bkgTue], CLIENT, "my appointment please");
    assert.equal(r, null);
  });
});

// ── 8. Booking ID resolution (resolveBookingIdForAction) ─────────────────────
// Covers the full disambiguation ladder the system uses for cancel/reschedule.

describe("resolveBookingIdForAction", () => {
  const bkgA = makeBooking({ id: "bkg-A", start_time: "2026-08-03T10:00:00+02:00" }); // Monday
  const bkgB = makeBooking({ id: "bkg-B", start_time: "2026-08-04T14:00:00+02:00" }); // Tuesday

  it("single booking → auto-selected (even with null booking_id)", () => {
    const ad = makeAiData({ bookings: [bkgA] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", null, null), "bkg-A");
  });
  it("multiple bookings + no date hint → null (MUST NOT guess)", () => {
    const ad = makeAiData({ bookings: [bkgA, bkgB] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", null, null), null);
  });
  it("multiple bookings + PENDING_RESOLVE + no targetDate → null", () => {
    const ad = makeAiData({ bookings: [bkgA, bkgB] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", "PENDING_RESOLVE", null), null);
  });
  it("multiple bookings + targetDate matches one → resolves correctly", () => {
    const ad = makeAiData({ bookings: [bkgA, bkgB] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", "PENDING_RESOLVE", "tuesday"), "bkg-B");
  });
  it("explicit booking_id owned by this client → resolved directly", () => {
    const ad = makeAiData({ bookings: [bkgA, bkgB] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", "bkg-A", null), "bkg-A");
  });
  it("explicit booking_id NOT owned by this client → not returned (security guard)", () => {
    // bkg-A belongs to client-1. client-2 only has bkgB. Passing bkg-A for client-2 → null.
    const bkgBforC2 = makeBooking({ id: "bkg-B2", client_id: "client-2" });
    const ad = makeAiData({ bookings: [bkgA, bkgBforC2] });
    const result = resolveBookingIdForAction(ad, "client-2", "bkg-A", null);
    assert.notEqual(result, "bkg-A");
  });
  it("cancelled bookings excluded from resolution", () => {
    const cancelled = makeBooking({ id: "bkg-X", status: "cancelled" });
    const ad = makeAiData({ bookings: [cancelled] });
    assert.equal(resolveBookingIdForAction(ad, "client-1", null, null), null);
  });
  it("no client_id → falls back to explicit booking_id (if not PENDING_RESOLVE)", () => {
    const ad = makeAiData({ bookings: [bkgA] });
    assert.equal(resolveBookingIdForAction(ad, null, "bkg-A", null), "bkg-A");
  });
});

// ── 9. Slot hours validation ──────────────────────────────────────────────────

describe("slotFallsWithinBusinessHours", () => {
  it("slot from open to 30min later → valid", () => {
    const s = sast("2026-08-03T09:00:00");
    const e = sast("2026-08-03T09:30:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_FRI), true);
  });
  it("slot ending exactly at close → valid", () => {
    const s = sast("2026-08-03T16:30:00");
    const e = sast("2026-08-03T17:00:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_FRI), true);
  });
  it("slot starting before open → invalid", () => {
    const s = sast("2026-08-03T08:30:00");
    const e = sast("2026-08-03T09:00:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_FRI), false);
  });
  it("slot ending after close → invalid", () => {
    const s = sast("2026-08-03T16:45:00");
    const e = sast("2026-08-03T17:15:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_FRI), false);
  });
  it("slot on a closed day (Sunday) → invalid", () => {
    const s = sast("2026-08-09T10:00:00"); // Sunday
    const e = sast("2026-08-09T10:30:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_FRI), false);
  });
  it("Saturday slot within hours → valid when Saturday is open", () => {
    const s = sast("2026-08-08T10:00:00"); // Saturday
    const e = sast("2026-08-08T10:30:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_SAT), true);
  });
  it("Saturday slot past 13:00 → invalid (closes 13:00)", () => {
    const s = sast("2026-08-08T13:00:00");
    const e = sast("2026-08-08T13:30:00");
    assert.equal(slotFallsWithinBusinessHours(s, e, HOURS_MON_SAT), false);
  });
});

// ── 10. Booking overlap detection ─────────────────────────────────────────────

describe("bookingOverlaps", () => {
  const slotStart = sast("2026-08-03T10:00:00"); // 10:00
  const slotEnd   = sast("2026-08-03T10:30:00"); // 10:30

  function slot(startLocal: string, endLocal: string, staffId: string | null = STAFF_TORBEN.id): any {
    return {
      start_time: sast(startLocal).toISOString(),
      end_time:   sast(endLocal).toISOString(),
      staff_id:   staffId,
    };
  }

  it("identical time + same staff → overlaps", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T10:00:00", "2026-08-03T10:30:00"), STAFF_TORBEN.id),
      true,
    );
  });
  it("adjacent slots (B ends exactly when A starts) → no overlap", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T09:30:00", "2026-08-03T10:00:00"), STAFF_TORBEN.id),
      false,
    );
  });
  it("different staff → no overlap even at same time", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T10:00:00", "2026-08-03T10:30:00"), STAFF_KAYLIN.id),
      false,
    );
  });
  it("staffId=null check → overlap regardless of booking's staff", () => {
    // When we don't filter by staff, the booking always conflicts if times overlap
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T10:00:00", "2026-08-03T10:30:00", null), null),
      true,
    );
  });
  it("partial overlap at start of slot → overlaps", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T09:45:00", "2026-08-03T10:15:00"), STAFF_TORBEN.id),
      true,
    );
  });
  it("partial overlap at end of slot → overlaps", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T10:15:00", "2026-08-03T10:45:00"), STAFF_TORBEN.id),
      true,
    );
  });
  it("booking completely before the slot → no overlap", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T08:00:00", "2026-08-03T09:00:00"), STAFF_TORBEN.id),
      false,
    );
  });
  it("booking completely after the slot → no overlap", () => {
    assert.equal(
      bookingOverlaps(slotStart, slotEnd, slot("2026-08-03T11:00:00", "2026-08-03T11:30:00"), STAFF_TORBEN.id),
      false,
    );
  });
});

// ── 11. AI response parsing (parseCombinedResponse) ───────────────────────────
// Critical: guards the false-confirm bug where the model said "booked!" but
// the JSON was unreadable, so no booking was actually created.

describe("parseCombinedResponse", () => {
  const AI_DATA = makeAiData();

  function parse(raw: string) {
    return parseCombinedResponse(raw, AI_DATA);
  }

  it("clean format → CREATE decision + reply extracted correctly", () => {
    const json = `{"confidence":"high","needs_human":false,"missing_fields":[],"actions":[{"type":"CREATE","service_id":"${SVC_HAIRCUT.id}","start_time_iso":"2026-08-03T10:00:00+02:00","staff_id":null}]}`;
    const { decision, reply, parsedOk } = parse(`${json}\n---REPLY---\nLet me book that for you!`);
    assert.equal(parsedOk, true);
    assert.equal(decision.actions[0]?.type, "CREATE");
    assert.ok(reply.length > 0);
  });
  it("NONE actions → 0 actions, reply returned", () => {
    const json = '{"confidence":"low","needs_human":false,"missing_fields":["service"],"actions":[]}';
    const { decision, reply } = parse(`${json}\n---REPLY---\nWhich service would you like?`);
    assert.equal(decision.actions.length, 0);
    assert.ok(reply.includes("service"));
  });
  it("truncated JSON (missing closing brace) → repaired, parsedOk:true", () => {
    // Missing outer closing brace — should be repaired
    const json = `{"confidence":"high","actions":[{"type":"CANCEL","booking_id":"bkg-A"}`;
    const { parsedOk, decision } = parse(`${json}\n---REPLY---\nCancelling that for you.`);
    assert.equal(parsedOk, true);
    assert.equal(decision.actions[0]?.type, "CANCEL");
  });
  it("completely unparseable JSON → parsedOk:false (false-confirm regression)", () => {
    // If the model returns broken JSON but a reply that says "your booking is confirmed!",
    // parsedOk:false ensures the system rejects that reply and sends fallback instead.
    const { parsedOk, decision } = parse(
      `{this is :: absolutely not json}\n---REPLY---\nYour booking is confirmed!`,
    );
    assert.equal(parsedOk, false);
    assert.equal(decision.actions.length, 0);
  });
  it("plain prose (no JSON at all) → valid with no actions, reply = prose", () => {
    const { decision, reply, parsedOk } = parse(
      "We are open Monday to Friday from 9am to 5pm.",
    );
    assert.equal(parsedOk, true);
    assert.equal(decision.actions.length, 0);
    assert.ok(reply.includes("Monday"));
  });
  it("JSON in code fence → still extracted and parsed", () => {
    const json = '{"confidence":"medium","needs_human":false,"missing_fields":[],"actions":[]}';
    const { parsedOk, decision } = parse(
      "```json\n" + json + "\n```\n---REPLY---\nWhat time works for you?",
    );
    assert.equal(parsedOk, true);
    assert.equal(decision.actions.length, 0);
  });
  it("UPDATE_TIME action parsed from clean JSON", () => {
    const json = `{"confidence":"high","actions":[{"type":"UPDATE_TIME","booking_id":"PENDING_RESOLVE","new_start_time_iso":"2026-08-05T14:00:00+02:00","target_date":"Wednesday"}]}`;
    const { decision, parsedOk } = parse(`${json}\n---REPLY---\nMoving your appointment.`);
    assert.equal(parsedOk, true);
    assert.equal(decision.actions[0]?.type, "UPDATE_TIME");
  });
});

// ── 12. Reply ID redaction ────────────────────────────────────────────────────

describe("redactInternalIds", () => {
  const UUID = "aaaa0000-0000-0000-0000-000000000001";

  it("bare UUID removed", () => {
    assert.ok(!redactInternalIds(`Your booking id is ${UUID}`).includes(UUID));
  });
  it("[ID:...] booking-history markers removed", () => {
    const result = redactInternalIds(`[ID:${UUID}] Haircut`);
    assert.ok(!result.includes("[ID:"));
    assert.ok(result.includes("Haircut"));
  });
  it("'service_id: <uuid>' label + value both removed", () => {
    const result = redactInternalIds(`service_id: ${UUID}`);
    assert.ok(!result.includes(UUID));
    assert.ok(!result.includes("service_id"));
  });
  it("regular conversational text unchanged", () => {
    const text = "Hi! What service would you like to book today?";
    assert.equal(redactInternalIds(text), text);
  });
  it("empty backtick pairs cleaned up", () => {
    const result = redactInternalIds("Here is your booking ``.");
    assert.ok(!result.includes("``"));
  });
  it("trailing separators after redaction cleaned", () => {
    const result = redactInternalIds(`• Haircut — ${UUID}`);
    assert.ok(!result.endsWith("—"));
    assert.ok(!result.endsWith(" "));
  });
  it("multiple UUIDs in one line all removed", () => {
    const uuid2 = "bbbb0000-0000-0000-0000-000000000002";
    const result = redactInternalIds(`${UUID} and ${uuid2}`);
    assert.ok(!result.includes(UUID));
    assert.ok(!result.includes(uuid2));
  });
});

// ── 13. Availability reply formatting ─────────────────────────────────────────

describe("formatAvailabilityReply", () => {
  it("comma-separated times in a slot-listing line → bullet list", () => {
    const line = "We have available slots on Monday at 9am, 10am, 11am.";
    const result = formatAvailabilityReply(line);
    assert.ok(result.includes("• 9am"), `Missing bullet for 9am in: ${result}`);
    assert.ok(result.includes("• 10am"), `Missing bullet for 10am in: ${result}`);
    assert.ok(result.includes("• 11am"), `Missing bullet for 11am in: ${result}`);
  });
  it("regular text with no slot pattern → unchanged", () => {
    const text = "Hi! What service would you like to book?";
    assert.equal(formatAvailabilityReply(text), text);
  });
  it("single time in slot line → not bulleted (only 1 item, not a list)", () => {
    const line = "We have available slots on Monday at 9am.";
    const result = formatAvailabilityReply(line);
    // Single item stays inline — that's the correct behavior
    assert.ok(!result.startsWith("• ") || !result.includes("\n• "));
  });
});

// ── 14. Working hours utilities ───────────────────────────────────────────────

describe("isWithinWorkingHours", () => {
  it("alwaysOn:true always returns true", () => {
    assert.equal(isWithinWorkingHours([], true), true);
  });
  it("empty working hours + alwaysOn:false → closed", () => {
    assert.equal(isWithinWorkingHours([], false), false);
  });
});

describe("formatWorkingHoursText", () => {
  it("Mon–Fri open → all 5 days present in output", () => {
    const text = formatWorkingHoursText(HOURS_MON_FRI);
    assert.ok(text.includes("Mon"));
    assert.ok(text.includes("09:00"));
  });
  it("no open days → 'Closed'", () => {
    const allClosed = HOURS_MON_FRI.map((h) => ({ ...h, is_open: false }));
    assert.equal(formatWorkingHoursText(allClosed), "Closed");
  });
  it("Saturday with different hours included when open", () => {
    const text = formatWorkingHoursText(HOURS_MON_SAT);
    assert.ok(text.includes("Sat"));
    assert.ok(text.includes("13:00"));
  });
});

describe("nextOpeningTime", () => {
  it("empty working hours → null", () => {
    assert.equal(nextOpeningTime([]), null);
  });
  it("all-closed schedule → null", () => {
    const allClosed = HOURS_MON_FRI.map((h) => ({ ...h, is_open: false }));
    assert.equal(nextOpeningTime(allClosed), null);
  });
});

// ── 15. Policy decline messages ───────────────────────────────────────────────

describe("policyDeclineMessage", () => {
  it("{hours} in custom message replaced with actual hours", () => {
    const msg = policyDeclineMessage("Must cancel {hours} hours in advance.", "fallback", 24);
    assert.ok(msg.includes("24"));
    assert.ok(!msg.includes("{hours}"));
  });
  it("empty custom → fallback used", () => {
    const msg = policyDeclineMessage("", "Requires {hours}h notice.", 12);
    assert.ok(msg.includes("12"));
  });
  it("null custom → fallback used", () => {
    const msg = policyDeclineMessage(null, "Cannot cancel within {hours} hours.", 48);
    assert.equal(msg, "Cannot cancel within 48 hours.");
  });
  it("{hours} in fallback also substituted", () => {
    const msg = policyDeclineMessage(null, "No changes within {hours} hours of the appointment.", 24);
    assert.equal(msg, "No changes within 24 hours of the appointment.");
  });
});

// ── 16. Mock-AI tests (mocked global.fetch — no real Cerebras calls) ──────────
// These tests verify pipeline behavior by injecting controlled AI responses.

describe("getDecisionAndReply — mocked Cerebras responses", () => {
  const HISTORY = [{ role: "user" as const, content: "I want to book a haircut on Monday at 10am" }];
  const CTX = `BUSINESS: Test Salon\n\nSERVICES CATALOG:\n• "Haircut" | id=${SVC_HAIRCUT.id} | R150.00 | 30min`;
  const SETTINGS = makeSettings();
  const AI_DATA = makeAiData();

  function mockFetch(content: string): () => void {
    const real = (global as any).fetch;
    (global as any).fetch = async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    return () => { (global as any).fetch = real; };
  }

  it("clean JSON+reply → correct CREATE action type returned", async () => {
    const content = `{"confidence":"high","needs_human":false,"missing_fields":[],"actions":[{"type":"CREATE","service_id":"${SVC_HAIRCUT.id}","start_time_iso":"2026-08-03T10:00:00+02:00","staff_id":null}]}\n---REPLY---\nI'll book that for you!`;
    const restore = mockFetch(content);
    try {
      const { decision, reply } = await getDecisionAndReply(
        HISTORY, CTX, SETTINGS, AI_DATA, `unit-test-${Math.random()}`,
      );
      assert.equal(decision.actions[0]?.type, "CREATE");
      assert.ok(reply.length > 0);
    } finally { restore(); }
  });

  it("UUID in reply → stripped before returning to caller", async () => {
    const uuid = SVC_HAIRCUT.id;
    const content = `{"confidence":"high","actions":[]}\n---REPLY---\nHere is your service_id: ${uuid}`;
    const restore = mockFetch(content);
    try {
      const { reply } = await getDecisionAndReply(
        HISTORY, CTX, SETTINGS, AI_DATA, `unit-test-${Math.random()}`,
      );
      assert.ok(!reply.includes(uuid), `UUID found in reply: ${reply}`);
    } finally { restore(); }
  });

  it("completely malformed JSON → fallback reply sent, zero actions (false-confirm guard)", async () => {
    // The model returns broken JSON but a reply that says "confirmed" — the system must
    // never relay that reply since no action was actually taken.
    const content = `{this : is :: broken}\n---REPLY---\nYour booking is confirmed!`;
    const restore = mockFetch(content);
    try {
      const { decision, reply } = await getDecisionAndReply(
        HISTORY, CTX, SETTINGS, AI_DATA, `unit-test-${Math.random()}`,
      );
      assert.equal(decision.actions.length, 0);
      // The "confirmed" text from the broken AI response must not appear
      assert.ok(
        !reply.toLowerCase().includes("confirmed") || reply === SETTINGS.fallback_message,
        `Expected fallback, got: ${reply}`,
      );
    } finally { restore(); }
  });

  it("API returns HTTP 500 → fallback reply, zero actions", async () => {
    const real = (global as any).fetch;
    (global as any).fetch = async () => new Response("Internal Server Error", { status: 500 });
    try {
      const { decision, reply } = await getDecisionAndReply(
        HISTORY, CTX, SETTINGS, AI_DATA, `unit-test-${Math.random()}`,
      );
      assert.equal(decision.actions.length, 0);
      assert.ok(reply.length > 0);
    } finally { (global as any).fetch = real; }
  });

  it("plain prose (no JSON) → no action, reply contains the prose", async () => {
    const content = "We are open Monday to Friday. Is there anything I can help you with?";
    const restore = mockFetch(content);
    try {
      const { decision, reply } = await getDecisionAndReply(
        HISTORY, CTX, SETTINGS, AI_DATA, `unit-test-${Math.random()}`,
      );
      assert.equal(decision.actions.length, 0);
      assert.ok(reply.includes("Monday"), `Expected prose in reply, got: ${reply}`);
    } finally { restore(); }
  });
});

// ── Run all tests ─────────────────────────────────────────────────────────────

await run();
