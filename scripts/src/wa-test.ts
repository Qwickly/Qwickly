/**
 * Dry-run WhatsApp AI tester.
 * Calls the bot's decision + reply pipeline with no DB writes and no WhatsApp sends.
 *
 * One-shot:    pnpm wa:test "I want a haircut tomorrow at 10am"
 * Interactive: pnpm wa:test
 * Reset conv:  type "reset" to clear history
 */
import { readFileSync } from "fs";
import * as path from "path";
import * as readline from "readline";
import { fileURLToPath } from "url";

// ── Load .env from api-server before any imports that read process.env ────────

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
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* file not found — skip */
  }
}

loadEnvFile(path.join(apiRoot, ".env"));
loadEnvFile(path.join(apiRoot, ".env.local"));

if (!process.env["CEREBRAS_API_KEY"]) {
  console.error(
    "Error: CEREBRAS_API_KEY not found in artifacts/api-server/.env or .env.local",
  );
  process.exit(1);
}

// ── Import after env is loaded ────────────────────────────────────────────────

const { getDecisionAndReply, currentBusinessTime } =
  (await import("../../artifacts/api-server/src/lib/whatsapp-ai.ts")) as typeof import("../../artifacts/api-server/src/lib/whatsapp-ai.ts");

// ── Fixture ───────────────────────────────────────────────────────────────────
// Edit these to match a real business's data when testing specific scenarios.
// IDs are fake but valid UUID format so resolveEntity accepts them.

const SVC_HAIRCUT = "a1000000-0000-0000-0000-000000000001";
const SVC_COLOUR = "a1000000-0000-0000-0000-000000000002";
const STF_TORBEN = "b1000000-0000-0000-0000-000000000001";
const STF_KAYLIN = "b1000000-0000-0000-0000-000000000002";
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const HOURS_TEXT =
  "Mon: 09:00–17:00, Tue: 09:00–17:00, Wed: 09:00–17:00, Thu: 09:00–17:00, Fri: 09:00–17:00, Sat: 09:00–13:00";

const fixtureAiData = {
  businessName: "Sunny Cuts",
  businessDescription: "Modern hair salon in Johannesburg.",
  services: [
    {
      id: SVC_HAIRCUT,
      name: "Haircut",
      description: "",
      price: 150,
      duration: 30,
      deposit_required: false,
      deposit_amount: 0,
    },
    {
      id: SVC_COLOUR,
      name: "Colour Treatment",
      description: "",
      price: 350,
      duration: 90,
      deposit_required: true,
      deposit_amount: 100,
    },
  ],
  staff: [
    {
      id: STF_TORBEN,
      name: "Torben",
      position: "Stylist",
      working_days: WEEKDAYS,
    },
    {
      id: STF_KAYLIN,
      name: "Kaylin",
      position: "Nail Technician",
      working_days: [...WEEKDAYS, "saturday"],
    },
  ],
  bookings: [] as any[],
  bookingPage: null,
  depositSettings: null,
  workingHours: [
    ...WEEKDAYS.map((day) => ({
      day_name: day,
      is_open: true,
      open_time: "09:00",
      close_time: "17:00",
    })),
    {
      day_name: "saturday",
      is_open: true,
      open_time: "09:00",
      close_time: "13:00",
    },
    {
      day_name: "sunday",
      is_open: false,
      open_time: "09:00",
      close_time: "17:00",
    },
  ],
  faqs: [
    {
      question: "Where are you located?",
      answer: "12 Oak Street, Sandton, Johannesburg.",
    },
    {
      question: "Do you have parking?",
      answer: "Yes, free parking at the rear entrance.",
    },
    {
      question: "What payment methods?",
      answer: "Cash, card, EFT or PayFast online.",
    },
  ],
};

function buildCtx(): string {
  const svcs = fixtureAiData.services
    .map(
      (s) =>
        `• "${s.name}" | id=${s.id} | R${s.price.toFixed(2)} | ${s.duration}min${s.deposit_required ? ` | deposit R${s.deposit_amount.toFixed(2)}` : ""}`,
    )
    .join("\n");
  const staff = fixtureAiData.staff
    .map(
      (s) =>
        `• "${s.name}" | id=${s.id} | works: ${s.working_days.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}`,
    )
    .join("\n");
  return [
    "BUSINESS: Sunny Cuts",
    "About: Modern hair salon in Johannesburg.",
    `HOURS: ${HOURS_TEXT}`,
    `SERVICES CATALOG:\n${svcs}`,
    `STAFF OPERATORS:\n${staff}`,
    "BOOKED SLOTS CALENDAR:\nNo booked blocks.",
    "AVAILABLE TIMEFRAMES:\nMany slots available Mon–Fri 09:00–17:00, Sat 09:00–13:00. Request a specific day and time.",
    "\n\nCustomer: Test User (new)",
  ].join("\n\n");
}

const ctx = buildCtx();

// ── Runner ────────────────────────────────────────────────────────────────────

const history: { role: "user" | "assistant"; content: string }[] = [];

async function runTurn(userMessage: string): Promise<void> {
  history.push({ role: "user", content: userMessage });

  const settings = {
    bot_name: "Sunny",
    tone: "professional",
    welcome_message: "Hi! Welcome to Sunny Cuts. How can I help?",
    fallback_message:
      "Sorry, something went wrong. A team member will follow up shortly.",
    auto_confirm: false,
    accept_cancellations: true,
    cancellation_min_notice_hours: 24,
    cancellation_decline_message: "",
    accept_reschedules: true,
    reschedule_min_notice_hours: 24,
    reschedule_decline_message: "",
    send_payment_links: false,
    answer_faqs: true,
    working_hours: HOURS_TEXT,
    always_on: true,
    client_name: "Test User",
    client_id: null,
    is_first_message: history.filter((m) => m.role === "user").length <= 1,
    within_business_hours: true,
    current_time: currentBusinessTime(),
  };

  const { decision, reply } = await getDecisionAndReply(
    history as any,
    ctx,
    settings,
    fixtureAiData as any,
    "wa-test",
  );

  history.push({ role: "assistant", content: reply });

  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

  console.log();
  console.log(dim("━━━ DECISION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(cyan(JSON.stringify(decision, null, 2)));
  console.log();
  console.log(dim("━━━ BOT REPLY ━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log(green(reply));
  console.log(dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));
  console.log();
}

// ── Entry point ───────────────────────────────────────────────────────────────

// pnpm passes a "--" separator through; strip it so the actual message lands correctly
const oneShot =
  process.argv
    .slice(2)
    .filter((a) => a !== "--")
    .join(" ")
    .trim() || null;

if (oneShot) {
  await runTurn(oneShot);
} else {
  console.log(
    "\x1b[1mWhatsApp AI dry-run tester\x1b[0m  — no DB writes, no WhatsApp sends",
  );
  console.log(
    `Fixture: Sunny Cuts | Haircut R150/30min (${SVC_HAIRCUT.slice(0, 8)}…), Colour R350/90min`,
  );
  console.log(
    `Staff: Torben Mon–Fri (${STF_TORBEN.slice(0, 8)}…), Kaylin Mon–Sat`,
  );
  console.log('Type "reset" to clear conversation history, Ctrl+C to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): void => {
    rl.question("You: ", async (input) => {
      const msg = input.trim();
      if (!msg) {
        ask();
        return;
      }
      if (msg.toLowerCase() === "reset") {
        history.length = 0;
        console.log("\x1b[2m[conversation reset]\x1b[0m\n");
        ask();
        return;
      }
      await runTurn(msg);
      ask();
    });
  };

  ask();
}
