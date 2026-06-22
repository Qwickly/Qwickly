import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";

export const ONBOARDING_TABS = [
  "profile",
  "notifications",
  "payments",
  "whatsapp",
  "team",
  "security",
] as const;

export type OnboardingTabId = (typeof ONBOARDING_TABS)[number];

export const ONBOARDING_TAB_LABELS: Record<OnboardingTabId, string> = {
  profile: "Business Profile",
  notifications: "Notifications",
  payments: "Payment Methods",
  whatsapp: "WhatsApp Setup",
  team: "Team Permissions",
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

export const ONBOARDING_MIGRATION_FILE = "supabase/migrations/002_onboarding.sql";

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

  const completed = data.onboarding_completed ?? false;
  if (!completed) {
    return { path: "/settings?onboarding=1", migrationRequired: false };
  }
  return { path: "/dashboard", migrationRequired: false };
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
