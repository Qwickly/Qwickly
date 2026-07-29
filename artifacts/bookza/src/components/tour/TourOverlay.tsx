import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TourStep = {
  targetId: string;
  title: string;
  description: string;
  /** Fires when the user leaves this step (Next, or an auto-skip past an
   * invisible target) — before the next step's target is looked up. Lets a
   * step trigger a side effect the next step's target depends on, e.g.
   * opening a Dialog so its contents exist in the DOM to spotlight next. */
  onAdvance?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const PADDING = 8;
const GAP = 14;

function stripTourParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("tour");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/**
 * Spotlight tour triggered by a `?tour=<tourId>` URL param (set by the Getting
 * Started checklist's CTA links) — mirrors the `?tab=` deep-link pattern
 * already used by settings.tsx — or by `forceActive`, for follow-up tours
 * triggered by app state instead of a URL (e.g. "the user just created their
 * first service"). Renders nothing unless active, so multiple TourOverlay
 * mounts across the app never conflict. Dismissing strips the `tour` param so
 * a refresh won't replay it.
 */
export function TourOverlay({
  tourId,
  steps,
  forceActive = false,
  onFinish,
}: {
  tourId: string;
  steps: TourStep[];
  forceActive?: boolean;
  onFinish?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placeAbove, setPlaceAbove] = useState(false);
  const calloutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tour");
    if (forceActive || param === tourId) {
      setActive(true);
      setStepIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, forceActive]);

  const step = steps[stepIndex];

  useEffect(() => {
    if (!active || !step) return;

    let cancelled = false;
    let attempts = 0;

    const measure = () => {
      if (cancelled) return;
      // Some targets exist twice in the DOM at once (e.g. whatsapp-bot.tsx's
      // section nav renders a mobile-list copy and a desktop-aside copy of
      // every button, one of them hidden via CSS depending on breakpoint).
      // querySelector alone would grab whichever comes first regardless of
      // visibility, so scan all matches and use the first one that's actually
      // visible (offsetParent is null when an element or an ancestor is
      // display:none). If none are visible yet — e.g. still behind a loading
      // skeleton, or a Dialog this step's predecessor just opened and hasn't
      // finished rendering — treat it like "not found" and retry, then skip
      // the step if it never shows up.
      const candidates = document.querySelectorAll<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
      // offsetParent alone doesn't catch a node that's technically on-screen
      // but zero-sized (e.g. briefly clipped inside a Radix ScrollArea before
      // it's scrolled into place) — that produced a degenerate rect that
      // pinned the callout to the corner instead of retrying. Require real
      // dimensions too.
      const el = Array.from(candidates).find((c) => {
        if (c.offsetParent === null) return false;
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }) ?? null;
      const visible = el !== null;
      if (!visible) {
        attempts += 1;
        if (attempts < 15) {
          window.setTimeout(measure, 100);
        } else if (!cancelled) {
          // Target never became visible on this viewport — skip to the next
          // step (or end the tour if this was the last one) instead of
          // getting stuck.
          step.onAdvance?.();
          if (stepIndex + 1 >= steps.length) {
            setActive(false);
            stripTourParam();
          } else {
            setStepIndex((i) => i + 1);
            setRect(null);
          }
        }
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const update = () => {
        if (cancelled) return;
        const r = el.getBoundingClientRect();
        const calloutHeight = calloutRef.current?.offsetHeight ?? 160;
        const fitsBelow = r.bottom + GAP + calloutHeight < window.innerHeight;
        setPlaceAbove(!fitsBelow);
        setRect({
          top: r.top - PADDING,
          left: r.left - PADDING,
          width: r.width + PADDING * 2,
          height: r.height + PADDING * 2,
        });
      };
      update();
      // A single fixed delay to "settle after scrollIntoView" assumed every
      // scroll finishes around the same time — but distance varies a lot
      // between steps (no scroll needed vs. scrolling several rows down a
      // nested ScrollArea), so a short distance settled fine while a longer
      // one got measured mid-animation and froze there. Keep re-measuring on
      // every frame for ~600ms instead, which converges correctly either way.
      const settleStart = performance.now();
      const settleLoop = () => {
        if (cancelled) return;
        update();
        if (performance.now() - settleStart < 600) {
          window.requestAnimationFrame(settleLoop);
        }
      };
      window.requestAnimationFrame(settleLoop);
      window.addEventListener("resize", update);
      window.addEventListener("scroll", update, true);
      return () => {
        window.removeEventListener("resize", update);
        window.removeEventListener("scroll", update, true);
      };
    };

    const cleanup = measure();
    return () => {
      cancelled = true;
      if (typeof cleanup === "function") cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step, stepIndex, steps.length]);

  if (!active || !step || !rect) return null;

  const finish = (natural: boolean) => {
    setActive(false);
    stripTourParam();
    if (natural) onFinish?.();
  };

  const goNext = () => {
    step.onAdvance?.();
    if (stepIndex + 1 >= steps.length) {
      finish(true);
    } else {
      setStepIndex((i) => i + 1);
      setRect(null);
    }
  };

  const calloutHeight = calloutRef.current?.offsetHeight ?? 160;
  const desiredTop = placeAbove
    ? rect.top - GAP - calloutHeight
    : rect.top + rect.height + GAP;
  const calloutTop = Math.max(12, Math.min(desiredTop, window.innerHeight - calloutHeight - 12));
  const calloutLeft = Math.max(16, Math.min(rect.left, window.innerWidth - 336));

  return (
    // Explicit inline pointerEvents: some steps (e.g. billing's add-on
    // walkthrough) spotlight content inside an open Radix Dialog, which sets
    // document.body.style.pointerEvents = "none" while open and only opts its
    // own content node back in. This overlay renders outside that node, so
    // without reclaiming pointer-events here its Next/Skip buttons silently
    // stop responding to clicks the moment such a dialog is open.
    <div
      data-tour-overlay-root
      className="fixed inset-0 z-[100]"
      style={{ pointerEvents: "auto" }}
      role="dialog"
      aria-modal="true"
    >
      {/* Dimmed backdrop with a cut-out around the target, via the classic
          "huge box-shadow" trick — no SVG mask needed. */}
      <div
        className="pointer-events-none absolute rounded-xl transition-all duration-200"
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.65)",
        }}
      />
      <div
        className="pointer-events-none absolute rounded-xl ring-2 ring-primary transition-all duration-200"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />

      <div
        ref={calloutRef}
        className="absolute w-[320px] rounded-2xl border border-border/60 bg-popover p-4 text-popover-foreground shadow-xl"
        style={{ top: calloutTop, left: calloutLeft }}
      >
        <div
          className={cn(
            "absolute h-3 w-3 rotate-45 border bg-popover",
            placeAbove
              ? "-bottom-[7px] border-b border-r border-border/60"
              : "-top-[7px] border-l border-t border-border/60",
          )}
          style={{ left: Math.max(20, Math.min(rect.left + rect.width / 2 - calloutLeft, 300)) }}
        />

        <button
          type="button"
          onClick={() => finish(false)}
          aria-label="Close tour"
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Step {stepIndex + 1} of {steps.length}
        </p>
        <h3 className="mt-1 text-base font-semibold text-foreground">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.description}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => finish(false)}>
            Skip
          </Button>
          <Button size="sm" onClick={goNext}>
            {stepIndex + 1 >= steps.length ? "Got it" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
