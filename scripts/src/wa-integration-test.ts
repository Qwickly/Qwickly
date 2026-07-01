/**
 * WhatsApp AI integration test suite.
 *
 * Tests the full executeAssistantAction pipeline — booking creation, cancellation,
 * and reschedule — against a fake in-memory Supabase client. No AI calls, no real
 * DB, no WhatsApp connection required.
 *
 * Run: pnpm wa:integration-test
 *
 * Outcome vocabulary (from executeActionPipeline):
 *   "success"         — action completed (booking created, cancelled, already-exists, etc.)
 *   "pipeline_failed" — action failed (booking_failed, cancel_failed, reschedule_failed)
 * The sub-result is always readable in summary (e.g. "BOOKING: pending", "CANCEL: success").
 */

import { randomUUID } from "node:crypto";

// ── Inject test override before any whatsapp-ai import (lazy init, safe) ──────
// @ts-ignore cross-workspace .ts import — tsx handles this fine
const { _setTestSupabaseAdmin, _clearTestSupabaseAdmin } =
  (await import("../../artifacts/api-server/src/lib/supabase.ts")) as any;

// @ts-ignore cross-workspace .ts import
const { executeAssistantAction } =
  (await import("../../artifacts/api-server/src/lib/whatsapp-ai.ts")) as typeof import("../../artifacts/api-server/src/lib/whatsapp-ai.ts");

// ── Fake Supabase ─────────────────────────────────────────────────────────────

type Row = Record<string, any>;
type DB = Record<string, Row[]>;

class FakeQueryBuilder {
  private _db: DB;
  private _table: string;
  private _rpc: Record<string, any>;
  private _select = "*";
  private _filters: [string, string, any][] = [];
  private _insert: Row | null = null;
  private _update: Row | null = null;

  constructor(db: DB, table: string, rpc: Record<string, any>) {
    this._db = db;
    this._table = table;
    this._rpc = rpc;
  }

  select(cols: string) {
    this._select = cols;
    return this;
  }

  insert(row: Row) {
    const r = { id: randomUUID(), ...row };
    (this._db[this._table] ??= []).push(r);
    this._insert = r;
    return this;
  }

  update(data: Row) {
    this._update = data;
    return this;
  }

  eq(col: string, val: any) {
    this._filters.push([col, "eq", val]);
    return this;
  }
  neq(col: string, val: any) {
    this._filters.push([col, "neq", val]);
    return this;
  }
  gte(col: string, val: any) {
    this._filters.push([col, "gte", val]);
    return this;
  }
  lt(col: string, val: any) {
    this._filters.push([col, "lt", val]);
    return this;
  }
  lte(col: string, val: any) {
    this._filters.push([col, "lte", val]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }

  private _match(rows: Row[]): Row[] {
    return rows.filter((r) =>
      this._filters.every(([col, op, val]) => {
        const v = r[col];
        if (op === "eq") return v === val;
        if (op === "neq") return v !== val;
        if (op === "gte") return v >= val;
        if (op === "lt") return v < val;
        if (op === "lte") return v <= val;
        return true;
      }),
    );
  }

  // Resolve Supabase-style join notation: services(name) → look up by FK
  private _expand(row: Row): Row {
    const hits = [...this._select.matchAll(/(\w+)\(([^)]+)\)/g)];
    if (!hits.length) return row;
    const FK: Record<string, string> = {
      services: "service_id",
      staff_members: "staff_id",
      clients: "client_id",
    };
    const out = { ...row };
    for (const [, rel, cols] of hits) {
      const fk = FK[rel];
      if (!fk) continue;
      const relRow = (this._db[rel] ?? []).find((r) => r.id === row[fk]);
      out[rel] = relRow
        ? Object.fromEntries(
            cols.split(",").map((c) => [c.trim(), relRow[c.trim()]]),
          )
        : null;
    }
    return out;
  }

