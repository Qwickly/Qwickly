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
    <div className="flex flex-wrap gap-2">
      {slots.map((slot) => {
        const selected = selectedSlot?.startTime === slot.startTime;
        return (
          <button
            key={slot.startTime}
            type="button"
            onClick={() => onSelect(slot)}
            className={cn("px-3 py-2 text-sm border transition-all", selected ? "ring-2 bg-zinc-50" : "bg-white")}
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
  );
}
