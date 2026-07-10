import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Loader2, Scissors, User, XCircle } from "lucide-react";
import { fetchPublicBookingSlots } from "@/lib/booking-page";
import {
  cancelManagedBooking,
  fetchManagedBooking,
  rescheduleManagedBooking,
  type ManagedBooking,
} from "@/lib/manage-booking";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import type { BookingSlot } from "@/types/booking-page";
import { useToast } from "@/hooks/use-toast";

const PRIMARY = "#42A324";
const RADIUS = "0.75rem";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(iso));
}

const STATUS_LABEL: Record<ManagedBooking["status"], string> = {
  pending: "Awaiting confirmation",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
  no_show: "Missed",
};

export default function ManageBookingPage({ token }: { token: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["managed-booking", token];

  const { data: booking, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchManagedBooking(token),
    enabled: Boolean(token),
  });

  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // Reschedule flow state
  const [month, setMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const todayIso = toIsoDate(new Date());

  const cancelMutation = useMutation({
    mutationFn: () => cancelManagedBooking(token),
    onSuccess: async () => {
      setConfirmingCancel(false);
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Booking cancelled", description: "Your appointment has been cancelled." });
    },
    onError: (err) =>
      toast({
        title: "Could not cancel",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newStartIso: string) => rescheduleManagedBooking(token, newStartIso),
    onSuccess: async () => {
      setMode("view");
      setSelectedDate(null);
      setSelectedSlot(null);
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Booking rescheduled", description: "Your new time is confirmed." });
    },
    onError: (err) =>
      toast({
        title: "Could not reschedule",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      }),
  });

  async function loadSlots(date: string) {
    if (!booking?.businessSlug) {
      setSlotsError("This business's booking page is unavailable.");
      return;
    }
    setSelectedDate(date);
    setSelectedSlot(null);
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const result = await fetchPublicBookingSlots({
        slug: booking.businessSlug,
        serviceId: booking.serviceId,
        staffId: booking.staffId,
        date,
      });
      setSlots(result);
    } catch (err) {
      setSlotsError(err instanceof Error ? err.message : "Could not load times.");
    } finally {
      setSlotsLoading(false);
    }
  }

  function confirmReschedule() {
    if (!selectedDate || !selectedSlot) return;
    const local = new Date(`${selectedDate}T${selectedSlot.startTime}:00`);
    if (Number.isNaN(local.getTime())) return;
    rescheduleMutation.mutate(local.toISOString());
  }

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading your booking…
          </div>
        ) : error || !booking ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-zinc-900">Booking not found</h1>
            <p className="mt-2 text-sm text-zinc-500">
              This link is invalid or has expired. Please check the link in your confirmation email.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-zinc-900">{booking.businessName}</h1>
              <p className="mt-1 text-sm text-zinc-500">Manage your booking</p>
            </div>

            {/* Booking summary */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm" style={{ borderRadius: RADIUS }}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Your appointment</span>
                <StatusBadge status={booking.status} />
              </div>
              <div className="space-y-3 text-sm">
                <Row icon={<Scissors className="h-4 w-4" />} label={booking.serviceName} />
                <Row
                  icon={<User className="h-4 w-4" />}
                  label={booking.staffName ?? "Any available team member"}
                />
                <Row icon={<CalendarClock className="h-4 w-4" />} label={formatDateTime(booking.startTime)} />
              </div>
            </div>

            {/* Actions */}
            {mode === "view" && (
              <ViewActions
                booking={booking}
                confirmingCancel={confirmingCancel}
                cancelling={cancelMutation.isPending}
                onStartReschedule={() => setMode("reschedule")}
                onAskCancel={() => setConfirmingCancel(true)}
                onDismissCancel={() => setConfirmingCancel(false)}
                onConfirmCancel={() => cancelMutation.mutate()}
              />
            )}

            {mode === "reschedule" && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm" style={{ borderRadius: RADIUS }}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-zinc-900">Pick a new time</h2>
                  <button
                    type="button"
                    className="text-sm text-zinc-500 hover:text-zinc-800"
                    onClick={() => {
                      setMode("view");
                      setSelectedDate(null);
                      setSelectedSlot(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>

                <BookingCalendarGrid
                  month={month}
                  onMonthChange={setMonth}
                  selectedDate={selectedDate}
                  onSelectDate={loadSlots}
                  isDateSelectable={(iso) => iso >= todayIso}
                  primaryColor={PRIMARY}
                  radiusCss={RADIUS}
                />

                {selectedDate && (
                  <div className="mt-4">
                    <BookingSlotPicker
                      slots={slots}
                      selectedSlot={selectedSlot}
                      onSelect={setSelectedSlot}
                      loading={slotsLoading}
                      error={slotsError}
                      primaryColor={PRIMARY}
                      radiusCss={RADIUS}
                    />
                  </div>
                )}

                <button
                  type="button"
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                  style={{ background: PRIMARY, borderRadius: RADIUS }}
                  disabled={!selectedSlot || rescheduleMutation.isPending}
                  onClick={confirmReschedule}
                >
                  {rescheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Confirm new time
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2.5 text-zinc-700">
      <span className="text-zinc-400">{icon}</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ViewActions({
  booking,
  confirmingCancel,
  cancelling,
  onStartReschedule,
  onAskCancel,
  onDismissCancel,
  onConfirmCancel,
}: {
  booking: ManagedBooking;
  confirmingCancel: boolean;
  cancelling: boolean;
  onStartReschedule: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}) {
  if (booking.status === "cancelled") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-center text-sm text-zinc-500 shadow-sm">
        This booking has been cancelled.
      </div>
    );
  }
  if (!booking.canCancel && !booking.canReschedule) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-center text-sm text-zinc-500 shadow-sm">
        This booking can no longer be changed online. Please contact {booking.businessName} directly.
      </div>
    );
  }

  if (confirmingCancel) {
    return (
      <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50/60 p-5 shadow-sm">
        <p className="text-sm font-medium text-red-800">Cancel this booking?</p>
        <p className="text-sm text-red-700/80">This can&apos;t be undone. You&apos;d need to book again.</p>
        <div className="flex gap-2">
          <button
            type="button"
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            disabled={cancelling}
            onClick={onConfirmCancel}
          >
            {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            Yes, cancel
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            onClick={onDismissCancel}
          >
            Keep it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {booking.canReschedule && (
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold text-white"
          style={{ background: PRIMARY, borderRadius: RADIUS }}
          onClick={onStartReschedule}
        >
          <CalendarClock className="h-4 w-4" />
          Reschedule
        </button>
      )}
      {booking.canCancel && (
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          style={{ borderRadius: RADIUS }}
          onClick={onAskCancel}
        >
          <XCircle className="h-4 w-4" />
          Cancel booking
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ManagedBooking["status"] }) {
  const styles: Record<ManagedBooking["status"], string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled: "bg-zinc-100 text-zinc-500 border-zinc-200",
    completed: "bg-sky-50 text-sky-700 border-sky-200",
    no_show: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}
    >
      {status === "confirmed" ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {STATUS_LABEL[status]}
    </span>
  );
}