  private _resolve(): { data: any; error: any } {
    if (this._insert) return { data: this._insert, error: null };

    if (this._update) {
      const matched = this._match(this._db[this._table] ?? []);
      for (const r of matched) Object.assign(r, this._update);
      return { data: null, error: null };
    }

    const rows = this._match(this._db[this._table] ?? []).map((r) =>
      this._expand(r),
    );
    return { data: rows, error: null };
  }

  // Thenable — lets `const { error } = await builder.update(...).eq(...)` work
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve(this._resolve()).then(resolve, reject);
  }

  single() {
    const { data, error } = this._resolve();
    if (error) return Promise.resolve({ data: null, error });
    const rows: Row[] = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length)
      return Promise.resolve({
        data: null,
        error: { message: "Not found", code: "PGRST116" },
      });
    return Promise.resolve({ data: rows[0], error: null });
  }

  maybeSingle() {
    const { data, error } = this._resolve();
    if (error) return Promise.resolve({ data: null, error });
    const rows: Row[] = Array.isArray(data) ? data : data ? [data] : [];
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
}

class FakeSupabaseClient {
  private _db: DB;
  private _rpc: Record<string, any>;

  constructor(db: DB = {}, rpc: Record<string, any> = {}) {
    // Deep-copy so mutations (inserts/updates) don't leak back into the caller's object
    this._db = Object.fromEntries(
      Object.entries(db).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
    );
    this._rpc = rpc;
  }

  from(table: string) {
    return new FakeQueryBuilder(this._db, table, this._rpc);
  }

  rpc(name: string, _params: any) {
    // Default: slot is free (true). Tests that need it blocked pass false explicitly.
    const val = Object.prototype.hasOwnProperty.call(this._rpc, name)
      ? this._rpc[name]
      : true;
    return Promise.resolve({ data: val, error: null });
  }

  /** Read back a table's current state for assertions */
  table(name: string): Row[] {
    return [...(this._db[name] ?? [])];
  }
}

// ── Fixed IDs ─────────────────────────────────────────────────────────────────

const BIZ_ID = "00000000-0000-0000-0000-000000000001";
const SVC_CUT_ID = "a0000000-0000-0000-0000-000000000001"; // Haircut 30 min R150
const SVC_COL_ID = "a0000000-0000-0000-0000-000000000002"; // Colour 90 min R350
const STF_TOR_ID = "b0000000-0000-0000-0000-000000000001"; // Torben  Mon–Fri
const STF_KAY_ID = "b0000000-0000-0000-0000-000000000002"; // Kaylin  Mon–Sat
const CLI_A_ID = "c0000000-0000-0000-0000-000000000001"; // Dylan
const BKG_A_ID = "d0000000-0000-0000-0000-000000000001"; // booking being acted on
const BKG_B_ID = "d0000000-0000-0000-0000-000000000002"; // second booking / conflict

// Mon 2026-08-03 10:00 SAST — well in the future
const MON_10AM_SAST = "2026-08-03T10:00:00+02:00";
const MON_10AM_UTC = "2026-08-03T08:00:00.000Z"; // same moment in UTC (stored in DB)
const MON_1030_UTC = "2026-08-03T08:30:00.000Z"; // +30 min (haircut end)

// Tue 2026-08-04 10:00 SAST — used as reschedule target / conflict slot
const TUE_10AM_SAST = "2026-08-04T10:00:00+02:00";
const TUE_10AM_UTC = "2026-08-04T08:00:00.000Z";
const TUE_1030_UTC = "2026-08-04T08:30:00.000Z";

// Monday 8pm SAST — outside business hours
const MON_8PM_SAST = "2026-08-03T20:00:00+02:00";

// Far-future date — safe for cancel/reschedule tests (no "past booking" edge)
const FAR_FUTURE_UTC = "2026-12-01T08:00:00.000Z"; // 10am SAST 1 Dec 2026
const FAR_FUTURE_END_UTC = "2026-12-01T08:30:00.000Z";

