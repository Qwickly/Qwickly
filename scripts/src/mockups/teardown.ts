/**
 * Removes the demo business seeded by seed.ts — all its rows, the business
 * record, and the demo auth user. Leaves the rest of the Supabase project
 * untouched.
 *
 * Run:  pnpm mockups:teardown
 */
import { adminClient, anonClient, DEMO } from "./env";
import type { SupabaseClient } from "@supabase/supabase-js";

async function findUserId(admin: SupabaseClient): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === DEMO.email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function findBusinessId(): Promise<string | null> {
  const anon = anonClient();
  const { error } = await anon.auth.signInWithPassword({
    email: DEMO.email,
    password: DEMO.password,
  });
  if (error) return null;
  const { data } = await anon.rpc("ensure_my_business");
  await anon.auth.signOut();
  return (data as string) ?? null;
}

async function main() {
  const admin = adminClient();
  console.log(`Tearing down demo business "${DEMO.businessName}"…`);

  const businessId = await findBusinessId();
  if (businessId) {
    for (const table of [
      "payments", "bookings", "clients", "staff_members", "services",
      "subscriptions", "booking_page_settings", "business_operating_hours",
    ]) {
      const { error } = await admin.from(table).delete().eq("business_id", businessId);
      if (error) console.warn(`  ! ${table}: ${error.message}`);
    }
    const { error: bizError } = await admin.from("businesses").delete().eq("id", businessId);
    if (bizError) console.warn(`  ! businesses: ${bizError.message}`);
    console.log(`  · removed business ${businessId} and its rows`);
  } else {
    console.log("  · no demo business found (already gone?)");
  }

  const userId = await findUserId(admin);
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.warn(`  ! deleteUser: ${error.message}`);
    else console.log("  · removed demo auth user");
  }

  console.log("\n✅ Teardown complete.");
}

main().catch((err) => {
  console.error("\n❌ Teardown failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
