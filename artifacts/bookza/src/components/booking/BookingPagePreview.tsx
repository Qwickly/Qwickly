import { useEffect, useRef, useState } from "react";
import type {
  BookingPageSettings,
  PublicService,
  PublicStaff,
} from "@/types/booking-page";
import { bookingPageLogoUrl, FONT_OPTIONS, RADIUS_OPTIONS } from "@/types/booking-page";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronLeft, Clock, Phone, User } from "lucide-react";

type Props = {
  settings: BookingPageSettings;
  services: PublicService[];
  staff: PublicStaff[];
  previewMode?: "desktop" | "mobile";
  showChrome?: boolean;
  slug?: string;
  onSubmitBooking?: (input: {
    serviceId: string;
    staffId: string | null;
    clientName: string;
    clientPhone: string;
    startTime: string; // ISO string
    notes: string;
  }) => Promise<{ bookingId: string }>;
};

const DEMO_SERVICES: PublicService[] = [
  { id: "demo-1", name: "Premium Haircut", description: "Classic cut and style", price: 250, duration: 45 },
  { id: "demo-2", name: "Beard Trim", description: "Shape and line up", price: 150, duration: 30 },
  { id: "demo-3", name: "Full Package", description: "Haircut and beard", price: 350, duration: 60 },
];

