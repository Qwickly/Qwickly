/**
 * WhatsApp AI scenario test suite.
 *
 * Runs realistic multi-turn conversations through the REAL Cerebras API to
 * verify the AI understands intent correctly and produces the right action
 * types. Uses ~2–4k input tokens per turn, so run deliberately — not on every
 * save.
 *
 * Run all:           pnpm wa:scenario-test
 * Run one by name:   pnpm wa:scenario-test -- greeting
 *
 * What each scenario checks:
 *   - Final turn produces the expected action type (CREATE/CANCEL/UPDATE_TIME/none)
 *   - Reply does not contain raw UUIDs
 *   - Reply is non-empty
 *
 * Cerebras token estimate: ~8k tokens per scenario (2–3 turns × ~2.5k avg).
 * At $0.60/M input tokens that's ~$0.005 per scenario / ~$0.05 per full run.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ── Load .env ─────────────────────────────────────────────────────────────────

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
  } catch { /* not found */ }
}

loadEnvFile(path.join(apiRoot, ".env"));
loadEnvFile(path.join(apiRoot, ".env.local"));

if (!process.env["CEREBRAS_API_KEY"]) {
  console.error(
    "\x1b[31mError: CEREBRAS_API_KEY not found in artifacts/api-server/.env\x1b[0m",
  );
  process.exit(1);
}

// ── Import AI pipeline ────────────────────────────────────────────────────────

const { getDecisionAndReply, currentBusinessTime } =
  (await import("../../artifacts/api-server/src/lib/whatsapp-ai.ts")) as
    typeof import("../../artifacts/api-server/src/lib/whatsapp-ai.ts");

// ── Fixture (mirrors wa-test.ts — Sunny Cuts salon) ──────────────────────────

const SVC_HAIRCUT_ID = "a1000000-0000-0000-0000-000000000001";
const SVC_COLOUR_ID  = "a1000000-0000-0000-0000-000000000002";
const STF_TORBEN_ID  = "b1000000-0000-0000-0000-000000000001";
const STF_KAYLIN_ID  = "b1000000-0000-0000-0000-000000000002";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const HOURS_TEXT = "Mon: 09:00–17:00, Tue: 09:00–17:00, Wed: 09:00–17:00, Thu: 09:00–17:00, Fri: 09:00–17:00, Sat: 09:00–13:00";

const BASE_AI_DATA = {
  businessName: "Sunny Cuts",
  businessDescription: "Modern hair salon in Johannesburg.",
  services: [
    { id: SVC_HAIRCUT_ID, name: "Haircut", description: "", price: 150, duration: 30, deposit_required: false, deposit_amount: 0 },
    { id: SVC_COLOUR_ID,  name: "Colour Treatment", description: "", price: 350, duration: 90, deposit_required: true, deposit_amount: 100 },
  ],
  staff: [
    { id: STF_TORBEN_ID, name: "Torben", position: "Stylist", working_days: WEEKDAYS },
    { id: STF_KAYLIN_ID, name: "Kaylin", position: "Nail Technician", working_days: [...WEEKDAYS, "saturday"] },
  ],
  bookings: [] as any[],
  bookingPage: null,
  depositSettings: null,
  workingHours: [
    ...WEEKDAYS.map((d) => ({ day_name: d, is_open: true, open_time: "09:00", close_time: "17:00" })),
    { day_name: "saturday", is_open: true, open_time: "09:00", close_time: "13:00" },
    { day_name: "sunday", is_open: false, open_time: "09:00", close_time: "17:00" },
  ],
  faqs: [
    { question: "Where are you located?", answer: "12 Oak Street, Sandton, Johannesburg." },
    { question: "Do you have parking?",   answer: "Yes, free parking at the rear entrance." },
    { question: "What payment methods?",  answer: "Cash, card, EFT or PayFast online." },
  ],
};

