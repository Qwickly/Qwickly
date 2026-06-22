import { useEffect, useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { fetchOnboardingStatus } from "@/lib/onboarding";

export function OnboardingGuard({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    fetchOnboardingStatus()
      .then((s) => setNeedsOnboarding(!s.completed))
      .catch(() => setNeedsOnboarding(false));
  }, [location]);

  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (needsOnboarding && location !== "/settings") {
    return <Redirect to="/settings?onboarding=1" />;
  }

  return children;
}
