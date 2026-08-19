import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { BookingPageSettings } from "@/types/booking-page";
import { bookingPageLogoUrl, FONT_OPTIONS, RADIUS_OPTIONS } from "@/types/booking-page";

/**
 * Shared booking-page theming — the single source of truth for the header, logo,
 * font, colours, radius, and button treatment. Used by both the public booking
 * page (BookingPageView) and the self-service manage page (manage-booking) so
 * a customer experiences the exact same branded chrome in both places.
 */

export function fontCssFor(settings: BookingPageSettings): string | undefined {
  return FONT_OPTIONS.find((f) => f.value === settings.fontFamily)?.css;
}

export function radiusCssFor(settings: BookingPageSettings): string {
  return RADIUS_OPTIONS.find((r) => r.value === settings.borderRadius)?.css ?? "0.5rem";
}

export function headerBackground(settings: BookingPageSettings): CSSProperties {
  if (settings.coverImageUrl) {
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
}

export function buttonClasses(settings: BookingPageSettings): string {
  const base = "w-full py-3 font-semibold transition-opacity hover:opacity-90";
  if (settings.buttonStyle === "outline") return cn(base, "border-2 bg-transparent");
  if (settings.buttonStyle === "soft") return cn(base, "border-0");
  return cn(base, "border-0 text-white");
}

export function buttonStyle(settings: BookingPageSettings, radiusCss: string): CSSProperties {
  if (settings.buttonStyle === "outline") {
    return { borderColor: settings.primaryColor, color: settings.primaryColor, borderRadius: radiusCss };
  }
  if (settings.buttonStyle === "soft") {
    return { backgroundColor: `${settings.primaryColor}22`, color: settings.primaryColor, borderRadius: radiusCss };
  }
  return { backgroundColor: settings.primaryColor, borderRadius: radiusCss };
}

export function LogoBox({
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
  const logoStyle = settings.logoStyle ?? "solid";
  const logoFrameClass =
    logoStyle === "glass"
      ? "border border-white/55 bg-white/25 shadow-lg backdrop-blur-md"
      : logoStyle === "dark"
        ? "border border-white/15 bg-zinc-950/85 shadow-lg"
        : logoStyle === "transparent"
          ? "border-0 bg-transparent shadow-none"
          : "border-4 border-white bg-white shadow-lg";

  if (imageUrl) {
    return (
      <span className={cn(dims[size], "flex items-center justify-center overflow-hidden rounded-xl p-2", logoFrameClass, className)}>
        <img src={imageUrl} alt="" className="h-full w-full object-contain" />
      </span>
    );
  }

  return (
    <div
      className={cn(
        dims[size],
        "rounded-xl flex items-center justify-center font-bold text-white",
        logoFrameClass,
        className,
      )}
      style={{ backgroundColor: settings.secondaryColor }}
    >
      {initial}
    </div>
  );
}

/** The themed header banner (compact / centered / banner variants). */
export function BookingPageHeader({ settings }: { settings: BookingPageSettings }) {
  if (settings.headerStyle === "compact") {
    return (
      <div className="flex items-center gap-3 px-6 py-4 border-b text-white" style={headerBackground(settings)}>
        <LogoBox settings={settings} size="sm" />
        <h1 className="text-lg font-bold leading-tight">{settings.pageTitle}</h1>
      </div>
    );
  }
  if (settings.headerStyle === "centered") {
    return (
      <div className="px-6 py-10 text-center text-white" style={headerBackground(settings)}>
        <div className="flex justify-center mb-4">
          <LogoBox settings={settings} size="lg" />
        </div>
        <h1 className="text-2xl font-bold">{settings.pageTitle}</h1>
        {settings.description && (
          <p className="mt-2 text-sm text-white/85 max-w-md mx-auto">{settings.description}</p>
        )}
      </div>
    );
  }
  return (
    <div className="relative" style={{ ...headerBackground(settings), minHeight: "12rem" }}>
      <div className="absolute -bottom-8 left-8">
        <LogoBox settings={settings} size="md" />
      </div>
    </div>
  );
}