function buildCtx(overrides: { bookings?: any[] } = {}): string {
  const data = { ...BASE_AI_DATA, bookings: overrides.bookings ?? [] };
  const svcs = data.services
    .map((s: any) => `• "${s.name}" | id=${s.id} | R${s.price.toFixed(2)} | ${s.duration}min${s.deposit_required ? ` | deposit R${s.deposit_amount.toFixed(2)}` : ""}`)
    .join("\n");
  const staff = data.staff
    .map((s: any) => `• "${s.name}" | id=${s.id} | works: ${(s.working_days as string[]).map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}`)
    .join("\n");
  const bookedLines = data.bookings.length
    ? data.bookings
        .map((b: any) => `[ID:${b.id}] ${b.date_label ?? "upcoming"} — ${b.service_label ?? "appointment"}`)
        .join("\n")
    : "No booked blocks.";
  return [
    "BUSINESS: Sunny Cuts",
    "About: Modern hair salon in Johannesburg.",
    `HOURS: ${HOURS_TEXT}`,
    `SERVICES CATALOG:\n${svcs}`,
    `STAFF OPERATORS:\n${staff}`,
    `BOOKED SLOTS CALENDAR:\n${bookedLines}`,
    "AVAILABLE TIMEFRAMES:\nMany slots available Mon–Fri 09:00–17:00, Sat 09:00–13:00. Request a specific day and time.",
    "\n\nCustomer: Test User (new)",
  ].join("\n\n");
}

function makeSettings(overrides: Partial<any> = {}): any {
  return {
    bot_name: "Sunny",
    tone: "professional",
    welcome_message: "Hi! Welcome to Sunny Cuts. How can I help?",
    fallback_message: "Sorry, something went wrong. A team member will follow up shortly.",
    auto_confirm: false,
    accept_cancellations: true,
    cancellation_min_notice_hours: 0,
    cancellation_decline_message: "",
    accept_reschedules: true,
    reschedule_min_notice_hours: 0,
    reschedule_decline_message: "",
    send_payment_links: false,
    answer_faqs: true,
    working_hours: HOURS_TEXT,
    always_on: true,
    client_name: "Test User",
    client_id: null,
    is_first_message: true,
    within_business_hours: true,
    current_time: currentBusinessTime(),
    ...overrides,
  };
}

// ── Scenario types ────────────────────────────────────────────────────────────

type ActionType = "CREATE" | "CANCEL" | "UPDATE_TIME" | "UPDATE_STAFF" | "NONE";

type ScenarioTurn = {
  message: string;
};

type Scenario = {
  name: string;
  description: string;
  turns: ScenarioTurn[];
  expectActionType: ActionType | null; // null = no action expected (0 actions)
  expectMinConfidence?: "medium" | "high";
  preBookings?: any[];             // bookings already in aiData for cancel/reschedule tests
  clientId?: string | null;        // set when the client is known
};

