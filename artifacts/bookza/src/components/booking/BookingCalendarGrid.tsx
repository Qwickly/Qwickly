import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const CALENDAR_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function BookingCalendarGrid({
  month,
  onMonthChange,
  selectedDate,
  onSelectDate,
  isDateSelectable,
  primaryColor,
  radiusCss,
  tone = "light",
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  selectedDate: string | null;
  onSelectDate: (isoDate: string) => void;
  isDateSelectable: (isoDate: string) => boolean;
  primaryColor: string;
  radiusCss: string;
  tone?: "light" | "dark";
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

  const dark = tone === "dark";
  const containerRadiusCss = radiusCss === "9999px" ? "1rem" : radiusCss;

  return (
    <div
      className={cn(
        "border p-3 overflow-x-auto",
        dark ? "border-zinc-800 bg-zinc-900 text-zinc-50" : "border-zinc-200 bg-white text-zinc-950",
      )}
      style={{ borderRadius: containerRadiusCss }}
    >
      <div className="min-w-[300px]">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
            disabled={isCurrentOrPastMonth}
            className={cn("p-1 rounded disabled:opacity-30", dark ? "text-zinc-300" : "text-zinc-700")}
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium">{monthLabel}</span>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
            className={cn("p-1 rounded", dark ? "text-zinc-300" : "text-zinc-700")}
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-zinc-400 mb-1">
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
                  dark ? "text-zinc-100" : "text-zinc-800",
                  selectable && !selected && (dark ? "hover:bg-zinc-800" : "hover:bg-zinc-100"),
                  !selectable &&
                    (dark
                      ? "cursor-not-allowed bg-zinc-800/70 text-zinc-500"
                      : "cursor-not-allowed text-zinc-300"),
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
