import { useEffect, useState } from "react";
import { fetchBusinessBookingSlots } from "@/lib/catalog";
import type { BookingSlot } from "@/types/booking-page";

export function useBookingSlots(params: {
  serviceId: string | null;
  staffId: string | null;
  date: string | null;
}): { slots: BookingSlot[]; loading: boolean; error: string | null } {
  const { serviceId, staffId, date } = params;
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date || !serviceId) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBusinessBookingSlots({ serviceId, staffId, date })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load available times.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId, date]);

  return { slots, loading, error };
}