export function BookingPagePreview({
  settings,
  services,
  staff,
  previewMode = "desktop",
  showChrome = true,
  slug,
  onSubmitBooking,
}: Props) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [step, setStep] = useState<"selection" | "details">("selection");
  const [helperMessage, setHelperMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingDetails, setBookingDetails] = useState({
    name: "",
    phone: "",
    date: "",
    time: "",
    notes: "",
  });
  const servicesRef = useRef<HTMLDivElement | null>(null);
  const staffRef = useRef<HTMLDivElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);

  const fontCss = FONT_OPTIONS.find((f) => f.value === settings.fontFamily)?.css;
  const radiusCss = RADIUS_OPTIONS.find((r) => r.value === settings.borderRadius)?.css ?? "0.5rem";
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

  useEffect(() => {
    setHelperMessage(null);
    setSubmitError(null);
  }, [selectedService, selectedStaff]);

  useEffect(() => {
    // If the user already picked a date, but then changes staff, keep them on valid days only.
    if (!bookingDetails.date) return;
    if (!isDateAllowedForStaff(bookingDetails.date)) {
      setBookingDetails((current) => ({ ...current, date: "" }));
      setSubmitError("This staff member doesn’t work on that day. Please choose another date.");
    }
  }, [bookingDetails.date, selectedStaff, selectedStaffWorkingDays, requiresStaffSelection]);

  useEffect(() => {
    if (step === "details") {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [step]);

  const headerBackground = (): React.CSSProperties => {
    if (settings.backgroundStyle === "image" && settings.coverImageUrl) {
      return {
        backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0.55)), url(${settings.coverImageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    if (settings.backgroundStyle === "solid") {
      return { backgroundColor: settings.primaryColor };
    }
    return {
      background: `linear-gradient(135deg, ${settings.primaryColor}, ${settings.secondaryColor})`,
    };
  };

  const buttonClasses = () => {
    const base = "w-full py-3 font-semibold transition-opacity hover:opacity-90";
    if (settings.buttonStyle === "outline") return cn(base, "border-2 bg-transparent");
    if (settings.buttonStyle === "soft") return cn(base, "border-0");
    return cn(base, "border-0 text-white");
  };

  const buttonStyle = (): React.CSSProperties => {
    if (settings.buttonStyle === "outline") {
      return { borderColor: settings.primaryColor, color: settings.primaryColor, borderRadius: radiusCss };
    }
    if (settings.buttonStyle === "soft") {
      return { backgroundColor: `${settings.primaryColor}22`, color: settings.primaryColor, borderRadius: radiusCss };
    }
    return { backgroundColor: settings.primaryColor, borderRadius: radiusCss };
  };

  const serviceCardClass = (selected: boolean) => {
    const base = "cursor-pointer transition-all border";
    if (settings.layout === "cards") return cn(base, "p-5 shadow-md", selected && "ring-2");
    if (settings.layout === "minimal") {
      return cn(base, "p-4 border-x-0 border-t-0 border-b rounded-none last:border-b", selected && "bg-black/5");
    }
    return cn(base, "p-4", selected && "ring-2");
  };

  const handleContinue = () => {
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
    setStep("details");
  };

  const updateBookingDetails = (key: keyof typeof bookingDetails, value: string) => {
    setBookingDetails((current) => ({ ...current, [key]: value }));
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
    if (!name) {
      setSubmitError("Please enter your name.");
      return;
    }
    if (!phone) {
      setSubmitError("Please enter a phone number.");
      return;
    }
    if (!bookingDetails.date || !bookingDetails.time) {
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

    const local = new Date(`${bookingDetails.date}T${bookingDetails.time}:00`);
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
        startTime: local.toISOString(),
        notes: bookingDetails.notes.trim(),
      });
      setBookingId(res.bookingId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const bookButton = step === "selection" ? (
    <>
      <button type="button" className={buttonClasses()} style={buttonStyle()} onClick={handleContinue}>
        Continue to booking
      </button>
      {helperMessage && <p className="text-xs text-center mt-2" style={{ color: settings.primaryColor }}>{helperMessage}</p>}
      {settings.requireDeposit && (
        <p className="text-xs text-zinc-500 text-center mt-2">Deposit required to confirm</p>
      )}
    </>
  ) : null;

  const servicesSection = (
    <div ref={servicesRef}>
      <h3 className="font-semibold text-lg border-b pb-2 mb-4">Select a service</h3>
      <div
        className={cn(
          settings.layout === "cards"
            ? "grid grid-cols-1 gap-4"
            : settings.layout === "minimal"
              ? "divide-y border rounded-lg overflow-hidden"
              : "grid grid-cols-1 sm:grid-cols-2 gap-3",
        )}
        style={settings.layout === "minimal" ? { borderRadius: radiusCss } : undefined}
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
                borderRadius: settings.layout === "minimal" ? undefined : radiusCss,
                borderColor: selected ? settings.primaryColor : undefined,
                ...(selected ? { ringColor: settings.primaryColor } : {}),
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
        <h3 className="font-semibold text-lg border-b pb-2 mb-4">Choose staff</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {staff.map((member) => {
            const selected = selectedStaff === member.id;
            return (
              <div
                key={member.id}
                role="button"
                tabIndex={0}
                className={cn("border p-3 cursor-pointer flex items-center gap-3 transition-all", selected && "ring-2")}
                style={{
                  borderRadius: radiusCss,
                  borderColor: selected ? settings.primaryColor : undefined,
                  ...(selected ? { ringColor: settings.primaryColor } : {}),
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

  const detailsSection =
    step === "details" ? (
      <div ref={detailsRef} className="space-y-4 border p-5 bg-zinc-50/80" style={{ borderRadius: radiusCss }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-lg">Booking details</h3>
            <p className="text-sm text-zinc-500 mt-1">You&apos;re on the next step. Add contact details and a preferred slot.</p>
          </div>
          <button
            type="button"
            onClick={() => setStep("selection")}
            className="inline-flex items-center gap-2 text-sm font-medium"
            style={{ color: settings.primaryColor }}
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="border bg-white p-4 space-y-1" style={{ borderRadius: radiusCss }}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Service</p>
            <p className="font-semibold">{selectedServiceData?.name ?? "Not selected"}</p>
            {selectedServiceData?.description && (
              <p className="text-sm text-zinc-500">{selectedServiceData.description}</p>
            )}
            <p className="text-sm text-zinc-500 mt-2">
              {selectedServiceData ? `${selectedServiceData.duration} mins` : ""}
              {selectedServiceData && settings.showPrices ? ` • R ${selectedServiceData.price.toLocaleString()}` : ""}
            </p>
          </div>

          <div className="border bg-white p-4 space-y-1" style={{ borderRadius: radiusCss }}>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Staff</p>
            <p className="font-semibold">
              {requiresStaffSelection ? selectedStaffData?.name ?? "Not selected" : "Any available staff member"}
            </p>
            <p className="text-sm text-zinc-500">
              {requiresStaffSelection ? selectedStaffData?.position ?? "Choose who you’d like to book with." : "We’ll match you with the next available team member."}
            </p>
          </div>
        </div>

        {bookingId ? (
          <div className="border bg-white p-5" style={{ borderRadius: radiusCss }}>
            <h4 className="font-semibold text-lg">Booking request sent</h4>
            <p className="text-sm text-zinc-600 mt-2">
              Your booking has been captured. Reference:{" "}
              <span className="font-mono text-xs bg-zinc-100 px-2 py-1 rounded">{bookingId}</span>
            </p>
            <p className="text-sm text-zinc-500 mt-3">
              The business will confirm your appointment shortly.
            </p>
          </div>
        ) : (
          <>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-2 text-sm font-medium">
            <span>Your name</span>
            <input
              type="text"
              value={bookingDetails.name}
              onChange={(e) => updateBookingDetails("name", e.target.value)}
              placeholder="Jane Doe"
              className="w-full border bg-white px-3 py-2 text-sm outline-none focus:ring-2"
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
              className="w-full border bg-white px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderRadius: radiusCss }}
            />
          </label>

          <label className="space-y-2 text-sm font-medium">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-zinc-500" />
              Preferred date
            </span>
            <input
              type="date"
              value={bookingDetails.date}
              onChange={(e) => {
                const next = e.target.value;
                if (!next) {
                  setSubmitError(null);
                  updateBookingDetails("date", "");
                  return;
                }
                if (!isDateAllowedForStaff(next)) {
                  setSubmitError("This staff member doesn’t work on that day. Please choose another date.");
                  updateBookingDetails("date", "");
                  return;
                }
                setSubmitError(null);
                updateBookingDetails("date", next);
              }}
              className="w-full border bg-white px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderRadius: radiusCss }}
            />
          </label>

          <label className="space-y-2 text-sm font-medium">
            <span>Preferred time</span>
            <input
              type="time"
              value={bookingDetails.time}
              onChange={(e) => updateBookingDetails("time", e.target.value)}
              className="w-full border bg-white px-3 py-2 text-sm outline-none focus:ring-2"
              style={{ borderRadius: radiusCss }}
            />
          </label>
        </div>

        <label className="space-y-2 text-sm font-medium block">
          <span>Notes</span>
          <textarea
            rows={3}
            value={bookingDetails.notes}
            onChange={(e) => updateBookingDetails("notes", e.target.value)}
            placeholder="Share anything the team should know before confirming your booking."
            className="w-full border bg-white px-3 py-2 text-sm outline-none focus:ring-2 resize-none"
            style={{ borderRadius: radiusCss }}
          />
        </label>

        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        {canSubmit ? (
          <button
            type="button"
            className={buttonClasses()}
            style={buttonStyle()}
            onClick={() => void handleSubmitBooking()}
            disabled={submitting}
          >
            {submitting ? "Submitting..." : "Confirm booking"}
          </button>
        ) : (
          <p className="text-xs text-zinc-500">
            Booking submission is disabled in preview mode.
          </p>
        )}
          </>
        )}
      </div>
    ) : null;

  const headerBanner =
    settings.headerStyle === "compact" ? (
      <div className="flex items-center gap-3 px-6 py-4 border-b text-white" style={headerBackground()}>
        <LogoBox settings={settings} size="sm" />
        <h1 className="text-lg font-bold leading-tight">{settings.pageTitle}</h1>
      </div>
    ) : settings.headerStyle === "centered" ? (
      <div className="px-6 py-10 text-center text-white" style={headerBackground()}>
        <div className="flex justify-center mb-4">
          <LogoBox settings={settings} size="lg" />
        </div>
        <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
        {settings.description && (
          <p className="mt-2 text-sm text-white/85 max-w-md mx-auto">{settings.description}</p>
        )}
      </div>
    ) : (
      <div className="relative" style={{ ...headerBackground(), minHeight: "12rem" }}>
        <div className="absolute -bottom-8 left-8">
          <LogoBox settings={settings} size="md" />
        </div>
      </div>
    );

  const content = (
    <div className="flex flex-col min-h-full bg-white text-zinc-900" style={{ fontFamily: fontCss }}>
      {settings.layout === "split" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 min-h-full">
          <div className="min-h-[200px] md:min-h-full" style={headerBackground()} />
          <div className="p-8 flex flex-col gap-6">
            <div>
              <LogoBox settings={settings} size="sm" className="mb-4" />
              <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
              <p className="text-zinc-500 mt-2 text-sm">{settings.description}</p>
            </div>
            {settings.welcomeMessage && (
              <p className="text-sm text-zinc-600 p-3 bg-zinc-50 border" style={{ borderRadius: radiusCss }}>
                {settings.welcomeMessage}
              </p>
            )}
            {servicesSection}
            {staffSection}
            {bookButton}
          </div>
        </div>
      ) : (
        <>
          {settings.layout !== "minimal" && headerBanner}
          <div
            className={cn(
              "px-6 md:px-8 pb-10",
              settings.headerStyle === "banner" && settings.layout !== "minimal" ? "pt-12" : "pt-8",
            )}
          >
            {settings.layout === "minimal" && (
              <div className="mb-8">
                <LogoBox settings={settings} size="sm" className="mb-4" />
                <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
                <p className="text-zinc-500 mt-2 text-sm">{settings.description}</p>
              </div>
            )}
            {settings.headerStyle === "banner" && settings.layout !== "minimal" && (
              <div className="mb-8">
                <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
                <p className="text-zinc-500 mt-2 text-sm">{settings.description}</p>
              </div>
            )}
            {settings.welcomeMessage && (
              <p className="text-sm text-zinc-600 mb-6 p-3 bg-zinc-50 border" style={{ borderRadius: radiusCss }}>
                {settings.welcomeMessage}
              </p>
            )}
            <div className="space-y-6">
              {servicesSection}
              {staffSection}
              {detailsSection}
            </div>
          </div>
          <div className="px-6 md:px-8 pb-10 mt-auto">{bookButton}</div>
        </>
      )}
    </div>
  );

  if (!showChrome) {
    return (
      <div className={cn("min-h-screen", previewMode === "mobile" && "max-w-[390px] mx-auto")}>
        {content}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex-1 bg-white dark:bg-zinc-950 rounded-lg shadow-sm border overflow-hidden flex flex-col relative mx-auto w-full transition-all",
        previewMode === "mobile" ? "max-w-[390px]" : "max-w-4xl",
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

function LogoBox({
  settings,
  size,
  className,
}: {
  settings: BookingPageSettings;
  size: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = { sm: "w-12 h-12 text-lg", md: "w-20 h-20 text-2xl", lg: "w-24 h-24 text-3xl" };
  const initial = settings.pageTitle.charAt(0).toUpperCase() || "B";
  const imageUrl = bookingPageLogoUrl(settings);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        className={cn(dims[size], "rounded-xl object-cover border-4 border-white shadow-lg bg-white", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        dims[size],
        "rounded-xl shadow-lg border-4 border-white flex items-center justify-center font-bold text-white",
        className,
      )}
      style={{ backgroundColor: settings.secondaryColor }}
    >
      {initial}
    </div>
  );
}