// Relation rows needed for services(name)/staff_members(name) joins in cancel/reschedule queries.
// Clients are NOT included here — tests that need a pre-seeded client add it explicitly via dbClient().
const BASE_RELATIONS: DB = {
  services: [
    { id: SVC_CUT_ID, name: "Haircut" },
    { id: SVC_COL_ID, name: "Colour Treatment" },
  ],
  staff_members: [
    { id: STF_TOR_ID, name: "Torben" },
    { id: STF_KAY_ID, name: "Kaylin" },
  ],
};

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function makeAiData(overrides: Partial<any> = {}): any {
  return {
    businessName: "Test Salon",
    businessDescription: "Test salon.",
    services: [
      {
        id: SVC_CUT_ID,
        name: "Haircut",
        description: "",
        price: 150,
        duration: 30,
        deposit_required: false,
        deposit_amount: 0,
      },
      {
        id: SVC_COL_ID,
        name: "Colour Treatment",
        description: "",
        price: 350,
        duration: 90,
        deposit_required: false,
        deposit_amount: 0,
      },
    ],
    staff: [
      {
        id: STF_TOR_ID,
        name: "Torben",
        position: "Stylist",
        working_days: WEEKDAYS,
      },
      {
        id: STF_KAY_ID,
        name: "Kaylin",
        position: "Stylist",
        working_days: [...WEEKDAYS, "saturday"],
      },
    ],
    bookings: [],
    bookingPage: null,
    depositSettings: null,
    workingHours: [
      ...WEEKDAYS.map((d) => ({
        day_name: d,
        is_open: true,
        open_time: "09:00",
        close_time: "17:00",
      })),
      {
        day_name: "saturday",
        is_open: false,
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
    faqs: [],
    ...overrides,
  };
}

function makeSettings(overrides: Partial<any> = {}): any {
  return {
    bot_name: "TestBot",
    tone: "professional",
    welcome_message: "Hi!",
    fallback_message: "Something went wrong.",
    auto_confirm: false,
    accept_cancellations: true,
    cancellation_min_notice_hours: 0,
    cancellation_decline_message: "",
    accept_reschedules: true,
    reschedule_min_notice_hours: 0,
    reschedule_decline_message: "",
    send_payment_links: false,
    answer_faqs: true,
    working_hours: "Mon–Fri 09:00–17:00",
    always_on: true,
    client_name: "Dylan",
    client_id: null,
    is_first_message: false,
    within_business_hours: true,
    current_time: "Monday 09:00",
    action_summary: undefined,
    ...overrides,
  };
}

function makeDecision(
  action: any,
  confidence: "low" | "medium" | "high" = "high",
): any {
  return {
    confidence,
    needs_human: false,
    missing_fields: [],
    actions: [action],
  };
}

// A booking row shaped for aiData.bookings (resolveBookingIdForAction, overlap checks)
function aiBooking(
  id: string,
  clientId: string,
  startUtc: string,
  endUtc: string,
  staffId = STF_TOR_ID,
  status = "confirmed",
): any {
  return {
    id,
    client_id: clientId,
    service_id: SVC_CUT_ID,
    staff_id: staffId,
    start_time: startUtc,
    end_time: endUtc,
    status,
  };
}

// A booking row shaped for the fake DB (used by cancel/reschedule DB queries)
function dbBooking(
  id: string,
  startUtc: string,
  endUtc: string,
  status = "confirmed",
): Row {
  return {
    id,
    business_id: BIZ_ID,
    client_id: CLI_A_ID,
    service_id: SVC_CUT_ID,
    staff_id: STF_TOR_ID,
    start_time: startUtc,
    end_time: endUtc,
    status,
    total_amount: 150,
    deposit_paid: false,
  };
}

// A client row for the fake DB
function dbClient(overrides: Partial<Row> = {}): Row {
  return {
    id: CLI_A_ID,
    business_id: BIZ_ID,
    name: "Dylan",
    phone: "27821234567",
    email: null,
    client_type: "returning",
    no_show_count: 0,
    notes: null,
    ...overrides,
  };
}

// ── Test runner ───────────────────────────────────────────────────────────────

const tests: [string, () => Promise<void>][] = [];
let passed = 0,
  failed = 0;

function test(name: string, fn: () => Promise<void>) {
  tests.push([name, fn]);
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log("\x1b[1mWhatsApp AI — Integration Tests\x1b[0m\n");
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`  \x1b[31m✗\x1b[0m ${name}\n    \x1b[2m${e.message}\x1b[0m`);
      failed++;
    } finally {
      _clearTestSupabaseAdmin();
    }
  }
  console.log(`\n${"─".repeat(62)}`);
  if (failed === 0) {
    console.log(`\x1b[32m${passed}/${passed + failed} passed\x1b[0m`);
  } else {
    console.log(
      `\x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m  (${passed + failed} total)`,
    );
    process.exit(1);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
// The pipeline always returns outcome "success" or "pipeline_failed".
// What actually happened is in the summary prefix:
//   success path:  "BOOKING: pending", "BOOKING: success", "BOOKING: exists",
//                  "CANCEL: success", "RESCHEDULE: success"
//   failure path:  "BOOKING: failed", "CANCEL: failed", "RESCHEDULE: failed"
// ─────────────────────────────────────────────────────────────────────────────

// 1 ──────────────────────────────────────────────────────────────────────────
test("CREATE: new client + open slot → booking inserted, client auto-created", async () => {
  const fake = new FakeSupabaseClient(
    { ...BASE_RELATIONS },
    { public_booking_slot_is_free: true },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings(),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_10AM_SAST,
      client_name: null,
      notes: null,
    }),
  });

  assert(r.outcome === "success", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("BOOKING: pending"),
    `summary: ${r.summary.slice(0, 60)}`,
  );

  const bookings = fake.table("bookings");
  assert(bookings.length === 1, "expected 1 booking inserted");
  assert(bookings[0].service_id === SVC_CUT_ID, "wrong service_id on booking");
  assert(bookings[0].staff_id === STF_TOR_ID, "wrong staff_id on booking");
  assert(
    bookings[0].status === "pending",
    `unexpected status: ${bookings[0].status}`,
  );

  const clients = fake.table("clients");
  assert(clients.length === 1, "expected 1 client auto-created");
  assert(
    clients[0].name === "Dylan",
    `unexpected client name: ${clients[0].name}`,
  );
});

