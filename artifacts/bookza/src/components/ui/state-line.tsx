import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A single line of a status ledger: what a thing is, and what state it is in.
 *
 * This is the shared device across the three screens where Qwickly's access
 * changes — the end of onboarding, the locked dashboard, and the locked sidebar
 * rail. All three are saying the same thing in different registers: the
 * business is still there, only our access to it changed. Saying it as a ledger
 * rather than a paragraph means the reassurance is *checkable* — the customer
 * can see that the booking page is still live rather than being told so.
 *
 * The colour rule is deliberately narrow, and it is what keeps these screens
 * from looking decorated: green means running, amber means paused, grey means
 * off. Nothing else on these surfaces takes a colour at all.
 */
export type LineState = "live" | "paused" | "off";

const DOT: Record<LineState, string> = {
  // Ringed rather than flat: at 6px a bare dot reads as a bullet, and these are
  // status indicators, not list markers.
  live: "bg-primary ring-primary/25",
  paused: "bg-amber-500 ring-amber-500/25",
  off: "bg-muted-foreground/40 ring-muted-foreground/15",
};

export function StateLine({
  state,
  label,
  value,
  className,
}: {
  state: LineState;
  label: ReactNode;
  /** The right-hand column — the state in plain words. */
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-3 py-2.5 text-sm",
        // Hairline between rows, never below the last one.
        "border-b border-border/50 last:border-b-0",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full ring-2",
          DOT[state],
        )}
      />
      <span className="min-w-0 flex-1 font-medium text-foreground">{label}</span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">{value}</span>
    </div>
  );
}
