import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Loader2, Scissors, User, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchPublicBookingPage, fetchPublicBookingSlots } from "@/lib/booking-page";
import {
  BookingPageHeader,
  buttonClasses,
  buttonStyle,
  fontCssFor,
  radiusCssFor,
} from "@/components/booking/booking-theme";
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

const DEFAULT_PRIMARY = "#42A324";
const DEFAULT_RADIUS = "0.75rem";

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

  // Pull the business's booking-page theme so this page is visually identical to
  // the page they booked on (font, header, colour, radius, buttons).
  const { data: theme } = useQuery({
    queryKey: ["booking-theme", booking?.businessSlug],
    queryFn: () => fetchPublicBookingPage(booking!.businessSlug!),
    enabled: Boolean(booking?.businessSlug),
  });

  const settings = theme?.settings;
  const primary = settings?.primaryColor || DEFAULT_PRIMARY;
  const radius = settings ? radiusCssFor(settings) : DEFAULT_RADIUS;
  const fontCss = settings ? fontCssFor(settings) : undefined;

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

  // Primary button styling: match the booking page's CTA when we have the theme.
  const primaryBtnClass = settings
    ? cn(buttonClasses(settings), "flex items-center justify-center gap-2")
    : "flex items-center justify-center gap-2 py-3 font-semibold text-white";
  const primaryBtnStyle: CSSProperties = settings
    ? buttonStyle(settings, radius)
    : { background: primary, borderRadius: radius };

  const bodyTopPad = settings?.headerStyle === "banner" ? "pt-12" : "pt-8";

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-6" style={fontCss ? { fontFamily: fontCss } : undefined}>
      <div className="mx-auto w-full max-w-[980px] space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-24 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading your booking…
          </div>
        ) : error || !booking ? (
          <div className="rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
            <h1 className="text-xl font-bold text-zinc-900">Booking not found</h1>
            <p className="mt-2 text-sm text-zinc-500">
              This link is invalid or has expired. Please check the link in your confirmation email.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-3xl bg-white text-zinc-900 shadow-sm">
              {settings ? (
                <BookingPageHeader settings={settings} />
              ) : (
                <div className="px-6 py-8 text-center text-white" style={{ background: primary }}>
                  <h1 className="text-2xl font-bold">{booking.businessName}</h1>
                </div>
              )}

              <div className={cn("space-y-4 px-4 pb-10 md:px-8", bodyTopPad)}>
                <p className="text-center text-sm text-zinc-500">Manage your booking</p>

                {/* Booking summary */}
                <div className="border border-zinc-200 p-5" style={{ borderRadius: radius }}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                      Your appointment
                    </span>
                    <StatusBadge status={booking.status} primary={primary} />
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

                {mode === "view" && (
                  <ViewActions
                    booking={booking}
                    radius={radius}
                    primaryBtnClass={primaryBtnClass}
                    primaryBtnStyle={primaryBtnStyle}
                    confirmingCancel={confirmingCancel}
                    cancelling={cancelMutation.isPending}
                    onStartReschedule={() => setMode("reschedule")}
                    onAskCancel={() => setConfirmingCancel(true)}
                    onDismissCancel={() => setConfirmingCancel(false)}
                    onConfirmCancel={() => cancelMutation.mutate()}
                  />
                )}

                {mode === "reschedule" && (
                  <div className="border border-zinc-200 p-5" style={{ borderRadius: radius }}>
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
                      primaryColor={primary}
                      radiusCss={radius}
                    />

                    {selectedDate && (
                      <div className="mt-4">
                        <BookingSlotPicker
                          slots={slots}
                          selectedSlot={selectedSlot}
                          onSelect={setSelectedSlot}
                          loading={slotsLoading}
                          error={slotsError}
                          primaryColor={primary}
                          radiusCss={radius}
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      className={cn(primaryBtnClass, "mt-5 w-full transition-opacity disabled:opacity-50")}
                      style={primaryBtnStyle}
                      disabled={!selectedSlot || rescheduleMutation.isPending}
                      onClick={confirmReschedule}
                    >
                      {rescheduleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Confirm new time
                    </button>
                  </div>
                )}
              </div>
            </div>

            <p className="text-center text-xs text-zinc-400">Powered by Qwickly</p>
          </>
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
  radius,
  primaryBtnClass,
  primaryBtnStyle,
  confirmingCancel,
  cancelling,
  onStartReschedule,
  onAskCancel,
  onDismissCancel,
  onConfirmCancel,
}: {
  booking: ManagedBooking;
  radius: string;
  primaryBtnClass: string;
  primaryBtnStyle: CSSProperties;
  confirmingCancel: boolean;
  cancelling: boolean;
  onStartReschedule: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}) {
  if (booking.status === "cancelled") {
    return (
      <div className="border border-zinc-200 p-5 text-center text-sm text-zinc-500" style={{ borderRadius: radius }}>
        This booking has been cancelled.
      </div>
    );
  }
  if (!booking.canCancel && !booking.canReschedule) {
    return (
      <div className="border border-zinc-200 p-5 text-center text-sm text-zinc-500" style={{ borderRadius: radius }}>
        This booking can no longer be changed online. Please contact {booking.businessName} directly.
      </div>
    );
  }

  if (confirmingCancel) {
    return (
      <div className="space-y-3 border border-red-200 bg-red-50/60 p-5" style={{ borderRadius: radius }}>
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
        <button type="button" className={cn(primaryBtnClass, "flex-1")} style={primaryBtnStyle} onClick={onStartReschedule}>
          <CalendarClock className="h-4 w-4" />
          Reschedule
        </button>
      )}
      {booking.canCancel && (
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
          style={{ borderRadius: radius }}
          onClick={onAskCancel}
        >
          <XCircle className="h-4 w-4" />
          Cancel booking
        </button>
      )}
    </div>
  );
}

function StatusBadge({ status, primary }: { status: ManagedBooking["status"]; primary: string }) {
  if (status === "confirmed") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
        style={{ color: primary, borderColor: `${primary}55`, background: `${primary}14` }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {STATUS_LABEL[status]}
      </span>
    );
  }
  const styles: Record<ManagedBooking["status"], string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "",
    cancelled: "bg-zinc-100 text-zinc-500 border-zinc-200",
    completed: "bg-sky-50 text-sky-700 border-sky-200",
    no_show: "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