// 2 ──────────────────────────────────────────────────────────────────────────
test("CREATE: auto_confirm=true → booking confirmed, summary says 'BOOKING: success'", async () => {
  const fake = new FakeSupabaseClient(
    { ...BASE_RELATIONS },
    { public_booking_slot_is_free: true },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ auto_confirm: true }),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_10AM_SAST,
      client_name: null,
      notes: null,
    }),
  });

  assert(r.outcome === "success", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("BOOKING: success"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    fake.table("bookings")[0]?.status === "confirmed",
    "expected confirmed status",
  );
});

// 3 ──────────────────────────────────────────────────────────────────────────
test("CREATE: identical booking already exists → 'BOOKING: exists', no duplicate row inserted", async () => {
  // Pre-seed the exact booking the bot is about to try to create.
  // checkDuplicateBooking matches on client_id + service_id + start_time (UTC).
  const fake = new FakeSupabaseClient(
    {
      ...BASE_RELATIONS,
      clients: [dbClient()],
      bookings: [dbBooking(BKG_A_ID, MON_10AM_UTC, MON_1030_UTC)],
    },
    { public_booking_slot_is_free: true },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ client_id: CLI_A_ID }),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_10AM_SAST,
      client_name: null,
      notes: null,
    }),
  });

  assert(r.outcome === "success", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("BOOKING: exists"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    fake.table("bookings").length === 1,
    "must not insert a duplicate row",
  );
});

