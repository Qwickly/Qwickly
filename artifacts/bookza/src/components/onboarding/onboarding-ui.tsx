import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import icon from "@/assets/qwickly-icon.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The five things setup asks for, after the two questions it opens with.
 *
 * Those two — what kind of business, and how many people take bookings — are
 * deliberately outside the count. They are one tap each and they exist to fill
 * the rest of the flow in, so numbering them would frame signing up as the
 * start of paperwork rather than the end of signing up.
 *
 * The order is doing work. Services come before hours because the industry
 * answer pre-fills them, so the longest step is also the one that arrives
 * mostly done; and the card is last because by then there is a booking page
 * with the business's own services on it, which is the thing being bought.
 */
export const ONBOARDING_STEPS = [
  { id: "business", label: "Your business" },
  { id: "services", label: "What you offer" },
  { id: "staff", label: "Who books" },
  { id: "hours", label: "Your hours" },
  { id: "trial", label: "Start trial" },
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]["id"];

/**
 * Every screen in the flow, including the three that sit outside the count:
 * the opening question, the moment setup publishes and commits, and the
 * hand-over at the end.
 */
export type OnboardingScreen =
  | "industry"
  | "team"
  | OnboardingStepId
  | "finishing"
  | "done";

/**
 * The page under all of it.
 *
 * `--brand-backdrop` is the same green wash the app shell paints, so setup and
 * the product it leads into are visibly one surface rather than a landing page
 * bolted to an app. Nothing else lives in the corners: the first thing a new
 * account sees should be the question, and a logo and a "skip" link flanking it
 * are two things competing with it for the first glance. Back is the exception,
 * because a flow you cannot reverse is a form, not a conversation.
 */
export function OnboardingLayout({
  children,
  onBack,
  progress,
}: {
  children: ReactNode;
  /** Absent on the first screen and on the two that cannot be reversed. */
  onBack?: () => void;
  /** 0–1. A hairline, not a widget — it answers "how far" without saying it. */
  progress?: number;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      className="relative flex min-h-dvh flex-col"
      style={{ background: "var(--brand-backdrop)" }}
    >
      {typeof progress === "number" ? (
        <div className="fixed inset-x-0 top-0 z-20 h-0.5 bg-transparent">
          <motion.div
            className="h-full origin-left bg-primary/70"
            initial={false}
            animate={{ scaleX: Math.max(0.02, Math.min(1, progress)) }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ width: "100%" }}
          />
        </div>
      ) : null}

      <header className="relative z-10 flex h-20 shrink-0 items-center px-5 sm:px-8">
        <AnimatePresence>
          {onBack ? (
            <motion.div
              initial={reduced ? false : { opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: -6 }}
              transition={{ duration: 0.2 }}
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                className="h-10 w-10 rounded-xl border border-border/60 bg-card/70 text-muted-foreground backdrop-blur hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back</span>
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center px-5 pb-24 sm:px-6">
        {children}
      </main>
    </div>
  );
}

/**
 * The mark above every question.
 *
 * The Qwickly icon at its own colours, over a bloom of the brand green. It was
 * a gradient disc with the icon knocked out in white, which is the shape of a
 * generic onboarding template — and forcing the mark to white to survive the
 * gradient threw away the one part of it that was ours.
 *
 * It is the single fixed thing across the flow, so the screens read as one
 * conversation rather than a sequence of forms.
 */
export function OnboardingMark({ className }: { className?: string }) {
  const reduced = useReducedMotion();

  return (
    <div className={cn("relative mx-auto h-14 w-14", className)}>
      {/* A bloom of the brand colour rather than a disc of it — enough to lift
          the mark off the page, not enough to become the subject. */}
      <div
        aria-hidden
        className="absolute -inset-8 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(circle, hsl(var(--primary) / 0.35), transparent 70%)" }}
      />
      <motion.img
        src={icon}
        alt=""
        aria-hidden
        initial={reduced ? false : { scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative h-14 w-14"
      />
    </div>
  );
}

/**
 * One question, centred, with room around it.
 *
 * No card. A bordered panel is right for a settings page, where a form is one
 * object among several; here the form is the entire screen, and drawing a box
 * around it only makes the screen look emptier than it is.
 *
 * `width` widens the column for the two steps that are lists rather than
 * questions — the type scale and the spacing stay the same, so they still read
 * as the same conversation.
 */
export function OnboardingScreenBody({
  title,
  description,
  children,
  actions,
  width = "narrow",
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  width?: "narrow" | "wide";
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center pt-4 text-center sm:pt-10",
        width === "wide" ? "max-w-2xl" : "max-w-xl",
      )}
    >
      <OnboardingMark />

      <h1 className="mt-7 text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-[2.75rem] sm:leading-[1.1]">
        {title}
      </h1>

      {description ? (
        <p className="mx-auto mt-4 max-w-md text-[0.9375rem] leading-7 text-muted-foreground">
          {description}
        </p>
      ) : null}

      {children ? <div className="mt-10 w-full text-left">{children}</div> : null}

      {actions ? (
        <div className="mt-10 flex w-full flex-col items-center gap-3">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * The way forward: the app's own primary button, at the app's own size.
 *
 * It was a glowing circle, which looked good and looked like nothing else in
 * the product. Onboarding is the first impression of the app, so it should be
 * built out of the app's parts — a new user learns what a primary action looks
 * like here and then has to find it again on every page afterwards.
 */
export function OnboardingNext({
  onClick,
  disabled,
  pending,
  label = "Continue",
}: {
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  label?: string;
}) {
  return (
    <Button size="lg" className="min-w-[13rem]" onClick={onClick} disabled={disabled || pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
      {!pending ? <ArrowRight className="h-4 w-4" /> : null}
    </Button>
  );
}

/** The quiet way past a step that is not required. */
export function OnboardingSkip({ onClick, children = "Skip for now" }: { onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
    >
      {children}
    </button>
  );
}

/**
 * The transition between screens.
 *
 * Direction-aware: moving forward, the next screen arrives from the right;
 * going back, it arrives from the left. Both are small — 24px and a fade — so
 * it reads as one surface moving rather than pages being swapped. Honoured
 * against `prefers-reduced-motion`, where it becomes a cut.
 */
export function OnboardingTransition({
  screenKey,
  direction,
  children,
}: {
  screenKey: string;
  /** 1 = forward, -1 = back. */
  direction: 1 | -1;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div
        key={screenKey}
        custom={direction}
        className="flex w-full flex-1 justify-center"
        variants={{
          enter: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: dir * 24 }),
          center: { opacity: 1, x: 0 },
          exit: (dir: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: dir * -24 }),
        }}
        initial="enter"
        animate="center"
        exit="exit"
        transition={reduced ? { duration: 0.12 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
