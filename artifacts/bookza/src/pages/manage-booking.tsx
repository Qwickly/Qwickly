import { useEffect, useState, type CSSProperties } from "react";
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
import { toast } from "sonner";

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
  const [prefersDark, setPrefersDark] = useState(false);

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

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setPrefersDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const cancelMutation = useMutation({
    mutationFn: () => cancelManagedBooking(token),
    onSuccess: async () => {
      setConfirmingCancel(false);
      await queryClient.invalidateQueries({ queryKey });
      toast("Booking cancelled", { description: "Your appointment has been cancelled." });
    },
    onError: (err) =>
      toast.error("Could not cancel", { description: err instanceof Error ? err.message : "Please try again." }),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newStartIso: string) => rescheduleManagedBooking(token, newStartIso),
    onSuccess: async () => {
      setMode("view");
      setSelectedDate(null);
      setSelectedSlot(null);
      await queryClient.invalidateQueries({ queryKey });
      toast("Booking rescheduled", { description: "Your new time is confirmed." });
    },
    onError: (err) =>
      toast.error("Could not reschedule", { description: err instanceof Error ? err.message : "Please try again." }),
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
  const publicIsDark =
    settings?.themeMode === "dark" || (settings?.themeMode === "auto" && prefersDark);
  const pageBgClass = publicIsDark ? "bg-zinc-950 text-zinc-50" : "bg-zinc-50 text-zinc-950";
  const shellClass = publicIsDark
    ? "bg-zinc-950 text-zinc-50 shadow-none"
    : "bg-white text-zinc-900 shadow-sm";
  const panelClass = publicIsDark
    ? "border-zinc-800 bg-zinc-900/80 text-zinc-50"
    : "border-zinc-200 bg-white text-zinc-900";
  const mutedTextClass = publicIsDark ? "text-zinc-400" : "text-zinc-500";
  const headingTextClass = publicIsDark ? "text-zinc-50" : "text-zinc-900";
  const pageWidthClass = settings?.pageWidth === "compact" ? "max-w-[820px]" : "max-w-none";
  const pagePaddingClass =
    settings?.pageWidth === "compact"
      ? "px-3 py-4 sm:px-6 sm:py-8"
      : "px-0 py-0";

  return (
    <div className={cn("min-h-screen", pageBgClass, pagePaddingClass)} style={fontCss ? { fontFamily: fontCss } : undefined}>
      <div className={cn("mx-auto w-full space-y-4", pageWidthClass)}>
        {isLoading ? (
          <div className={cn("flex items-center justify-center gap-2 py-24", mutedTextClass)}>
            <Loader2 className="h-5 w-5 animate-spin" /> Loading your booking…
          </div>
        ) : error || !booking ? (
          <div className={cn("rounded-3xl border p-8 text-center", panelClass)}>
            <h1 className={cn("text-xl font-bold", headingTextClass)}>Booking not found</h1>
            <p className={cn("mt-2 text-sm", mutedTextClass)}>
              This link is invalid or has expired. Please check the link in your confirmation email.
            </p>
          </div>
        ) : (
          <>
            <div className={cn("overflow-hidden rounded-3xl", shellClass)}>
              {settings ? (
                <BookingPageHeader settings={settings} />
              ) : (
                <div className="px-6 py-8 text-center text-white" style={{ background: primary }}>
                  <h1 className="text-2xl font-bold">{booking.businessName}</h1>
                </div>
              )}

              <div className={cn("space-y-4 px-4 pb-8 sm:px-6 md:px-8 md:pb-10", bodyTopPad)}>
                <p className={cn("text-center text-sm", mutedTextClass)}>Manage your booking</p>

                <div className={cn("grid gap-4", mode === "reschedule" && "lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)] lg:items-start")}>
                  {/* Booking summary */}
                  <div className={cn("border p-4 sm:p-5", panelClass)} style={{ borderRadius: radius }}>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <span className={cn("text-xs font-medium uppercase tracking-wide", publicIsDark ? "text-zinc-500" : "text-zinc-400")}>
                        Your appointment
                      </span>
                      <StatusBadge status={booking.status} primary={primary} dark={publicIsDark} />
                    </div>
                    <div className="space-y-3 text-sm">
                      <Row icon={<Scissors className="h-4 w-4" />} label={booking.serviceName} dark={publicIsDark} />
                      <Row
                        icon={<User className="h-4 w-4" />}
                        label={booking.staffName ?? "Any available team member"}
                        dark={publicIsDark}
                      />
                      <Row icon={<CalendarClock className="h-4 w-4" />} label={formatDateTime(booking.startTime)} dark={publicIsDark} />
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
                      dark={publicIsDark}
                      onStartReschedule={() => setMode("reschedule")}
                      onAskCancel={() => setConfirmingCancel(true)}
                      onDismissCancel={() => setConfirmingCancel(false)}
                      onConfirmCancel={() => cancelMutation.mutate()}
                    />
                  )}

                  {mode === "reschedule" && (
                  <div className={cn("min-w-0 border p-4 sm:p-5", panelClass)} style={{ borderRadius: radius }}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h2 className={cn("font-semibold", headingTextClass)}>Pick a new time</h2>
                      <button
                        type="button"
                        className={cn("text-sm transition-colors", publicIsDark ? "text-zinc-400 hover:text-zinc-100" : "text-zinc-500 hover:text-zinc-800")}
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
                      tone={publicIsDark ? "dark" : "light"}
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
                          tone={publicIsDark ? "dark" : "light"}
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
            </div>

            <p className={cn("text-center text-xs", publicIsDark ? "text-zinc-500" : "text-zinc-400")}>Powered by Qwickly</p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, dark }: { icon: React.ReactNode; label: string; dark: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", dark ? "text-zinc-200" : "text-zinc-700")}>
      <span className={dark ? "text-zinc-500" : "text-zinc-400"}>{icon}</span>
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
  dark,
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
  dark: boolean;
  onStartReschedule: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}) {
  if (booking.status === "cancelled") {
    return (
      <div className={cn("border p-5 text-center text-sm", dark ? "border-zinc-800 bg-zinc-900/70 text-zinc-400" : "border-zinc-200 bg-white text-zinc-500")} style={{ borderRadius: radius }}>
        This booking has been cancelled.
      </div>
    );
  }
  if (!booking.canCancel && !booking.canReschedule) {
    return (
      <div className={cn("border p-5 text-center text-sm", dark ? "border-zinc-800 bg-zinc-900/70 text-zinc-400" : "border-zinc-200 bg-white text-zinc-500")} style={{ borderRadius: radius }}>
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
            className={cn(
              "flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium",
              dark ? "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
            )}
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
          className={cn(
            "flex flex-1 items-center justify-center gap-2 border px-4 py-3 text-sm font-semibold transition-colors",
            dark ? "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
          )}
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

function StatusBadge({ status, primary, dark }: { status: ManagedBooking["status"]; primary: string; dark: boolean }) {
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
    pending: dark ? "bg-amber-950/40 text-amber-300 border-amber-900/60" : "bg-amber-50 text-amber-700 border-amber-200",
    confirmed: "",
    cancelled: dark ? "bg-zinc-900 text-zinc-400 border-zinc-700" : "bg-zinc-100 text-zinc-500 border-zinc-200",
    completed: dark ? "bg-sky-950/40 text-sky-300 border-sky-900/60" : "bg-sky-50 text-sky-700 border-sky-200",
    no_show: dark ? "bg-zinc-900 text-zinc-400 border-zinc-700" : "bg-zinc-100 text-zinc-500 border-zinc-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
