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
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  selectedDate: string | null;
  onSelectDate: (isoDate: string) => void;
  isDateSelectable: (isoDate: string) => boolean;
  primaryColor: string;
  radiusCss: string;
}) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const monthLabel = month.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

  const today = new Date();
  const isCurrentOrPastMonth = year < today.getFullYear() || (year === today.getFullYear() && monthIndex <= today.getMonth());

  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toIsoDate(new Date(year, monthIndex, i + 1))),
  ];

  return (
    <div className="border p-3 overflow-x-auto" style={{ borderRadius: radiusCss }}>
      <div className="min-w-[300px]">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex - 1, 1))}
            disabled={isCurrentOrPastMonth}
            className="p-1 rounded disabled:opacity-30"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium">{monthLabel}</span>
          <button
            type="button"
            onClick={() => onMonthChange(new Date(year, monthIndex + 1, 1))}
            className="p-1 rounded"
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
            const dayNum = Number(iso.slice(-2));
            return (
              <button
                key={iso}
                type="button"
                disabled={!selectable}
                onClick={() => onSelectDate(iso)}
                className={cn(
                  "aspect-square text-sm rounded-md transition-all",
                  selectable ? "hover:bg-zinc-100" : "text-zinc-300 cursor-not-allowed",
                )}
                style={selected ? { backgroundColor: primaryColor, color: "white" } : undefined}
              >
                {dayNum}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
