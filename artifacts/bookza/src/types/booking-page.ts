export type BookingPageLayout = "classic" | "minimal" | "cards" | "split";
export type BookingPageFont = "inter" | "serif" | "rounded" | "mono";
export type BookingPageRadius = "none" | "sm" | "md" | "lg" | "full";
export type BookingPageHeader = "banner" | "compact" | "centered";
export type BookingPageButton = "filled" | "outline" | "soft";
export type BookingPageBackground = "solid" | "gradient" | "image";

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
  coverImageUrl: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  layout: BookingPageLayout;
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
};

export const COLOR_PRESETS = [
  { name: "Emerald", primary: "#10b981", secondary: "#059669" },
  { name: "Blue", primary: "#3b82f6", secondary: "#2563eb" },
  { name: "Violet", primary: "#8b5cf6", secondary: "#7c3aed" },
  { name: "Rose", primary: "#f43f5e", secondary: "#e11d48" },
  { name: "Orange", primary: "#f97316", secondary: "#ea580c" },
  { name: "Slate", primary: "#475569", secondary: "#334155" },
  { name: "Teal", primary: "#14b8a6", secondary: "#0d9488" },
  { name: "Amber", primary: "#f59e0b", secondary: "#d97706" },
] as const;

export const FONT_OPTIONS: { value: BookingPageFont; label: string; css: string }[] = [
  { value: "inter", label: "Modern", css: "Inter, system-ui, sans-serif" },
  { value: "serif", label: "Elegant", css: 'Georgia, "Times New Roman", serif' },
  { value: "rounded", label: "Friendly", css: '"Nunito", "Segoe UI", system-ui, sans-serif' },
  { value: "mono", label: "Minimal", css: "ui-monospace, SFMono-Regular, monospace" },
];

export const LAYOUT_OPTIONS: { value: BookingPageLayout; label: string; description: string }[] = [
  { value: "classic", label: "Classic", description: "Banner header with service grid" },
  { value: "minimal", label: "Minimal", description: "Clean list, no hero image" },
  { value: "cards", label: "Cards", description: "Large elevated service cards" },
  { value: "split", label: "Split", description: "Side-by-side hero and booking" },
];

export const RADIUS_OPTIONS: { value: BookingPageRadius; label: string; css: string }[] = [
  { value: "none", label: "Sharp", css: "0" },
  { value: "sm", label: "Subtle", css: "0.375rem" },
  { value: "md", label: "Rounded", css: "0.5rem" },
  { value: "lg", label: "Soft", css: "0.75rem" },
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

export function bookingPageLogoUrl(settings: Pick<BookingPageSettings, "logoUrl" | "coverImageUrl">): string | null {
  return settings.logoUrl ?? settings.coverImageUrl;
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
    coverImageUrl: null,
    logoUrl: null,
    primaryColor: "#10b981",
    secondaryColor: "#059669",
    layout: "classic",
    fontFamily: "inter",
    borderRadius: "md",
    headerStyle: "banner",
    buttonStyle: "filled",
    backgroundStyle: "gradient",
    isPublished: false,
  };
}
