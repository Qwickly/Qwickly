import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CALENDAR_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * `light`/`dark` are for the public booking pages, which render outside the app
 * theme (marketing CSS, embedded iframes) and therefore need literal colours.
 * `app` is for anything inside the dashboard: it follows the theme tokens, so a
 * calendar never ends up dark while the times next to it stay light.
 */
export type BookingSurfaceTone = "light" | "dark" | "app";

const TONE = {
  light: {
    container: "border-zinc-200 bg-white text-zinc-950",
    nav: "text-zinc-700",
    weekday: "text-zinc-400",
    day: "text-zinc-800",
    dayHover: "hover:bg-zinc-100",
    dayDisabled: "cursor-not-allowed text-zinc-300",
  },
  dark: {
    container: "border-zinc-800 bg-zinc-900 text-zinc-50",
    nav: "text-zinc-300",
    weekday: "text-zinc-400",
    day: "text-zinc-100",
    dayHover: "hover:bg-zinc-800",
    dayDisabled: "cursor-not-allowed bg-zinc-800/70 text-zinc-500",
  },
  app: {
    container: "border-border bg-card text-card-foreground",
    nav: "text-muted-foreground hover:text-foreground",
    weekday: "text-muted-foreground",
    day: "text-foreground",
    dayHover: "hover:bg-muted",
    dayDisabled: "cursor-not-allowed text-muted-foreground/40",
  },
} satisfies Record<BookingSurfaceTone, Record<string, string>>;

export function BookingCalendarGrid({
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  isDateSelectable,
  primaryColor,
  radiusCss,
  tone = "light",
  className,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  selectedDate: string | null;
  onSelectDate: (isoDate: string) => void;
  isDateSelectable: (isoDate: string) => boolean;
  primaryColor: string;
  radiusCss: string;
  tone?: BookingSurfaceTone;
  className?: string;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const monthLabel = month.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

  const today = new Date();
  const todayIso = toIsoDate(today);
  const isCurrentOrPastMonth = year < today.getFullYear() || (year === today.getFullYear() && monthIndex <= today.getMonth());

  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toIsoDate(new Date(year, monthIndex, i + 1))),
  ];

  const styles = TONE[tone];
  const containerRadiusCss = radiusCss === "9999px" ? "1rem" : radiusCss;

  return (
    <div
      className={cn("border p-3 overflow-x-auto", styles.container, className)}
      style={{ borderRadius: containerRadiusCss }}
    >
      <div className="min-w-[260px]">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
            disabled={isCurrentOrPastMonth}
            className={cn("p-1 rounded disabled:opacity-30", styles.nav)}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium">{monthLabel}</span>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
            className={cn("p-1 rounded", styles.nav)}
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className={cn("grid grid-cols-7 gap-1 text-center text-xs mb-1", styles.weekday)}>
          {CALENDAR_WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((iso, idx) => {
            if (!iso) return <div key={`blank-${idx}`} />;
            const selectable = isDateSelectable(iso);
            const selected = selectedDate === iso;
            const isToday = iso === todayIso;
            const dayNum = Number(iso.slice(-2));
            return (
              <button
                key={iso}
                type="button"
                disabled={!selectable}
                onClick={() => onSelectDate(iso)}
                className={cn(
                  "flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md text-sm transition-[background-color,color] duration-300 ease-out",
                  styles.day,
                  selectable && !selected && styles.dayHover,
                  !selectable && styles.dayDisabled,
                )}
                style={{
                  backgroundColor: selected ? primaryColor : undefined,
                  color: selected ? "white" : undefined,
                }}
              >
                <span className="leading-none">{dayNum}</span>
                {isToday && (
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: selected ? "white" : primaryColor }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