// UUID regex for reply checking
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    name: "greeting",
    description: "First message greeting — bot should welcome, no action",
    turns: [{ message: "Hi there!" }],
    expectActionType: null,
  },

  {
    name: "partial-booking-intent",
    description: "Customer says they want a haircut but gives no date — bot asks for date",
    turns: [{ message: "I want to book a haircut" }],
    expectActionType: null, // not enough info for CREATE yet
  },

  {
    name: "full-booking-one-shot",
    description: "Complete booking details in one message → CREATE action",
    turns: [
      { message: "Please book a haircut with Torben on Monday 3 August at 10am" },
    ],
    expectActionType: "CREATE",
    expectMinConfidence: "medium",
  },

  {
    name: "multi-turn-booking",
    description: "Three-turn conversation: intent → date → time → CREATE",
    turns: [
      { message: "I'd like to book a haircut" },
      { message: "Monday" },
      { message: "10am please" },
    ],
    expectActionType: "CREATE",
  },

  {
    name: "cancel-booking",
    description: "Client with one existing booking asks to cancel — CANCEL action expected",
    preBookings: [{
      id: "EXISTING-BKG-001",
      client_id: "CLIENT-KNOWN-001",
      service_id: SVC_HAIRCUT_ID,
      start_time: "2026-08-11T10:00:00+02:00",
      end_time:   "2026-08-11T10:30:00+02:00",
      status: "confirmed",
      staff_id: STF_TORBEN_ID,
      total_amount: 150,
      deposit_paid: false,
      services: { name: "Haircut" },
      staff_members: { name: "Torben" },
      clients: { name: "Test User" },
      // for context string label
      date_label: "Mon 11 Aug at 10:00",
      service_label: "Haircut",
    }],
    clientId: "CLIENT-KNOWN-001",
    turns: [{ message: "I'd like to cancel my appointment" }],
    expectActionType: "CANCEL",
  },

  {
    name: "reschedule-booking",
    description: "Client with one booking asks to move it to Wednesday 2pm — UPDATE_TIME expected",
    preBookings: [{
      id: "EXISTING-BKG-002",
      client_id: "CLIENT-KNOWN-002",
      service_id: SVC_HAIRCUT_ID,
      start_time: "2026-08-11T10:00:00+02:00",
      end_time:   "2026-08-11T10:30:00+02:00",
      status: "confirmed",
      staff_id: STF_TORBEN_ID,
      total_amount: 150,
      deposit_paid: false,
      services: { name: "Haircut" },
      staff_members: { name: "Torben" },
      clients: { name: "Test User" },
      date_label: "Mon 11 Aug at 10:00",
      service_label: "Haircut",
    }],
    clientId: "CLIENT-KNOWN-002",
    turns: [{ message: "Can I move my Monday appointment to Wednesday at 2pm?" }],
    expectActionType: "UPDATE_TIME",
    expectMinConfidence: "medium",
  },

  {
    name: "faq-location",
    description: "General FAQ question answered from knowledge base — no action",
    turns: [{ message: "Where are you located?" }],
    expectActionType: null,
  },

  {
    name: "service-not-offered",
    description: "Customer asks for a service not in catalog — no action, polite decline",
    turns: [{ message: "Can I book a manicure?" }],
    expectActionType: null,
  },

  {
    name: "book-for-friend",
    description: "Booking for a third party — CREATE action with client_name set",
    turns: [
      { message: "I'd like to book a haircut for my friend Sarah on Tuesday 4th August at 11am" },
    ],
    expectActionType: "CREATE",
    expectMinConfidence: "medium",
  },

  {
    name: "price-inquiry",
    description: "Customer asks for price of a service — no action, factual answer",
    turns: [{ message: "How much does a colour treatment cost?" }],
    expectActionType: null,
  },
];

// ── Scenario runner ───────────────────────────────────────────────────────────