// 4 ──────────────────────────────────────────────────────────────────────────
test("CREATE: slotIsFreeViaRpc=false (slot grabbed by another client) → 'BOOKING: failed' with alternatives", async () => {
  const fake = new FakeSupabaseClient(
    { ...BASE_RELATIONS },
    { public_booking_slot_is_free: false },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings(),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_10AM_SAST,
      client_name: null,
      notes: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("BOOKING: failed"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    fake.table("bookings").length === 0,
    "must not insert booking when slot is taken",
  );
});

// 5 ──────────────────────────────────────────────────────────────────────────
test("CREATE: 8pm slot is outside business hours → 'BOOKING: failed' before DB is touched", async () => {
  const fake = new FakeSupabaseClient(
    { ...BASE_RELATIONS },
    { public_booking_slot_is_free: true },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings(),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_8PM_SAST,
      client_name: null,
      notes: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("BOOKING: failed"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  // slotFallsWithinBusinessHours fires before ensureClient — no client created
  assert(
    fake.table("clients").length === 0,
    "should not have created a client for an out-of-hours slot",
  );
  assert(
    fake.table("bookings").length === 0,
    "should not have inserted a booking",
  );
});

// 6 ──────────────────────────────────────────────────────────────────────────
test("CREATE: client_name='Sarah' on Dylan's number → client stays 'Dylan', notes say 'Booked for: Sarah'", async () => {
  const fake = new FakeSupabaseClient(
    {
      ...BASE_RELATIONS,
      clients: [dbClient()],
    },
    { public_booking_slot_is_free: true },
  );
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ client_id: CLI_A_ID }),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CREATE",
      service_id: SVC_CUT_ID,
      staff_id: STF_TOR_ID,
      start_time_iso: MON_10AM_SAST,
      client_name: "Sarah",
      notes: null,
    }),
  });

  assert(r.outcome === "success", `outcome: ${r.outcome}`);

  const booking = fake.table("bookings")[0];
  assert(!!booking, "no booking was inserted");
  assert(
    (booking.notes ?? "").includes("Booked for: Sarah"),
    `booking notes: "${booking.notes}"`,
  );

  // The sender's client record must NOT have been renamed to Sarah
  const client = fake.table("clients").find((c) => c.id === CLI_A_ID);
  assert(client?.name === "Dylan", `client was renamed to: ${client?.name}`);
});

// 7 ──────────────────────────────────────────────────────────────────────────
test("CANCEL: single future booking with explicit ID → 'CANCEL: success', DB status='cancelled'", async () => {
  const fake = new FakeSupabaseClient({
    ...BASE_RELATIONS,
    clients: [dbClient()],
    bookings: [dbBooking(BKG_A_ID, FAR_FUTURE_UTC, FAR_FUTURE_END_UTC)],
  });
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ client_id: CLI_A_ID }),
    aiData: makeAiData({
      bookings: [
        aiBooking(BKG_A_ID, CLI_A_ID, FAR_FUTURE_UTC, FAR_FUTURE_END_UTC),
      ],
    }),
    decision: makeDecision({
      type: "CANCEL",
      booking_id: BKG_A_ID,
      target_date: null,
    }),
  });

  assert(r.outcome === "success", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("CANCEL: success"),
    `summary: ${r.summary.slice(0, 60)}`,
  );

  const booking = fake.table("bookings").find((b) => b.id === BKG_A_ID);
  assert(
    booking?.status === "cancelled",
    `DB booking status after cancel: ${booking?.status}`,
  );
});

// 8 ──────────────────────────────────────────────────────────────────────────
test("CANCEL: two active bookings + PENDING_RESOLVE + no date → must refuse, never guess", async () => {
  const fake = new FakeSupabaseClient({ ...BASE_RELATIONS });
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ client_id: CLI_A_ID }),
    aiData: makeAiData({
      bookings: [
        aiBooking(BKG_A_ID, CLI_A_ID, MON_10AM_UTC, MON_1030_UTC),
        aiBooking(BKG_B_ID, CLI_A_ID, TUE_10AM_UTC, TUE_1030_UTC),
      ],
    }),
    decision: makeDecision({
      type: "CANCEL",
      booking_id: "PENDING_RESOLVE",
      target_date: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("CANCEL: failed"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    r.summary.includes("Could not tell"),
    `missing disambiguation message: ${r.summary}`,
  );
});

