import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { fetchMyStaffMembership } from "@/lib/staff-portal";
import { fetchMyTeamMembership } from "@/lib/team-portal";

/**
 * Whether a business has been through first-run setup.
 *
 * This used to describe a seven-tab wizard inside Settings — `ONBOARDING_TABS`,
 * `onboarding_tabs_visited`, `markOnboardingTabVisited`, the lot. None of it was
 * ever wired to a screen, which left `onboarding_completed` with no writer at
 * all: it stayed false forever, and `resolvePostAuthPath` sent every returning
 * owner back to setup on every single login. The flag is now written by
 * /onboarding when the user reaches the end of it, by any path.
 *
 * It stays an explicit flag rather than something derived from account state
 * (has services, has staff, has open hours) because setup is skippable. A
 * derived rule would drag a business back into onboarding the day it archived
 * its last service, which is not what "have you been shown around" means.
 * Derived completion belongs to the Getting Started checklist, and lives there.
 */

export const ONBOARDING_MIGRATION_FILE = "supabase/migrations_archive/002_onboarding.sql";

export function isOnboardingSchemaError(message: string): boolean {
  return message.includes("onboarding_completed");
}

export async function fetchOnboardingCompleted(): Promise<boolean> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("businesses")
    .select("onboarding_completed")
    .eq("id", businessId)
    .single();

  // A column that isn't there yet means the migration hasn't run. Treat that as
  // "done" rather than trapping everyone in setup they cannot complete.
  if (error) {
    if (isOnboardingSchemaError(error.message)) return true;
    throw new Error(error.message);
  }

  return data.onboarding_completed ?? false;
}

export async function completeOnboarding(businessId: string): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_completed: true })
    .eq("id", businessId);

  if (error) throw new Error(error.message);
}

export type PostAuthRedirect = {
  path: string;
  migrationRequired: boolean;
};

/**
 * Same as resolvePostAuthPath, but checks first whether the signed-in user is
 * a staff account (staff_members.user_id) rather than a business owner —
 * staff never have a `businesses` row of their own, so calling
 * resolvePostAuthPath()/ensureBusiness() for them would wrongly create one.
 * Use this at every post-sign-in entry point reachable by either kind of
 * account (login, forgot-password reset, "already signed in" redirects).
 */
export async function resolvePostLoginPath(): Promise<PostAuthRedirect> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;

  if (userId) {
    const staffMembership = await fetchMyStaffMembership(userId).catch(() => null);
    if (staffMembership) {
      const mustChangePassword = Boolean(session?.user.user_metadata?.must_change_password);
      return {
        path: mustChangePassword ? "/staff/set-password" : "/staff/bookings",
        migrationRequired: false,
      };
    }

    const teamMembership = await fetchMyTeamMembership(userId).catch(() => null);
    if (teamMembership) {
      const mustChangePassword = Boolean(session?.user.user_metadata?.must_change_password);
      return {
        path: mustChangePassword ? "/reset-password" : "/dashboard",
        migrationRequired: false,
      };
    }
  }

  return resolvePostAuthPath();
}

export async function resolvePostAuthPath(): Promise<PostAuthRedirect> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("businesses")
    .select("onboarding_completed")
    .eq("id", businessId)
    .single();

  if (error) {
    if (isOnboardingSchemaError(error.message)) {
      return { path: "/dashboard", migrationRequired: true };
    }
    throw new Error(error.message);
  }

  // The trial is step 4 of onboarding, not a gate in front of it — a brand-new
  // account fills in its business, services and hours first, so that by the
  // time it is asked for a card there is something on the other side of it.
  return {
    path: data.onboarding_completed ? "/dashboard" : "/onboarding",
    migrationRequired: false,
  };
}
