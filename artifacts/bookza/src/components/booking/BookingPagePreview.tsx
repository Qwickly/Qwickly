import { useEffect, useRef, useState } from "react";
import type {
  BookingPageSettings,
  BookingSlot,
  PublicService,
  PublicStaff,
} from "@/types/booking-page";
import { cn } from "@/lib/utils";
import { CalendarCheck, CalendarDays, ChevronLeft, Clock, Mail, Phone, User } from "lucide-react";
import { BookingCalendarGrid, toIsoDate } from "@/components/booking/BookingCalendarGrid";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BookingPageHeader,
  LogoBox,
  buttonClasses as themeButtonClasses,
  buttonStyle as themeButtonStyle,
  fontCssFor,
  headerBackground as themeHeaderBackground,
  radiusCssFor,
} from "@/components/booking/booking-theme";

type Props = {
  settings: BookingPageSettings;
  services: PublicService[];
  staff: PublicStaff[];
  openDays?: string[];
  previewMode?: "desktop" | "mobile";
  appTheme?: "light" | "dark";
  showChrome?: boolean;
  slug?: string;
  onSubmitBooking?: (input: {
    serviceId: string;
    staffId: string | null;
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    startTime: string; // ISO string
    notes: string;
  }) => Promise<{ bookingId: string }>;
  onFetchSlots?: (input: {
    serviceId: string;
    staffId: string | null;
    date: string; // YYYY-MM-DD
  }) => Promise<BookingSlot[]>;
};

const DEMO_SERVICES: PublicService[] = [
  { id: "demo-1", name: "Premium Haircut", description: "Classic cut and style", price: 250, duration: 45 },
  { id: "demo-2", name: "Beard Trim", description: "Shape and line up", price: 150, duration: 30 },
  { id: "demo-3", name: "Full Package", description: "Haircut and beard", price: 350, duration: 60 },
];

const bookingInputBase =
  "h-10 w-full border px-3 py-2 text-sm shadow-sm outline-none transition-colors";
const bookingTextareaBase =
  "w-full resize-none border px-3 py-2 text-sm shadow-sm outline-none transition-colors";

