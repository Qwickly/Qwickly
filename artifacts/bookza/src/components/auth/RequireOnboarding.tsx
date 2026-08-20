import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { fetchOnboardingCompleted } from "@/lib/onboarding";

export const onboardingKeys = {
  completed: ["onboarding", "completed"] as const,
};

/**
 * Keeps accounts that haven't finished first-run setup out of the app shell.
 *
 * Must be rendered inside ProtectedRoute — the query needs a session — and must
 * never wrap /onboarding itself, or the redirect below becomes a loop.
 *
 * Before this, a new account landed *in* the shell with the sidebar replaced by
 * a "Setup locked" panel: the first thing anyone saw was a list of what they
 * could not do. Setup now owns the whole screen until it is finished, and the
 * shell is what you are let into afterwards.
 */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { data, isPending, isError } = useQuery({
    queryKey: onboardingKeys.completed,
    queryFn: fetchOnboardingCompleted,
    // This changes once in the life of an account. Re-asking on every
    // navigation between shell pages is wasted traffic.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isPending) {
    // Full-screen, NOT inline. This guard runs OUTSIDE AppLayout (see AppShell
    // in App.tsx: ProtectedRoute > RequireOnboarding > AppLayout), so there is
    // no sidebar to preserve — the inline variant is relative, 60vh tall and
    // transparent, which dropped the dots to a third of the way down a bare
    // page and let the backdrop through. Coming straight from the fixed,
    // centred loader index.html paints, that read as the boot jumping up,
    // changing colour, then jumping back.
    return <AppBootLoader label="Loading your account" />;
  }

  // Fail open. A failed request says nothing about onboarding state, and
  // redirecting on it would strand established businesses in setup every time
  // the network blipped.
  if (isError) return children;

  // A PayFast round trip comes back to /billing?payfast=… whatever started it,
  // because the edge function builds that return_url. Redirecting it away from
  // there would drop `subscription_id` before billing.tsx could confirm the
  // payment — and billing forwards to /onboarding itself once it has. So a
  // return trip is let through, and setup resumes on the far side of it.
  const returningFromPayFast =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("payfast");

  if (!data && !returningFromPayFast) return <Redirect to="/onboarding" />;

  return children;
}
