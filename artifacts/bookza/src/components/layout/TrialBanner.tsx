import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

/**
 * A running count of what's left of the free trial.
 *
 * The trial no longer takes a card, which means nothing converts on its own:
 * day 14 arrives, the dashboard locks, and the only thing that ever asked the
 * customer to decide was an email they may not have opened. This bar is the
 * other half of that — the deadline stays visible inside the product every day
 * they use it, instead of arriving as a surprise.
 *
 * It stays quiet for most of the trial and only takes on urgency in the last
 * few days, because a warning that looks the same on day 2 as on day 14 is one
 * the reader learns to stop seeing.
 */

/** Days remaining at which the bar changes from informational to urgent. */
const URGENT_FROM_DAYS = 3;

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return Number.NaN;
  // Rounded up: a trial with six hours left has "1 day", never "0 days".
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function TrialBanner() {
  const { data: entitlements } = useEntitlements();

  if (!entitlements?.entitled) return null;
  if (entitlements.reason !== "trialing") return null;

  const endsAt = entitlements.trialEndsAt ?? entitlements.currentPeriodEnd;
  if (!endsAt) return null;

  const daysLeft = daysUntil(endsAt);
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return null;

  const urgent = daysLeft <= URGENT_FROM_DAYS;

  const label =
    daysLeft === 1
      ? "Your free trial ends today"
      : `${daysLeft} days left on your free trial`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-sm",
        urgent
          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-border/60 bg-primary/5 text-foreground",
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">
        No card on file — nothing will be charged.
      </span>
      <Link
        href="/billing"
        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
      >
        Choose a plan
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
