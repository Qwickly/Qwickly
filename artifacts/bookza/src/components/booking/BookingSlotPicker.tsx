import type { BookingSlot } from "@/types/booking-page";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BookingSurfaceTone } from "@/components/booking/BookingCalendarGrid";

const TONE = {
  light: {
    muted: "text-zinc-500",
    error: "text-red-600",
    slot: "bg-white text-zinc-800 hover:bg-zinc-50",
    border: "#e4e4e7",
  },
  dark: {
    muted: "text-zinc-400",
    error: "text-red-500",
    slot: "bg-zinc-900 text-zinc-100 hover:bg-zinc-800",
    border: "#3f3f46",
  },
  app: {
    muted: "text-muted-foreground",
    error: "text-destructive",
    slot: "bg-background text-foreground hover:bg-muted",
    border: "hsl(var(--border))",
  },
} satisfies Record<BookingSurfaceTone, { muted: string; error: string; slot: string; border: string }>;

export function BookingSlotPicker({
  slots,
  selectedSlot,
  onSelect,
  loading,
  error,
  primaryColor,
  radiusCss,
  tone = "light",
  className,
}: {
  slots: BookingSlot[];
  selectedSlot: BookingSlot | null;
  onSelect: (slot: BookingSlot) => void;
  loading: boolean;
  error: string | null;
  primaryColor: string;
  radiusCss: string;
  tone?: BookingSurfaceTone;
  className?: string;
}) {
  // Reserve a consistent height so the panel never collapses to a single line
  // between day changes — that collapse-then-expand is what makes the page jump.
  // While new times load, the previous grid stays visible (dimmed) instead of
  // disappearing, and only a first load (no slots yet) shows the centered spinner.
  const firstLoad = loading && slots.length === 0;
  const styles = TONE[tone];

  if (error) {
    return (
      <div className={cn("flex min-h-[120px] items-center justify-center", className)}>
        <p className={cn("text-sm", styles.error)}>{error}</p>
      </div>
    );
  }

  if (firstLoad) {
    return (
      <div className={cn("flex min-h-[120px] items-center justify-center gap-2 text-sm", styles.muted, className)}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading available times…
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className={cn("flex min-h-[120px] items-center justify-center px-4 text-center", className)}>
        <p className={cn("text-sm", styles.muted)}>No times available that day. Please choose another date.</p>
      </div>
    );
  }

  return (
    <div className={cn("relative min-h-[120px] max-h-[280px] overflow-y-auto p-1.5", className)}>
      <div
        className={cn(
          "grid grid-cols-2 gap-2 transition-opacity duration-200 sm:grid-cols-3",
          loading && "pointer-events-none opacity-50",
        )}
      >
        {slots.map((slot) => {
          const selected = selectedSlot?.startTime === slot.startTime;
          return (
            <button
              key={slot.startTime}
              type="button"
              onClick={() => onSelect(slot)}
              className={cn(
                "w-full min-h-[44px] px-3 py-2 text-sm font-medium transition-[background-color,color,border-color] duration-300 ease-out",
                selected ? "text-white" : styles.slot,
              )}
              style={{
                borderRadius: radiusCss,
                // Border inline: the marketing CSS `button { border: 0 }` hides
                // utility borders, so set it here where it can't be overridden.
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: selected ? primaryColor : styles.border,
                backgroundColor: selected ? primaryColor : undefined,
                color: selected ? "white" : undefined,
              }}
            >
              {slot.startTime}
            </button>
          );
        })}
      </div>

      {/* Subtle spinner while re-fetching a different day, without hiding the grid. */}
      {loading && (
        <div className="pointer-events-none absolute right-2 top-2">
          <Loader2 className={cn("h-4 w-4 animate-spin", styles.muted)} />
        </div>
      )}
    </div>
  );
}