type ScenarioResult = {
  name: string;
  passed: boolean;
  reason?: string;
  durationMs: number;
  turns: number;
  finalActionType: string;
  finalConfidence: string;
};

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const start = Date.now();
  const history: { role: "user" | "assistant"; content: string }[] = [];

  const aiData = {
    ...BASE_AI_DATA,
    bookings: scenario.preBookings ?? [],
  };
  const ctx = buildCtx({ bookings: scenario.preBookings });

  let finalDecision: any = { actions: [], confidence: "low" };
  let finalReply = "";
  let turnIndex = 0;

  for (const turn of scenario.turns) {
    turnIndex++;
    history.push({ role: "user", content: turn.message });

    const settings = makeSettings({
      client_id: scenario.clientId ?? null,
      client_name: "Test User",
      is_first_message: turnIndex === 1,
    });

    const { decision, reply } = await getDecisionAndReply(
      history as any,
      ctx,
      settings,
      aiData as any,
      `scenario-${scenario.name}-turn-${turnIndex}`,
    );

    history.push({ role: "assistant", content: reply });
    finalDecision = decision;
    finalReply = reply;
  }

  const durationMs = Date.now() - start;

  // Check 1: UUID leakage
  const uuidMatches = finalReply.match(UUID_RE) ?? [];
  if (uuidMatches.length > 0) {
    return {
      name: scenario.name,
      passed: false,
      reason: `Reply contains UUID(s): ${uuidMatches.join(", ")}`,
      durationMs,
      turns: turnIndex,
      finalActionType: finalDecision.actions[0]?.type ?? "none",
      finalConfidence: finalDecision.confidence,
    };
  }

  // Check 2: Empty reply
  if (!finalReply.trim()) {
    return {
      name: scenario.name,
      passed: false,
      reason: "Reply is empty",
      durationMs,
      turns: turnIndex,
      finalActionType: finalDecision.actions[0]?.type ?? "none",
      finalConfidence: finalDecision.confidence,
    };
  }

  // Check 3: Action type
  const actualActionType = (finalDecision.actions[0]?.type ?? null) as ActionType | null;
  if (scenario.expectActionType !== undefined) {
    if (scenario.expectActionType === null && actualActionType !== null) {
      return {
        name: scenario.name,
        passed: false,
        reason: `Expected no action, got: ${actualActionType}`,
        durationMs,
        turns: turnIndex,
        finalActionType: actualActionType ?? "none",
        finalConfidence: finalDecision.confidence,
      };
    }
    if (scenario.expectActionType !== null && actualActionType !== scenario.expectActionType) {
      return {
        name: scenario.name,
        passed: false,
        reason: `Expected action ${scenario.expectActionType}, got: ${actualActionType ?? "none"} (confidence: ${finalDecision.confidence})`,
        durationMs,
        turns: turnIndex,
        finalActionType: actualActionType ?? "none",
        finalConfidence: finalDecision.confidence,
      };
    }
  }

  // Check 4: Minimum confidence
  if (scenario.expectMinConfidence) {
    const confRank = { low: 0, medium: 1, high: 2 };
    const actual = confRank[finalDecision.confidence as keyof typeof confRank] ?? 0;
    const required = confRank[scenario.expectMinConfidence];
    if (actual < required) {
      return {
        name: scenario.name,
        passed: false,
        reason: `Confidence too low: got ${finalDecision.confidence}, need at least ${scenario.expectMinConfidence}`,
        durationMs,
        turns: turnIndex,
        finalActionType: actualActionType ?? "none",
        finalConfidence: finalDecision.confidence,
      };
    }
  }

  return {
    name: scenario.name,
    passed: true,
    durationMs,
    turns: turnIndex,
    finalActionType: actualActionType ?? "none",
    finalConfidence: finalDecision.confidence,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

const filter = process.argv
  .slice(2)
  .filter((a) => a !== "--")
  .join(" ")
  .trim()
  .toLowerCase();

const toRun = filter
  ? SCENARIOS.filter((s) => s.name.toLowerCase().includes(filter) || s.description.toLowerCase().includes(filter))
  : SCENARIOS;

if (!toRun.length) {
  console.error(`No scenarios match filter: "${filter}"`);
  process.exit(1);
}

console.log(
  `\x1b[1mWhatsApp AI — Scenario Tests\x1b[0m` +
  (filter ? `  (filter: "${filter}")` : "") +
  `\n`,
);
console.log(`Running ${toRun.length}/${SCENARIOS.length} scenarios against real Cerebras API.\n`);

const results: ScenarioResult[] = [];
let idx = 0;

for (const scenario of toRun) {
  idx++;
  process.stdout.write(`  (${idx}/${toRun.length}) ${scenario.name}… `);
  try {
    const r = await runScenario(scenario);
    results.push(r);
    if (r.passed) {
      process.stdout.write(
        `\x1b[32m✓ passed\x1b[0m  [${r.turns} turn${r.turns !== 1 ? "s" : ""}, ${r.durationMs}ms, action=${r.finalActionType}, conf=${r.finalConfidence}]\n`,
      );
    } else {
      process.stdout.write(
        `\x1b[31m✗ FAILED\x1b[0m  [${r.turns} turn${r.turns !== 1 ? "s" : ""}, ${r.durationMs}ms]\n    \x1b[2m${r.reason}\x1b[0m\n`,
      );
    }
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    process.stdout.write(`\x1b[31m✗ ERROR\x1b[0m\n    \x1b[2m${msg}\x1b[0m\n`);
    results.push({
      name: scenario.name,
      passed: false,
      reason: `Uncaught error: ${msg}`,
      durationMs: 0,
      turns: 0,
      finalActionType: "error",
      finalConfidence: "low",
    });
  }
}

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const avgMs = results.reduce((s, r) => s + r.durationMs, 0) / results.length;

console.log(`\n${"─".repeat(62)}`);
console.log(
  `\x1b[32m${passed} passed\x1b[0m` +
  (failed ? `, \x1b[31m${failed} failed\x1b[0m` : "") +
  `  (${results.length} total, avg ${Math.round(avgMs)}ms/scenario)`,
);

if (failed > 0) {
  console.log("\nFailed scenarios:");
  for (const r of results.filter((x) => !x.passed))
    console.log(`  \x1b[31m✗\x1b[0m ${r.name}: ${r.reason}`);
  process.exit(1);
}
