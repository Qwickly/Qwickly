/**
 * Seeds ONE dedicated demo business ("Glow Beauty Studio") into the live
 * Supabase project so the mockup videos have attractive, realistic data to
 * show. Idempotent: re-running wipes the demo business's own rows and rebuilds
 * them. Everything is namespaced to the demo account and removable with
 * `pnpm mockups:teardown`.
 *
 * It clears all three dashboard gates:
 *   - ProtectedRoute   -> a real Supabase auth user (created here)
 *   - SubscriptionGuard -> an active `subscriptions` row on a real plan
 *   - OnboardingGuard   -> businesses.onboarding_completed = true
 *
 * Run:  pnpm mockups:seed
 */
import { adminClient, anonClient, DEMO } from "./env";
import type { SupabaseClient } from "@supabase/supabase-js";

const ALL_ONBOARDING_TABS = [
  "profile", "booking", "notifications", "payments", "whatsapp", "team", "security",
];

// SAST is UTC+2, no DST. Build UTC ISO strings from SAST wall-clock times.
function sast(dateISO: string, hhmm: string): string {
  return new Date(`${dateISO}T${hhmm}:00+02:00`).toISOString();
}

/** YYYY-MM-DD for Monday of the current week + dayOffset days. */
function weekday(offset: number): string {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + offset);
  return monday.toISOString().slice(0, 10);
}

