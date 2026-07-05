import type { BookingSlot } from "@/types/booking-page";
import { cn } from "@/lib/utils";

export function BookingSlotPicker({
  slots,
  selectedSlot,
  onSelect,
  loading,
  error,
  primaryColor,
  radiusCss,
}: {
  slots: BookingSlot[];
  selectedSlot: BookingSlot | null;
  onSelect: (slot: BookingSlot) => void;
  loading: boolean;
  error: string | null;
  primaryColor: string;
  radiusCss: string;
}) {
  if (loading) {
    return <p className="text-sm text-zinc-500">Loading available times…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (slots.length === 0) {
    return <p className="text-sm text-zinc-500">No times available that day. Please choose another date.</p>;
  }

  return (
    <div className="max-h-[280px] overflow-y-auto p-1.5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {slots.map((slot) => {
          const selected = selectedSlot?.startTime === slot.startTime;
          return (
            <button
              key={slot.startTime}
              type="button"
              onClick={() => onSelect(slot)}
              className={cn(
                "w-full min-h-[44px] rounded-lg border px-3 py-2 text-sm font-medium transition-all",
                selected ? "bg-zinc-100 ring-2" : "bg-white hover:bg-zinc-50",
              )}
              style={{
                borderRadius: radiusCss,
                borderColor: selected ? primaryColor : undefined,
                color: selected ? primaryColor : undefined,
                ...(selected ? { ringColor: primaryColor } : {}),
              }}
            >
              {slot.startTime}
            </button>
          );
        })}
      </div>
    </div>
  );
}