// 9 ──────────────────────────────────────────────────────────────────────────
test("CANCEL: appointment in 2h, 24h notice required → policy decline, booking NOT cancelled in DB", async () => {
  const twoHoursFromNow = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const twoHoursEnd = new Date(
    Date.now() + 2 * 3600 * 1000 + 30 * 60_000,
  ).toISOString();

  const fake = new FakeSupabaseClient({
    ...BASE_RELATIONS,
    clients: [dbClient()],
    bookings: [
      {
        ...dbBooking(BKG_A_ID, twoHoursFromNow, twoHoursEnd),
        start_time: twoHoursFromNow,
        end_time: twoHoursEnd,
      },
    ],
  });
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({
      client_id: CLI_A_ID,
      cancellation_min_notice_hours: 24,
    }),
    aiData: makeAiData({
      bookings: [aiBooking(BKG_A_ID, CLI_A_ID, twoHoursFromNow, twoHoursEnd)],
    }),
    decision: makeDecision({
      type: "CANCEL",
      booking_id: BKG_A_ID,
      target_date: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  assert(
    r.summary.startsWith("CANCEL: failed"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    r.summary.includes("24"),
    `expected notice hours (24) in summary: ${r.summary}`,
  );

  const booking = fake.table("bookings").find((b) => b.id === BKG_A_ID);
  assert(
    booking?.status !== "cancelled",
    "booking was wrongly cancelled despite notice policy",
  );
});

// 10 ─────────────────────────────────────────────────────────────────────────
test("CANCEL: accept_cancellations=false → immediate decline with custom message, no DB query", async () => {
  const customMsg = "Call us to cancel: 011 555 1234.";
  const fake = new FakeSupabaseClient({ ...BASE_RELATIONS });
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({
      client_id: CLI_A_ID,
      accept_cancellations: false,
      cancellation_decline_message: customMsg,
    }),
    aiData: makeAiData(),
    decision: makeDecision({
      type: "CANCEL",
      booking_id: BKG_A_ID,
      target_date: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  assert(
    r.summary.includes(customMsg),
    `custom message missing from summary:\n${r.summary}`,
  );
});

// 11 ─────────────────────────────────────────────────────────────────────────
test("RESCHEDULE: target slot has Torben already booked (in-memory check) → 'BOOKING: failed'", async () => {
  // BKG_A is Mon 10am — we want to move it to Tue 10am.
  // BKG_B has Torben at Tue 10am, creating a conflict detected in-memory before DB.
  const fake = new FakeSupabaseClient({
    ...BASE_RELATIONS,
    clients: [dbClient()],
    bookings: [dbBooking(BKG_A_ID, MON_10AM_UTC, MON_1030_UTC)], // the booking being rescheduled
  });
  _setTestSupabaseAdmin(fake);

  const r = await executeAssistantAction({
    businessId: BIZ_ID,
    phone: "27821234567",
    fallbackClientName: "Dylan",
    settings: makeSettings({ client_id: CLI_A_ID }),
    aiData: makeAiData({
      bookings: [
        aiBooking(BKG_A_ID, CLI_A_ID, MON_10AM_UTC, MON_1030_UTC), // being moved
        aiBooking(BKG_B_ID, CLI_A_ID, TUE_10AM_UTC, TUE_1030_UTC, STF_TOR_ID), // blocks the target slot
      ],
    }),
    decision: makeDecision({
      type: "UPDATE_TIME",
      booking_id: BKG_A_ID,
      new_start_time_iso: TUE_10AM_SAST,
      target_date: null,
    }),
  });

  assert(r.outcome === "pipeline_failed", `outcome: ${r.outcome}`);
  // unavailableResult always prefixes with "BOOKING: failed" even in reschedule path
  assert(
    r.summary.startsWith("BOOKING: failed"),
    `summary: ${r.summary.slice(0, 60)}`,
  );
  assert(
    r.summary.toLowerCase().includes("unavailable"),
    `expected 'unavailable' in summary:\n${r.summary}`,
  );

  // The original booking must NOT have been moved
  const booking = fake.table("bookings").find((b) => b.id === BKG_A_ID);
  assert(
    booking?.start_time === MON_10AM_UTC,
    `booking start_time was wrongly changed to: ${booking?.start_time}`,
  );
});

// ── Run ───────────────────────────────────────────────────────────────────────

await run();
