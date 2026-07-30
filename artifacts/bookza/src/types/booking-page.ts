export type BookingPageLayout = "classic" | "minimal" | "cards" | "split";
export type BookingPageFont =
  | "inter"
  | "clean"
  | "serif"
  | "rounded"
  | "humanist"
  | "condensed"
  | "mono"
  | "wide";
export type BookingPageRadius = "none" | "sm" | "md" | "lg" | "full";
export type BookingPageHeader = "banner" | "compact" | "centered";
export type BookingPageButton = "filled" | "outline" | "soft";
export type BookingPageBackground = "solid" | "gradient" | "image";
export type BookingPageThemeMode = "auto" | "light" | "dark";
export type BookingPageWidth = "auto" | "compact";

export type BookingPageSettings = {
  businessId: string;
  pageTitle: string;
  description: string;
  welcomeMessage: string;
  slug: string;
  requireDeposit: boolean;
  allowRescheduling: boolean;
  showStaffSelection: boolean;
  showPrices: boolean;
  showDuration: boolean;
  showNotes: boolean;
  coverImageUrl: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  layout: BookingPageLayout;
  themeMode: BookingPageThemeMode;
  pageWidth: BookingPageWidth;
  fontFamily: BookingPageFont;
  borderRadius: BookingPageRadius;
  headerStyle: BookingPageHeader;
  buttonStyle: BookingPageButton;
  backgroundStyle: BookingPageBackground;
  isPublished: boolean;
};

export type PublicService = {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
};

export type PublicStaff = {
  id: string;
  name: string;
  position: string;
  workingDays?: string[];
};

export type PublicBookingPage = {
  settings: BookingPageSettings;
  services: PublicService[];
  staff: PublicStaff[];
  openDays: string[];
};

export type BookingSlot = {
  startTime: string; // "HH:MM" in business-local time
  endTime: string;
};

export const COLOR_PRESETS = [
  { name: "Emerald", primary: "#10b981", secondary: "#059669" },
  { name: "Mint", primary: "#34d399", secondary: "#0f766e" },
  { name: "Cyan", primary: "#06b6d4", secondary: "#0891b2" },
  { name: "Blue", primary: "#3b82f6", secondary: "#2563eb" },
  { name: "Indigo", primary: "#6366f1", secondary: "#4f46e5" },
  { name: "Violet", primary: "#8b5cf6", secondary: "#7c3aed" },
  { name: "Fuchsia", primary: "#d946ef", secondary: "#c026d3" },
  { name: "Rose", primary: "#f43f5e", secondary: "#e11d48" },
  { name: "Ruby", primary: "#dc2626", secondary: "#991b1b" },
  { name: "Orange", primary: "#f97316", secondary: "#ea580c" },
  { name: "Amber", primary: "#f59e0b", secondary: "#d97706" },
  { name: "Lime", primary: "#84cc16", secondary: "#4d7c0f" },
  { name: "Slate", primary: "#475569", secondary: "#334155" },
  { name: "Graphite", primary: "#27272a", secondary: "#18181b" },
] as const;

export const FONT_OPTIONS: { value: BookingPageFont; label: string; css: string }[] = [
  { value: "inter", label: "Modern", css: "Inter, system-ui, sans-serif" },
  { value: "clean", label: "Clean", css: 'Aptos, "Segoe UI", system-ui, sans-serif' },
  { value: "serif", label: "Elegant", css: 'Georgia, "Times New Roman", serif' },
  { value: "rounded", label: "Friendly", css: '"Nunito", "Segoe UI", system-ui, sans-serif' },
  { value: "humanist", label: "Warm", css: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
  { value: "condensed", label: "Condensed", css: '"Arial Narrow", "Roboto Condensed", Arial, sans-serif' },
  { value: "mono", label: "Minimal", css: "ui-monospace, SFMono-Regular, monospace" },
  { value: "wide", label: "Soft Wide", css: "Verdana, Geneva, sans-serif" },
];

export const LAYOUT_OPTIONS: { value: BookingPageLayout; label: string; description: string }[] = [
  { value: "classic", label: "Classic", description: "Banner header with service grid" },
  { value: "minimal", label: "Minimal", description: "Clean list, no hero image" },
  { value: "cards", label: "Cards", description: "Large elevated service cards" },
];

export const RADIUS_OPTIONS: { value: BookingPageRadius; label: string; css: string }[] = [
  { value: "none", label: "Sharp", css: "0" },
  { value: "sm", label: "Subtle", css: "0.25rem" },
  { value: "md", label: "Rounded", css: "0.75rem" },
  { value: "lg", label: "Soft", css: "1.25rem" },
  { value: "full", label: "Pill", css: "9999px" },
];

export const HEADER_OPTIONS: { value: BookingPageHeader; label: string }[] = [
  { value: "banner", label: "Full banner" },
  { value: "compact", label: "Compact bar" },
  { value: "centered", label: "Centered logo" },
];

export const BUTTON_OPTIONS: { value: BookingPageButton; label: string }[] = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
  { value: "soft", label: "Soft" },
];

export const BACKGROUND_OPTIONS: { value: BookingPageBackground; label: string }[] = [
  { value: "gradient", label: "Gradient" },
  { value: "solid", label: "Solid color" },
  { value: "image", label: "Cover image" },
];

export const THEME_MODE_OPTIONS: { value: BookingPageThemeMode; label: string; description: string }[] = [
  { value: "auto", label: "Auto", description: "Follow the client's device setting" },
  { value: "light", label: "Light", description: "Always show the light booking page" },
  { value: "dark", label: "Dark", description: "Always show the dark booking page" },
];

export const PAGE_WIDTH_OPTIONS: { value: BookingPageWidth; label: string; description: string }[] = [
  { value: "auto", label: "Auto", description: "Use the available desktop width" },
  { value: "compact", label: "Compact", description: "Narrower page for a focused flow" },
];

export function bookingPageLogoUrl(settings: Pick<BookingPageSettings, "logoUrl" | "coverImageUrl">): string | null {
  return settings.logoUrl ?? null;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-business"
  );
}

export function defaultBookingPageSettings(
  businessId: string,
  businessName: string,
): BookingPageSettings {
  const title = businessName.trim() || "Book an appointment";
  return {
    businessId,
    pageTitle: title,
    description: "Book your next appointment online. Choose your service below.",
    welcomeMessage: "",
    slug: slugify(title),
    requireDeposit: false,
    allowRescheduling: true,
    showStaffSelection: true,
    showPrices: true,
    showDuration: true,
    showNotes: true,
    coverImageUrl: null,
    logoUrl: null,
    primaryColor: "#10b981",
    secondaryColor: "#059669",
    layout: "classic",
    themeMode: "auto",
    pageWidth: "auto",
    fontFamily: "inter",
    borderRadius: "md",
    headerStyle: "banner",
    buttonStyle: "filled",
    backgroundStyle: "gradient",
    isPublished: false,
  };
}