function addMinutesISO(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

// ── Demo content ────────────────────────────────────────────────────────────

const SERVICES = [
  { name: "Signature Cut & Style", description: "Consultation, wash, precision cut and blow-dry finish.", price: 320, duration: 60, icon: "scissors", color: "#ec4899" },
  { name: "Balayage & Gloss", description: "Hand-painted balayage with a shine-boosting gloss.", price: 1250, duration: 150, icon: "sparkles", color: "#a855f7" },
  { name: "Full Colour & Blow-Dry", description: "Root-to-tip colour with a smooth blow-dry.", price: 980, duration: 120, icon: "palette", color: "#6366f1" },
  { name: "Gel Manicure", description: "Shape, cuticle care and long-lasting gel polish.", price: 280, duration: 45, icon: "hand", color: "#f59e0b" },
  { name: "Luxury Pedicure", description: "Soak, scrub, massage and polish.", price: 350, duration: 60, icon: "footprints", color: "#14b8a6" },
  { name: "Hydrafacial Glow", description: "Deep-cleanse, exfoliate and hydrate for instant glow.", price: 890, duration: 75, icon: "droplet", color: "#06b6d4" },
  { name: "Brow Shape & Tint", description: "Tailored brow shaping with a natural tint.", price: 180, duration: 30, icon: "eye", color: "#10b981" },
];

const STAFF = [
  { name: "Aisha Patel", position: "Senior Stylist", email: "aisha@glowstudio.demo", phone: "27821110001", working_days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] },
  { name: "Thandi Nkosi", position: "Colour Specialist", email: "thandi@glowstudio.demo", phone: "27821110002", working_days: ["tuesday", "wednesday", "thursday", "friday", "saturday"] },
  { name: "Lerato Mokoena", position: "Nail Technician", email: "lerato@glowstudio.demo", phone: "27821110003", working_days: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  { name: "Chloé van der Merwe", position: "Skincare Therapist", email: "chloe@glowstudio.demo", phone: "27821110004", working_days: ["wednesday", "thursday", "friday", "saturday"] },
];

const CLIENTS = [
  { name: "Naledi Dlamini", phone: "27823334001", email: "naledi@example.co.za", client_type: "vip", status: "active", no_show_count: 0, notes: "Prefers Aisha. Loves warm balayage tones." },
  { name: "Emma Botha", phone: "27823334002", email: "emma@example.co.za", client_type: "returning", status: "active", no_show_count: 0, notes: null },
  { name: "Zanele Khumalo", phone: "27823334003", email: "zanele@example.co.za", client_type: "vip", status: "active", no_show_count: 0, notes: "Monthly gel manicure." },
  { name: "Sarah Nel", phone: "27823334004", email: "sarah@example.co.za", client_type: "returning", status: "active", no_show_count: 0, notes: null },
  { name: "Ayesha Cassim", phone: "27823334005", email: "ayesha@example.co.za", client_type: "new", status: "new", no_show_count: 0, notes: null },
  { name: "Lindiwe Zulu", phone: "27823334006", email: "lindiwe@example.co.za", client_type: "returning", status: "active", no_show_count: 0, notes: null },
  { name: "Michelle Adams", phone: "27823334007", email: "michelle@example.co.za", client_type: "vip", status: "active", no_show_count: 0, notes: "Skincare regular — Chloé." },
  { name: "Precious Mahlangu", phone: "27823334008", email: "precious@example.co.za", client_type: "new", status: "new", no_show_count: 0, notes: null },
  { name: "Kirsten Meyer", phone: "27823334009", email: "kirsten@example.co.za", client_type: "returning", status: "active", no_show_count: 1, notes: "Missed last appointment — send reminder." },
  { name: "Tebogo Molefe", phone: "27823334010", email: "tebogo@example.co.za", client_type: "returning", status: "active", no_show_count: 0, notes: null },
  { name: "Hannah Pretorius", phone: "27823334011", email: "hannah@example.co.za", client_type: "new", status: "new", no_show_count: 0, notes: null },
  { name: "Nomsa Sithole", phone: "27823334012", email: "nomsa@example.co.za", client_type: "vip", status: "active", no_show_count: 0, notes: null },
  { name: "Chloe Fourie", phone: "27823334013", email: "chloef@example.co.za", client_type: "returning", status: "inactive", no_show_count: 2, notes: "At risk — hasn't booked in a while." },
  { name: "Refilwe Sono", phone: "27823334014", email: "refilwe@example.co.za", client_type: "new", status: "new", no_show_count: 0, notes: null },
];

// Weekly booking grid. day: 0=Mon..5=Sat. Times are SAST wall-clock.
// serviceIdx / staffIdx / clientIdx index into the arrays above.
const BOOKING_PLAN: Array<{
  day: number; time: string; svc: number; staff: number; client: number; status: string;
}> = [
  // Monday (past)
  { day: 0, time: "09:00", svc: 0, staff: 0, client: 1, status: "completed" },
  { day: 0, time: "10:30", svc: 3, staff: 2, client: 2, status: "completed" },
  { day: 0, time: "13:00", svc: 5, staff: 3, client: 6, status: "completed" },
  { day: 0, time: "15:00", svc: 6, staff: 0, client: 4, status: "completed" },
  // Tuesday (past)
  { day: 1, time: "09:30", svc: 1, staff: 1, client: 0, status: "completed" },
  { day: 1, time: "11:00", svc: 4, staff: 2, client: 9, status: "completed" },
  { day: 1, time: "14:00", svc: 0, staff: 0, client: 3, status: "completed" },
  { day: 1, time: "16:00", svc: 3, staff: 2, client: 11, status: "no_show" },
  // Wednesday (past)
  { day: 2, time: "09:00", svc: 2, staff: 1, client: 5, status: "completed" },
  { day: 2, time: "11:30", svc: 5, staff: 3, client: 6, status: "completed" },
  { day: 2, time: "13:30", svc: 6, staff: 0, client: 7, status: "completed" },
  { day: 2, time: "15:30", svc: 4, staff: 2, client: 2, status: "completed" },
  // Thursday (past)
  { day: 3, time: "10:00", svc: 0, staff: 0, client: 10, status: "completed" },
  { day: 3, time: "12:00", svc: 1, staff: 1, client: 11, status: "completed" },
  { day: 3, time: "14:30", svc: 5, staff: 3, client: 3, status: "completed" },
  // Friday (today-ish)
  { day: 4, time: "09:00", svc: 3, staff: 2, client: 1, status: "completed" },
  { day: 4, time: "11:00", svc: 0, staff: 0, client: 8, status: "confirmed" },
  { day: 4, time: "13:00", svc: 2, staff: 1, client: 0, status: "confirmed" },
  { day: 4, time: "15:00", svc: 5, staff: 3, client: 12, status: "pending" },
  { day: 4, time: "16:30", svc: 6, staff: 0, client: 13, status: "pending" },
  // Saturday (upcoming)
  { day: 5, time: "09:30", svc: 1, staff: 1, client: 2, status: "confirmed" },
  { day: 5, time: "11:00", svc: 4, staff: 3, client: 6, status: "confirmed" },
  { day: 5, time: "12:30", svc: 0, staff: 0, client: 4, status: "confirmed" },
  { day: 5, time: "14:00", svc: 3, staff: 2, client: 9, status: "pending" },
  { day: 5, time: "15:30", svc: 5, staff: 3, client: 11, status: "pending" },
];

// ── Seeding ─────────────────────────────────────────────────────────────────

async function ensureAuthUser(admin: SupabaseClient): Promise<string> {
  // Look for an existing demo user (paged listing).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === DEMO.email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: DEMO.email,
    password: DEMO.password,
    email_confirm: true,
    user_metadata: {
      first_name: "Glow",
      last_name: "Studio",
      full_name: "Glow Studio Demo",
      business_name: DEMO.businessName,
      business_type: "beauty",
    },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  console.log("  · created demo auth user");
  return data.user.id;
}

async function ensureBusinessId(): Promise<string> {
  // Sign in as the demo user and let the app's own RPC create the business,
  // so ownership/mapping matches exactly what the running app expects.
  const anon = anonClient();
  const { error: signInError } = await anon.auth.signInWithPassword({
    email: DEMO.email,
    password: DEMO.password,
  });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  const { data, error } = await anon.rpc("ensure_my_business");
  if (error) throw new Error(`ensure_my_business: ${error.message}`);
  await anon.auth.signOut();
  return data as string;
}

async function wipeDemoData(admin: SupabaseClient, businessId: string) {
  // Order matters: children before parents.
  await admin.from("payments").delete().eq("business_id", businessId);
  await admin.from("bookings").delete().eq("business_id", businessId);
  await admin.from("clients").delete().eq("business_id", businessId);
  await admin.from("staff_members").delete().eq("business_id", businessId);
  await admin.from("services").delete().eq("business_id", businessId);
  await admin.from("subscriptions").delete().eq("business_id", businessId);
}

async function pickPlanId(admin: SupabaseClient): Promise<string> {
  const { data, error } = await admin
    .from("plans")
    .select("id, name, price_cents")
    .order("price_cents", { ascending: true })
    .limit(1);
  if (error) throw new Error(`plans: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(
      "No rows in `plans` — the product's plans aren't seeded in this Supabase project. Seed a plan first, then re-run.",
    );
  }
  return data[0]!.id as string;
}

async function insertReturningIds(
  admin: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
): Promise<string[]> {
  const { data, error } = await admin.from(table).insert(rows).select("id");
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return (data ?? []).map((r) => (r as { id: string }).id);
}

async function main() {
  const admin = adminClient();
  console.log(`Seeding demo business "${DEMO.businessName}" (${DEMO.email})…`);

  const userId = await ensureAuthUser(admin);
  const businessId = await ensureBusinessId();
  console.log(`  · business ${businessId} (owner ${userId})`);

  await wipeDemoData(admin, businessId);
  console.log("  · wiped previous demo rows");

  // Business: name, slug, onboarding complete.
  {
    const { error } = await admin
      .from("businesses")
      .update({
        business_name: DEMO.businessName,
        onboarding_completed: true,
        onboarding_tabs_visited: ALL_ONBOARDING_TABS,
      })
      .eq("id", businessId);
    if (error) throw new Error(`update business: ${error.message}`);
  }

  // Subscription: active on the cheapest real plan.
  {
    const planId = await pickPlanId(admin);
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const { error } = await admin.from("subscriptions").insert({
      business_id: businessId,
      user_id: userId,
      plan_id: planId,
      status: "active",
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
    });
    if (error) throw new Error(`insert subscription: ${error.message}`);
    console.log(`  · active subscription on plan ${planId}`);
  }

  // Operating hours: open Mon–Sat 09:00–18:00, closed Sunday.
  {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const { data: existing } = await admin
      .from("business_operating_hours")
      .select("id, day_name")
      .eq("business_id", businessId);
    const byDay = new Map((existing ?? []).map((r) => [(r as any).day_name, (r as any).id]));
    for (const day of days) {
      const isOpen = day !== "sunday";
      const patch = { is_open: isOpen, open_time: "09:00:00", close_time: "18:00:00" };
      if (byDay.has(day)) {
        await admin.from("business_operating_hours").update(patch).eq("id", byDay.get(day));
      } else {
        await admin.from("business_operating_hours").insert({ business_id: businessId, day_name: day, ...patch });
      }
    }
  }

  // Booking page: published, at the demo slug.
  {
    const row = {
      business_id: businessId,
      page_title: DEMO.businessName,
      description: "Book your next appointment online. Choose your service below.",
      welcome_message: "Welcome to Glow Beauty Studio ✨ We can't wait to see you.",
      slug: DEMO.slug,
      require_deposit: false,
      allow_rescheduling: true,
      show_staff_selection: true,
      show_prices: true,
      show_duration: true,
      cover_image_url: null,
      logo_url: null,
      primary_color: "#10b981",
      secondary_color: "#059669",
      layout: "classic",
      font_family: "inter",
      border_radius: "md",
      header_style: "banner",
      button_style: "filled",
      background_style: "gradient",
      is_published: true,
    };
    const { error } = await admin
      .from("booking_page_settings")
      .upsert(row, { onConflict: "business_id" });
    if (error) throw new Error(`booking_page_settings: ${error.message}`);
  }

  // Services / staff / clients.
  const serviceIds = await insertReturningIds(
    admin, "services",
    SERVICES.map((s) => ({ business_id: businessId, ...s, deposit_required: false, deposit_amount: 0, is_active: true })),
  );
  const staffIds = await insertReturningIds(
    admin, "staff_members",
    STAFF.map((s) => ({ business_id: businessId, ...s, is_active: true })),
  );
  const clientIds = await insertReturningIds(
    admin, "clients",
    CLIENTS.map((c) => ({ business_id: businessId, ...c })),
  );
  console.log(`  · ${serviceIds.length} services, ${staffIds.length} staff, ${clientIds.length} clients`);

  // Bookings.
  const bookingRows = BOOKING_PLAN.map((b) => {
    const date = weekday(b.day);
    const start = sast(date, b.time);
    const svc = SERVICES[b.svc]!;
    const end = addMinutesISO(start, svc.duration);
    return {
      business_id: businessId,
      client_id: clientIds[b.client]!,
      service_id: serviceIds[b.svc]!,
      staff_id: staffIds[b.staff]!,
      start_time: start,
      end_time: end,
      status: b.status,
      deposit_paid: b.status !== "pending",
      total_amount: svc.price,
      notes: null as string | null,
    };
  });
  const bookingIds = await insertReturningIds(admin, "bookings", bookingRows);
  console.log(`  · ${bookingIds.length} bookings across this week`);

  // Payments for completed bookings, plus one deposit + one refund for variety.
  const methods = ["payfast", "yoco", "eft", "cash"] as const;
  const paymentRows: Record<string, unknown>[] = [];
  bookingRows.forEach((b, i) => {
    if (b.status !== "completed") return;
    paymentRows.push({
      business_id: businessId,
      client_id: b.client_id,
      booking_id: bookingIds[i]!,
      amount: b.total_amount,
      method: methods[i % methods.length],
      status: "completed",
      type: "full_payment",
      paid_at: b.start_time,
      notes: null,
    });
  });
  // A pending deposit on an upcoming confirmed booking.
  const confirmedIdx = bookingRows.findIndex((b) => b.status === "confirmed");
  if (confirmedIdx >= 0) {
    const b = bookingRows[confirmedIdx]!;
    paymentRows.push({
      business_id: businessId, client_id: b.client_id, booking_id: bookingIds[confirmedIdx]!,
      amount: Math.round(Number(b.total_amount) * 0.3), method: "payfast", status: "completed",
      type: "deposit", paid_at: new Date().toISOString(), notes: "Booking deposit",
    });
  }
  const paymentIds = await insertReturningIds(admin, "payments", paymentRows);
  console.log(`  · ${paymentIds.length} payments`);

  console.log("\n✅ Seed complete.");
  console.log(`   Login:  ${DEMO.email} / ${DEMO.password}`);
  console.log(`   Public: /book/${DEMO.slug}`);
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
