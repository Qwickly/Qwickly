import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, X } from "lucide-react";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

/**
 * A running count of what is left of the free trial.
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
 *
 * And it can be closed. A bar pinned above every page is cheap on a desktop and
 * expensive on a phone, where it was eating a chunk of a screen the customer is
 * trying to work in. Dismissing it is remembered for the rest of the day only:
 * this is a countdown, so silencing it forever is not something we can honour
 * and then still claim they were told.
 */

/** Days remaining at which the bar changes from informational to urgent. */
const URGENT_FROM_DAYS = 3;

const DISMISS_KEY = "qwickly.trialBanner.dismissed";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Was it dismissed in a way that still applies?
 *
 * Two things bring it back: a new day, and the trial crossing into its final
 * days. The second matters — "12 days left" and "your trial ends tomorrow" are
 * different messages, and a dismissal of the first should not silence the
 * second.
 */
function readDismissal(): { date: string; urgent: boolean } | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: unknown; urgent?: unknown };
    if (typeof parsed?.date !== "string") return null;
    return { date: parsed.date, urgent: parsed.urgent === true };
  } catch {
    // Private mode, blocked storage, or something else wrote the key. The bar
    // showing when it could have stayed hidden is the harmless direction.
    return null;
  }
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return Number.NaN;
  // Rounded up: a trial with six hours left has "1 day", never "0 days".
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function TrialBanner() {
  const { data: entitlements } = useEntitlements();
  const [dismissal, setDismissal] = useState(() =>
    typeof window === "undefined" ? null : readDismissal(),
  );

  if (!entitlements?.entitled) return null;
  if (entitlements.reason !== "trialing") return null;

  const endsAt = entitlements.trialEndsAt ?? entitlements.currentPeriodEnd;
  if (!endsAt) return null;

  const daysLeft = daysUntil(endsAt);
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return null;

  const urgent = daysLeft <= URGENT_FROM_DAYS;

  if (dismissal && dismissal.date === today() && dismissal.urgent === urgent) {
    return null;
  }

  const dismiss = () => {
    const record = { date: today(), urgent };
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify(record));
    } catch {
      // Not being able to remember it is survivable; closing it now is not
      // optional, so the state update happens either way.
    }
    setDismissal(record);
  };

  const label =
    daysLeft === 1 ? "Your free trial ends today" : `${daysLeft} days left on your free trial`;

  return (
    <div
      className={cn(
        "flex items-center gap-x-3 border-b px-3 py-2 text-sm sm:px-4",
        urgent
          ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
          : "border-border/60 bg-primary/5 text-foreground",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-center">
        <span className="font-medium">{label}</span>
        {/* The reassurance is the first thing to go when space is short — on a
            phone the deadline and the way to act on it are what matter. */}
        <span className="hidden text-muted-foreground sm:inline">
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

      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide trial reminder for today"
        title="Hide for today"
        className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