export function BookingPagePreview({
  settings,
  services,
  staff,
  openDays,
  previewMode,
  appTheme,
  showChrome = true,
  slug,
  onSubmitBooking,
  onFetchSlots,
}: Props) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [step, setStep] = useState<"selection" | "datetime" | "details">("selection");
  const [helperMessage, setHelperMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [bookingDetails, setBookingDetails] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });
  const [detectedPreviewMode, setDetectedPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingSlot | null>(null);
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [prefersDark, setPrefersDark] = useState(false);
  const servicesRef = useRef<HTMLDivElement | null>(null);
  const staffRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  const pageTopRef = useRef<HTMLDivElement | null>(null);
  const calendarSectionRef = useRef<HTMLDivElement | null>(null);
  const slotsSectionRef = useRef<HTMLDivElement | null>(null);
  const detailsSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (previewMode !== undefined) {
      return;
    }

    const updateMode = () => {
      setDetectedPreviewMode(window.innerWidth <= 640 ? "mobile" : "desktop");
    };

    updateMode();
    window.addEventListener("resize", updateMode);
    return () => window.removeEventListener("resize", updateMode);
  }, [previewMode]);

  useEffect(() => {
    if (settings.themeMode !== "auto" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setPrefersDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [settings.themeMode]);

  const effectivePreviewMode = previewMode ?? detectedPreviewMode;
  const isMobileView = effectivePreviewMode === "mobile";
  const isPublicPage = !showChrome;
  const publicIsDark =
    settings.themeMode === "dark" ||
    (settings.themeMode === "auto" && (isPublicPage ? prefersDark : appTheme === "dark"));
  const publicMaxWidthClass =
    settings.pageWidth === "compact"
        ? "max-w-[820px]"
        : "max-w-none";
  const publicOuterPaddingClass =
    settings.pageWidth === "compact" ? "px-4 pb-6" : "px-0 pb-0";
  const effectiveLayout = settings.layout === "split" ? "classic" : settings.layout;
  const fontCss = fontCssFor(settings);
  const radiusCss = radiusCssFor(settings);
  const displayServices = services.length > 0 ? services : DEMO_SERVICES;
  const requiresStaffSelection = settings.showStaffSelection && staff.length > 0;
  const selectedServiceData = displayServices.find((service) => service.id === selectedService) ?? null;
  const selectedStaffData = staff.find((member) => member.id === selectedStaff) ?? null;
  const selectedStaffWorkingDays = selectedStaffData?.workingDays ?? null;

  const weekdayName = (isoDate: string): string | null => {
    if (!isoDate) return null;
    const d = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return names[d.getDay()] ?? null;
  };

  const isDateAllowedForStaff = (isoDate: string): boolean => {
    if (!requiresStaffSelection) return true;
    if (!selectedStaffWorkingDays || selectedStaffWorkingDays.length === 0) return true;
    const day = weekdayName(isoDate);
    if (!day) return true;
    return selectedStaffWorkingDays.includes(day);
  };

  const isPastDate = (isoDate: string): boolean => isoDate < toIsoDate(new Date());

  const isOpenDay = (isoDate: string): boolean => {
    if (!openDays || openDays.length === 0) return true;
    const day = weekdayName(isoDate);
    return day ? openDays.includes(day) : true;
  };

  const isDateSelectable = (isoDate: string): boolean =>
    !isPastDate(isoDate) && isOpenDay(isoDate) && isDateAllowedForStaff(isoDate);

  useEffect(() => {
    setHelperMessage(null);
    setSubmitError(null);
  }, [selectedService, selectedStaff]);

  useEffect(() => {
    // If the user already picked a date, but then changes staff, keep them on valid days only.
    if (!selectedDate) return;
    if (!isDateAllowedForStaff(selectedDate)) {
      setSelectedDate(null);
      setSelectedSlot(null);
      setSubmitError("This staff member doesn’t work on that day. Please choose another date.");
    }
  }, [selectedDate, selectedStaff, selectedStaffWorkingDays, requiresStaffSelection]);

  useEffect(() => {
    if (!selectedDate || !selectedService || !onFetchSlots) {
      setSlots([]);
      return;
    }
    if (requiresStaffSelection && !selectedStaff) {
      setSlots([]);
      return;
    }

    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);

    onFetchSlots({
      serviceId: selectedService,
      staffId: requiresStaffSelection ? selectedStaff : null,
      date: selectedDate,
    })
      .then((result) => {
        if (!cancelled) setSlots(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setSlotsError(err instanceof Error ? err.message : "Could not load available times.");
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedService, selectedStaff, requiresStaffSelection, onFetchSlots]);

  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    const target =
      step === "datetime"
        ? calendarSectionRef.current
        : step === "details"
          ? detailsSectionRef.current
          : flowRef.current ?? pageTopRef.current;

    window.requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [step]);

  useEffect(() => {
    if (!selectedDate || step !== "datetime") return;

    window.requestAnimationFrame(() => {
      slotsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [selectedDate, step]);

  // Thin wrappers over the shared theme helpers so existing call sites
  // (buttonClasses() / buttonStyle() / headerBackground()) stay unchanged.
  const headerBackground = () => themeHeaderBackground(settings);
  const buttonClasses = () => themeButtonClasses(settings);
  const buttonStyle = () => themeButtonStyle(settings, radiusCss);
  const bookingInputClass = cn(
    bookingInputBase,
    publicIsDark
      ? "border-zinc-700 bg-zinc-950 text-zinc-50 placeholder:text-zinc-500 focus:border-zinc-400"
      : "border-zinc-300 bg-white text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-500",
  );
  const bookingTextareaClass = cn(
    bookingTextareaBase,
    publicIsDark
      ? "border-zinc-700 bg-zinc-950 text-zinc-50 placeholder:text-zinc-500 focus:border-zinc-400"
      : "border-zinc-300 bg-white text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-500",
  );
  const bookingPanelClass = publicIsDark
    ? "border border-zinc-800 bg-zinc-900 text-zinc-50"
    : "border border-zinc-200 bg-white text-zinc-950";
  const pageTextClass = publicIsDark ? "text-zinc-50" : "text-zinc-900";
  const pageBgClass = publicIsDark ? "bg-zinc-950" : "bg-white";
  const softPanelClass = publicIsDark
    ? "border-l-2 border-zinc-700 bg-transparent pl-4 text-zinc-300"
    : "border-l-2 border-zinc-300 bg-transparent pl-4 text-zinc-600";
  const welcomeMessageClass = cn(
    "text-sm leading-6",
    softPanelClass,
  );

  const serviceCardClass = (selected: boolean) => {
    const base = cn(
      "cursor-pointer transition-all border",
      publicIsDark
        ? "border-zinc-800 bg-zinc-900 text-zinc-50"
        : "border-zinc-200 bg-white text-zinc-950",
    );
    if (effectiveLayout === "cards") return cn(base, "p-5 shadow-md", selected && "ring-2");
    if (effectiveLayout === "minimal") {
      return cn(base, "p-4 border-x-0 border-t-0 border-b rounded-none last:border-b", selected && "bg-black/5");
    }
    return cn(base, "p-4", selected && "ring-2");
  };

  const handleContinueFromSelection = () => {
    if (services.length === 0) {
      setHelperMessage("No services are available to book yet.");
      servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!selectedService) {
      setHelperMessage("Select a service to continue.");
      servicesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (requiresStaffSelection && !selectedStaff) {
      setHelperMessage("Choose a staff member to continue.");
      staffRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setHelperMessage(null);
    setStep("datetime");
  };

  const handleContinueFromDatetime = () => {
    if (!selectedDate || !selectedSlot) {
      setSubmitError("Please choose a date and time.");
      return;
    }
    setSubmitError(null);
    setStep("details");
  };

  const goBack = () => {
    setSubmitError(null);
    if (step === "details") {
      setStep("datetime");
    } else if (step === "datetime") {
      setStep("selection");
    }
  };

  const updateBookingDetails = (key: keyof typeof bookingDetails, value: string) => {
    setBookingDetails((current) => ({ ...current, [key]: value }));
  };

  const handleSelectDate = (iso: string) => {
    setSelectedDate(iso);
    setSelectedSlot(null);
    setSubmitError(null);
  };

  const canSubmit = Boolean(onSubmitBooking);

  const handleSubmitBooking = async () => {
    if (!onSubmitBooking) return;
    setSubmitError(null);

    if (services.length === 0) {
      setSubmitError("No services are available to book yet.");
      return;
    }

    const name = bookingDetails.name.trim();
    const phone = bookingDetails.phone.trim();
    const email = bookingDetails.email.trim();
    if (!name) {
      setSubmitError("Please enter your name.");
      return;
    }
    if (!phone) {
      setSubmitError("Please enter a phone number.");
      return;
    }
    // Required so the confirmation email has somewhere to go. Light format check
    // only — we deliberately don't verify the address before submit (that would
    // add a round-trip and kill conversion); the confirmation email itself is the
    // proof of a valid address.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSubmitError("Please enter a valid email address for your confirmation.");
      return;
    }
    if (!selectedDate || !selectedSlot) {
      setSubmitError("Please choose a date and time.");
      return;
    }
    if (!selectedService) {
      setSubmitError("Please select a service.");
      return;
    }
    if (requiresStaffSelection && !selectedStaff) {
      setSubmitError("Please choose a staff member.");
      return;
    }

    const local = new Date(`${selectedDate}T${selectedSlot.startTime}:00`);
    if (Number.isNaN(local.getTime())) {
      setSubmitError("Please choose a valid date and time.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await onSubmitBooking({
        serviceId: selectedService,
        staffId: requiresStaffSelection ? selectedStaff : null,
        clientName: name,
        clientPhone: phone,
        clientEmail: email,
        startTime: local.toISOString(),
        notes: settings.showNotes ? bookingDetails.notes.trim() : "",
      });
      setBookingId(res.bookingId);
      setSuccessDialogOpen(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatRecapDateTime = (): string => {
    if (!selectedDate || !selectedSlot) return "Not selected";
    const d = new Date(`${selectedDate}T00:00:00`);
    const dateLabel = d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
    return `${dateLabel} at ${selectedSlot.startTime}`;
  };

  const servicesSection = (
    <div ref={servicesRef}>
      <h3 className={cn("font-semibold text-lg border-b pb-2 mb-4", publicIsDark ? "border-zinc-800" : "border-zinc-200")}>Select a service</h3>
      <div
        className={cn(
          effectiveLayout === "cards"
            ? "grid grid-cols-1 gap-4"
            : effectiveLayout === "minimal"
              ? cn(
                  "divide-y border rounded-lg overflow-hidden",
                  publicIsDark ? "divide-zinc-800 border-zinc-800" : "divide-zinc-200 border-zinc-200",
                )
              : "grid grid-cols-1 sm:grid-cols-2 gap-3",
        )}
        style={effectiveLayout === "minimal" ? { borderRadius: radiusCss } : undefined}
      >
        {displayServices.map((service) => {
          const selected = selectedService === service.id;
          return (
            <div
              key={service.id}
              role="button"
              tabIndex={0}
              className={serviceCardClass(selected)}
              style={{
                borderRadius: effectiveLayout === "minimal" ? undefined : radiusCss,
                borderColor: selected ? settings.primaryColor : undefined,
                ...(selected ? { "--tw-ring-color": settings.primaryColor } : {}),
              }}
              onClick={() => setSelectedService(service.id)}
              onKeyDown={(e) => e.key === "Enter" && setSelectedService(service.id)}
            >
              <div className="flex justify-between items-start gap-2">
                <span className="font-medium">{service.name}</span>
                {settings.showPrices && (
                  <span className="font-bold shrink-0" style={{ color: settings.primaryColor }}>
                    R {service.price.toLocaleString()}
                  </span>
                )}
              </div>
              {service.description && (
                <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{service.description}</p>
              )}
              {settings.showDuration && (
                <span className="text-xs text-zinc-500 mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {service.duration} mins
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const staffSection =
    settings.showStaffSelection && staff.length > 0 ? (
      <div ref={staffRef}>
        <h3 className={cn("font-semibold text-lg border-b pb-2 mb-4", publicIsDark ? "border-zinc-800" : "border-zinc-200")}>Choose staff</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {staff.map((member) => {
            const selected = selectedStaff === member.id;
            return (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                className={cn(
                  "border p-3 cursor-pointer flex items-center gap-3 transition-all",
                  publicIsDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-white",
                  selected && "ring-2",
                )}
                style={{
                  borderRadius: radiusCss,
                  borderColor: selected ? settings.primaryColor : undefined,
                  ...(selected ? { "--tw-ring-color": settings.primaryColor } : {}),
                }}
                onClick={() => setSelectedStaff(member.id)}
                onKeyDown={(e) => e.key === "Enter" && setSelectedStaff(member.id)}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: settings.primaryColor }}
                >
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{member.name}</p>
                  {member.position && <p className="text-xs text-zinc-500">{member.position}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const selectionStep = (
    <div className="space-y-6">
      {servicesSection}
      {staffSection}
      <div className={isMobileView ? "space-y-3" : ""}>
        <button type="button" className={buttonClasses()} style={buttonStyle()} onClick={handleContinueFromSelection}>
          Continue
        </button>
        {helperMessage && <p className="text-xs text-center mt-2" style={{ color: settings.primaryColor }}>{helperMessage}</p>}
        {settings.requireDeposit && (
          <p className="text-xs text-zinc-500 text-center mt-2">Deposit required to confirm</p>
        )}
      </div>
    </div>
  );

  const canContinueFromDatetime = Boolean(selectedDate && selectedSlot);

  const datetimeStep = (
    <div className="space-y-6">
      <div ref={calendarSectionRef} className="scroll-mt-4 space-y-3">
        <span className="text-sm font-medium inline-flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-zinc-500" />
          Choose a date
        </span>
          <BookingCalendarGrid
          month={calendarMonth}
          onMonthChange={setCalendarMonth}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
          isDateSelectable={isDateSelectable}
          primaryColor={settings.primaryColor}
          radiusCss={radiusCss}
          tone={publicIsDark ? "dark" : "light"}
        />
      </div>

      {selectedDate && (
        <div ref={slotsSectionRef} className="scroll-mt-4 space-y-3">
          <span className="text-sm font-medium block">Choose a time</span>
          <BookingSlotPicker
            slots={slots}
            selectedSlot={selectedSlot}
            onSelect={setSelectedSlot}
            loading={slotsLoading}
            error={slotsError}
            primaryColor={settings.primaryColor}
            radiusCss={radiusCss}
            tone={publicIsDark ? "dark" : "light"}
          />
        </div>
      )}

      {submitError && <p className="text-sm text-red-600">{submitError}</p>}

      <button
        type="button"
        className={cn(buttonClasses(), "w-full", !canContinueFromDatetime && "opacity-50 cursor-not-allowed hover:opacity-50")}
        style={buttonStyle()}
        onClick={handleContinueFromDatetime}
        disabled={!canContinueFromDatetime}
      >
        Continue
      </button>
    </div>
  );

  const detailsStep = (
    <div ref={detailsSectionRef} className="scroll-mt-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={cn(bookingPanelClass, "p-4 space-y-1")} style={{ borderRadius: radiusCss }}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Service</p>
          <p className="font-semibold">{selectedServiceData?.name ?? "Not selected"}</p>
          <p className="text-sm text-zinc-500 mt-2">
            {selectedServiceData ? `${selectedServiceData.duration} mins` : ""}
            {selectedServiceData && settings.showPrices ? ` • R ${selectedServiceData.price.toLocaleString()}` : ""}
          </p>
        </div>

        <div className={cn(bookingPanelClass, "p-4 space-y-1")} style={{ borderRadius: radiusCss }}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Staff</p>
          <p className="font-semibold">
            {requiresStaffSelection ? selectedStaffData?.name ?? "Not selected" : "Any available staff member"}
          </p>
          <p className="text-sm text-zinc-500">
            {requiresStaffSelection ? selectedStaffData?.position ?? "" : "We’ll match you with the next available team member."}
          </p>
        </div>

        <div className={cn(bookingPanelClass, "p-4 space-y-1")} style={{ borderRadius: radiusCss }}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Date &amp; time</p>
          <p className="font-semibold">{formatRecapDateTime()}</p>
        </div>
      </div>

      {bookingId ? (
        <div className={cn(bookingPanelClass, "p-5")} style={{ borderRadius: radiusCss }}>
          <h4 className="font-semibold text-lg">Booking request sent</h4>
          <p className="text-sm text-zinc-600 mt-2">
            Your booking has been captured. Reference:{" "}
            <span className="font-mono text-xs bg-zinc-100 px-2 py-1 rounded">{bookingId}</span>
          </p>
          <p className="text-sm text-zinc-500 mt-3">
            The business will confirm your appointment shortly. A booking request email has
            been sent to{" "}
            <span className={cn("font-medium", publicIsDark ? "text-zinc-200" : "text-zinc-700")}>{bookingDetails.email}</span>.
          </p>
          <button
            type="button"
            className="mt-5 w-full py-3 font-semibold text-white transition-opacity hover:opacity-90 sm:w-auto sm:px-6"
            style={buttonStyle()}
            onClick={() => window.close()}
          >
            Close tab
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <User className="w-4 h-4 text-zinc-500" />
                Your name
              </span>
              <input
                type="text"
                value={bookingDetails.name}
                onChange={(e) => updateBookingDetails("name", e.target.value)}
                placeholder="Jane Doe"
                className={bookingInputClass}
                style={{ borderRadius: radiusCss }}
              />
            </label>

            <label className="space-y-2 text-sm font-medium">
              <span className="inline-flex items-center gap-2">
                <Phone className="w-4 h-4 text-zinc-500" />
                Phone number
              </span>
              <input
                type="tel"
                value={bookingDetails.phone}
                onChange={(e) => updateBookingDetails("phone", e.target.value)}
                placeholder="071 234 5678"
                className={bookingInputClass}
                style={{ borderRadius: radiusCss }}
              />
            </label>
          </div>

          <label className="space-y-2 text-sm font-medium block">
            <span className="inline-flex items-center gap-2">
              <Mail className="w-4 h-4 text-zinc-500" />
              Email address
            </span>
            <input
              type="email"
              value={bookingDetails.email}
              onChange={(e) => updateBookingDetails("email", e.target.value)}
              placeholder="jane@email.com"
              className={bookingInputClass}
              style={{ borderRadius: radiusCss }}
            />
            <span className="block text-xs font-normal text-zinc-500">
              We’ll send your booking confirmation here.
            </span>
          </label>

          {settings.showNotes && (
            <label className="space-y-2 text-sm font-medium block">
              <span>Notes</span>
              <textarea
                rows={3}
                value={bookingDetails.notes}
                onChange={(e) => updateBookingDetails("notes", e.target.value)}
                placeholder="Share anything the team should know before confirming your booking."
                className={bookingTextareaClass}
                style={{ borderRadius: radiusCss }}
              />
            </label>
          )}

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          {canSubmit ? (
            <button
              type="button"
              className={buttonClasses()}
              style={buttonStyle()}
              onClick={() => void handleSubmitBooking()}
              disabled={submitting}
            >
              {submitting ? "Booking…" : "Make booking"}
            </button>
          ) : (
            <p className="text-xs text-zinc-500">
              Booking submission is disabled in preview mode.
            </p>
          )}
        </>
      )}
    </div>
  );

  const flowHeader = (
    <div className={cn("flex items-center gap-3 mb-6", isMobileView && "justify-center")}>
      {step !== "selection" ? (
        <button
          type="button"
          onClick={goBack}
          aria-label="Go back"
          className={cn(
            "p-1.5 rounded-full border shrink-0 transition-colors",
            publicIsDark
              ? "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"
              : "border-zinc-300 bg-white hover:bg-zinc-50",
          )}
          style={{ color: settings.primaryColor }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      ) : !isMobileView ? (
        <div className="w-8 shrink-0" />
      ) : null}
      <BookingProgressBar
        step={step}
        primaryColor={settings.primaryColor}
        showLabels={!isMobileView}
        compact={isMobileView}
        style={settings.progressStyle ?? "line"}
        tone={publicIsDark ? "dark" : "light"}
      />
    </div>
  );

  const bookingFlow = (
    <div ref={flowRef}>
      {flowHeader}
      {step === "selection" && selectionStep}
      {step === "datetime" && datetimeStep}
      {step === "details" && detailsStep}
    </div>
  );

  const headerBanner = <BookingPageHeader settings={settings} />;

  const content = (
    <div
      ref={pageTopRef}
      className={cn(
        "flex flex-col min-h-full",
        pageBgClass,
        pageTextClass,
        isMobileView && !isPublicPage ? "rounded-3xl overflow-hidden shadow-sm" : "overflow-hidden",
        !isMobileView && !isPublicPage && "rounded-3xl",
      )}
      style={{ fontFamily: fontCss }}
    >
      {effectiveLayout !== "minimal" && headerBanner}
      <div
        className={cn(
          "px-4 md:px-8 pb-10",
          settings.headerStyle === "banner" && effectiveLayout !== "minimal" ? "pt-12" : "pt-8",
        )}
      >
        {effectiveLayout === "minimal" && (
          <div className="mb-8">
            <LogoBox settings={settings} size="sm" className="mb-4" />
            <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
            <p className="text-zinc-500 mt-2 text-sm">{settings.description}</p>
          </div>
        )}
        {settings.headerStyle === "banner" && effectiveLayout !== "minimal" && (
          <div className="mb-8">
            <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
            <p className="text-zinc-500 mt-2 text-sm">{settings.description}</p>
          </div>
        )}
        {settings.welcomeMessage && (
          <p className={cn(welcomeMessageClass, "mb-6")}>
            {settings.welcomeMessage}
          </p>
        )}
        {bookingFlow}
      </div>
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent
          className={cn(
            "w-[92vw] max-w-md rounded-2xl border-0 p-0 overflow-hidden shadow-2xl",
            publicIsDark ? "bg-zinc-950 text-zinc-50" : "bg-white text-zinc-950",
          )}
        >
          <div className="px-6 pt-8 pb-6 text-center">
            <div
              className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg"
              style={{ backgroundColor: settings.primaryColor }}
            >
              <CalendarCheck className="h-8 w-8" />
            </div>
            <DialogHeader className="text-center sm:text-center">
              <DialogTitle className={cn("text-2xl font-bold", publicIsDark ? "text-zinc-50" : "text-zinc-950")}>Booking request sent</DialogTitle>
              <DialogDescription className={cn("text-sm leading-6", publicIsDark ? "text-zinc-400" : "text-zinc-600")}>
                Your appointment request has been sent successfully.
              </DialogDescription>
            </DialogHeader>

            <div
              className={cn(
                "mt-5 rounded-xl border p-4 text-left text-sm",
                publicIsDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-50",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <span className={publicIsDark ? "text-zinc-400" : "text-zinc-500"}>When</span>
                <span className={cn("text-right font-semibold", publicIsDark ? "text-zinc-50" : "text-zinc-900")}>{formatRecapDateTime()}</span>
              </div>
              <div className="mt-3 flex items-start justify-between gap-4">
                <span className={publicIsDark ? "text-zinc-400" : "text-zinc-500"}>Service</span>
                <span className={cn("text-right font-semibold", publicIsDark ? "text-zinc-50" : "text-zinc-900")}>
                  {selectedServiceData?.name ?? "Selected service"}
                </span>
              </div>
            </div>

            <p className={cn("mt-4 text-sm", publicIsDark ? "text-zinc-400" : "text-zinc-500")}>
              A booking request email has been sent to{" "}
              <span className={cn("font-medium", publicIsDark ? "text-zinc-200" : "text-zinc-700")}>{bookingDetails.email}</span>.
            </p>
            <button
              type="button"
              className="mt-6 w-full py-3 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ ...buttonStyle(), borderRadius: radiusCss }}
              onClick={() => setSuccessDialogOpen(false)}
            >
              Done
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  if (!showChrome) {
    return (
      <div
        className={cn(
          "min-h-screen",
          isMobileView
            ? cn("w-full", publicIsDark ? "bg-zinc-950" : "bg-white")
            : cn("w-full", publicOuterPaddingClass, publicIsDark ? "bg-zinc-950" : "bg-zinc-50"),
        )}
      >
        <div className={cn("mx-auto w-full", isMobileView ? "max-w-none" : publicMaxWidthClass)}>{content}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex-1 bg-white dark:bg-zinc-950 rounded-lg shadow-sm border overflow-hidden flex flex-col relative mx-auto w-full transition-all",
        isMobileView ? "max-w-[420px]" : "max-w-4xl",
      )}
    >
      <div className="h-10 bg-zinc-100 dark:bg-zinc-900 border-b flex items-center px-4 shrink-0">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400" />
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <div className="w-3 h-3 rounded-full bg-emerald-400" />
        </div>
        <div className="mx-auto bg-white dark:bg-zinc-800 text-xs px-3 py-1 rounded border shadow-sm font-mono text-zinc-500 truncate max-w-[60%]">
          bookza.com/{slug ?? settings.slug}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">{content}</div>
    </div>
  );
}

const BOOKING_STEPS: { key: "selection" | "datetime" | "details"; label: string }[] = [
  { key: "selection", label: "Service" },
  { key: "datetime", label: "Date & time" },
  { key: "details", label: "Your details" },
];

function BookingProgressBar({
  step,
  primaryColor,
  showLabels,
  style,
  tone,
  compact = false,
}: {
  step: "selection" | "datetime" | "details";
  primaryColor: string;
  showLabels: boolean;
  style: "line" | "tiles" | "minimal";
  tone: "light" | "dark";
  compact?: boolean;
}) {
  const currentIndex = BOOKING_STEPS.findIndex((s) => s.key === step);
  const inactiveText = tone === "dark" ? "#a1a1aa" : "#71717a";
  const inactiveBorder = tone === "dark" ? "#3f3f46" : "#d4d4d8";
  const inactiveLine = tone === "dark" ? "#3f3f46" : "#e4e4e7";

  if (style === "tiles") {
    return (
      <div className={cn("grid w-full gap-2", compact ? "grid-cols-3" : "grid-cols-3")}>
        {BOOKING_STEPS.map((s, idx) => {
          const isActive = idx <= currentIndex;
          return (
            <div
              key={s.key}
              className={cn(
                "min-w-0 border px-2 py-2 text-center transition-colors",
                compact ? "rounded-lg" : "rounded-xl",
              )}
              style={{
                borderColor: isActive ? primaryColor : inactiveBorder,
                backgroundColor: isActive ? `${primaryColor}18` : "transparent",
                color: isActive ? primaryColor : inactiveText,
              }}
            >
              <span className="block text-xs font-semibold">{idx + 1}</span>
              {showLabels ? <span className="mt-0.5 block truncate text-xs font-medium">{s.label}</span> : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (style === "minimal") {
    return (
      <div className={cn("flex items-center justify-center gap-2", compact ? "w-full flex-none" : "flex-1")}>
        {BOOKING_STEPS.map((s, idx) => {
          const isActive = idx <= currentIndex;
          return (
            <span
              key={s.key}
              aria-label={s.label}
              className="h-2.5 rounded-full transition-all"
              style={{
                width: idx === currentIndex ? "2rem" : "0.625rem",
                backgroundColor: isActive ? primaryColor : inactiveLine,
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center", compact ? "w-full max-w-[220px] flex-none" : "flex-1")}>
      {BOOKING_STEPS.map((s, idx) => {
        const isActive = idx <= currentIndex;
        return (
          <div key={s.key} className={cn("flex items-center", idx < BOOKING_STEPS.length - 1 && "flex-1")}>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border transition-colors"
                style={{
                  backgroundColor: isActive ? primaryColor : "transparent",
                  borderColor: isActive ? primaryColor : inactiveBorder,
                  color: isActive ? "white" : inactiveText,
                }}
              >
                {idx + 1}
              </div>
              {showLabels ? (
                <span
                  className="text-xs font-medium hidden sm:inline"
                style={{ color: isActive ? primaryColor : "#a1a1aa" }}
                >
                  {s.label}
                </span>
              ) : null}
            </div>
            {idx < BOOKING_STEPS.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-2"
                style={{ backgroundColor: idx < currentIndex ? primaryColor : inactiveLine }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

