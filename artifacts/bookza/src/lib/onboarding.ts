import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { fetchEntitlements } from "@/lib/entitlements";
import { fetchMyStaffMembership } from "@/lib/staff-portal";
import { fetchMyTeamMembership } from "@/lib/team-portal";

export const ONBOARDING_TABS = [
  "profile",
  "booking",
  "notifications",
  "payments",
  "whatsapp",
  "team",
  "security",
] as const;

export type OnboardingTabId = (typeof ONBOARDING_TABS)[number];

export const ONBOARDING_TAB_LABELS: Record<OnboardingTabId, string> = {
  profile: "Profile",
  booking: "Booking",
  notifications: "Notifications",
  payments: "Payments",
  whatsapp: "WhatsApp",
  team: "Team",
  security: "Security",
};

export type OnboardingStatus = {
  businessId: string;
  completed: boolean;
  tabsVisited: OnboardingTabId[];
};

function parseTabsVisited(raw: unknown): OnboardingTabId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is OnboardingTabId =>
    ONBOARDING_TABS.includes(t as OnboardingTabId),
  );
}

export const ONBOARDING_MIGRATION_FILE = "supabase/migrations_archive/002_onboarding.sql";

export function isOnboardingSchemaError(message: string): boolean {
  return (
    message.includes("onboarding_completed") ||
    message.includes("onboarding_tabs_visited")
  );
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const businessId = await ensureBusiness();
  const { data, error } = await supabase
    .from("businesses")
    .select("id, onboarding_completed, onboarding_tabs_visited")
    .eq("id", businessId)
    .single();

  if (error) {
    if (isOnboardingSchemaError(error.message)) {
      return {
        businessId,
        completed: true,
        tabsVisited: [...ONBOARDING_TABS],
      };
    }
    throw new Error(error.message);
  }

  return {
    businessId: data.id,
    completed: data.onboarding_completed ?? false,
    tabsVisited: parseTabsVisited(data.onboarding_tabs_visited),
  };
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
    .select("id, onboarding_completed, onboarding_tabs_visited")
    .eq("id", businessId)
    .single();

  if (error) {
    if (isOnboardingSchemaError(error.message)) {
      return { path: "/dashboard", migrationRequired: true };
    }
    throw new Error(error.message);
  }

  // Getting Started is the professional first-run surface. Brand-new users
  // should see the trial step there first, with later setup steps locked until
  // the trial is active, instead of being dropped into Billing or Dashboard.
  const entitlements = await fetchEntitlements();
  if (!entitlements.entitled) {
    return { path: "/get-started", migrationRequired: false };
  }

  return { path: data.onboarding_completed ? "/dashboard" : "/get-started", migrationRequired: false };
}

export async function markOnboardingTabVisited(
  businessId: string,
  tab: OnboardingTabId,
  current: OnboardingTabId[],
): Promise<OnboardingTabId[]> {
  if (current.includes(tab)) return current;

  const tabsVisited = [...current, tab];
  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_tabs_visited: tabsVisited })
    .eq("id", businessId);

  if (error) throw new Error(error.message);
  return tabsVisited;
}

export async function completeOnboarding(businessId: string): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({
      onboarding_completed: true,
      onboarding_tabs_visited: [...ONBOARDING_TABS],
    })
    .eq("id", businessId);

  if (error) throw new Error(error.message);
}

export function allOnboardingTabsVisited(tabsVisited: OnboardingTabId[]): boolean {
  return ONBOARDING_TABS.every((tab) => tabsVisited.includes(tab));
}

export function nextOnboardingTab(tabsVisited: OnboardingTabId[]): OnboardingTabId | null {
  return ONBOARDING_TABS.find((tab) => !tabsVisited.includes(tab)) ?? null;
}
