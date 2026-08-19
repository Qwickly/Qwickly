import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import { buildApiUrl } from "@workspace/api-client-react";
import type {
  BookingPageSettings,
  BookingSlot,
  PublicBookingPage,
  PublicDepositSettings,
  PublicService,
  PublicStaff,
} from "@/types/booking-page";
import { defaultBookingPageSettings, slugify } from "@/types/booking-page";

type BookingPageRow = {
  id: string;
  business_id: string;
  is_active?: boolean;
  page_title: string;
  description: string;
  welcome_message: string;
  slug: string;
  contact_phone?: string | null;
  contact_email?: string | null;
  website_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  whatsapp_number?: string | null;
  require_deposit: boolean;
  allow_rescheduling: boolean;
  show_staff_selection: boolean;
  show_prices: boolean;
  show_duration: boolean;
  show_notes?: boolean;
  cover_image_url: string | null;
  logo_url: string | null;
  logo_style?: BookingPageSettings["logoStyle"];
  primary_color: string;
  secondary_color: string;
  layout: BookingPageSettings["layout"] | "split";
  theme_mode?: BookingPageSettings["themeMode"];
  page_width?: BookingPageSettings["pageWidth"] | "comfortable" | "wide";
  font_family: BookingPageSettings["fontFamily"];
  border_radius: BookingPageSettings["borderRadius"];
  header_style: BookingPageSettings["headerStyle"];
  button_style: BookingPageSettings["buttonStyle"];
  background_style: BookingPageSettings["backgroundStyle"];
  progress_style?: BookingPageSettings["progressStyle"];
  is_published: boolean;
};

function mapRow(row: BookingPageRow): BookingPageSettings {
  return {
    id: row.id,
    businessId: row.business_id,
    isActive: row.is_active ?? false,
    pageTitle: row.page_title,
    description: row.description,
    welcomeMessage: row.welcome_message,
    slug: row.slug,
    contactPhone: row.contact_phone ?? "",
    contactEmail: row.contact_email ?? "",
    websiteUrl: row.website_url ?? "",
    instagramUrl: row.instagram_url ?? "",
    facebookUrl: row.facebook_url ?? "",
    whatsappNumber: row.whatsapp_number ?? "",
    requireDeposit: row.require_deposit,
    allowRescheduling: row.allow_rescheduling,
    showStaffSelection: row.show_staff_selection,
    showPrices: row.show_prices,
    showDuration: row.show_duration,
    showNotes: row.show_notes ?? true,
    coverImageUrl: row.cover_image_url,
    logoUrl: row.logo_url,
    logoStyle: row.logo_style ?? "solid",
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    layout: row.layout === "split" ? "classic" : row.layout,
    themeMode: row.theme_mode ?? "auto",
    pageWidth: row.page_width === "compact" ? "compact" : "auto",
    fontFamily: row.font_family,
    borderRadius: row.border_radius,
    headerStyle: row.header_style,
    buttonStyle: row.button_style,
    backgroundStyle: row.background_style,
    progressStyle: row.progress_style ?? "line",
    isPublished: row.is_published,
  };
}

function toRow(settings: BookingPageSettings): Omit<BookingPageRow, "id"> {
  return {
    business_id: settings.businessId,
    page_title: settings.pageTitle,
    description: settings.description,
    welcome_message: settings.welcomeMessage,
    slug: slugify(settings.slug),
    contact_phone: settings.contactPhone.trim() || null,
    contact_email: settings.contactEmail.trim() || null,
    website_url: settings.websiteUrl.trim() || null,
    instagram_url: settings.instagramUrl.trim() || null,
    facebook_url: settings.facebookUrl.trim() || null,
    whatsapp_number: settings.whatsappNumber.trim() || null,
    require_deposit: settings.requireDeposit,
    allow_rescheduling: settings.allowRescheduling,
    show_staff_selection: settings.showStaffSelection,
    show_prices: settings.showPrices,
    show_duration: settings.showDuration,
    show_notes: settings.showNotes,
    cover_image_url: settings.coverImageUrl || null,
    logo_url: settings.logoUrl || null,
    logo_style: settings.logoStyle,
    primary_color: settings.primaryColor,
    secondary_color: settings.secondaryColor,
    layout: settings.layout,
    theme_mode: settings.themeMode,
    page_width: settings.pageWidth,
    font_family: settings.fontFamily,
    border_radius: settings.borderRadius,
    header_style: settings.headerStyle,
    button_style: settings.buttonStyle,
    background_style: settings.backgroundStyle,
    progress_style: settings.progressStyle,
    is_published: settings.isPublished,
  };
}

async function uniqueSlug(base: string, pageId: string | null): Promise<string> {
  let candidate = slugify(base) || "book";
  let attempt = 0;

  while (attempt < 20) {
    const { data, error } = await supabase
      .from("booking_page_settings")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data || data.id === pageId) return candidate;

    attempt += 1;
    candidate = `${slugify(base)}-${attempt}`;
  }

  return `${slugify(base)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const bookingPageKeys = {
  /** Every page this business has. */
  list: ["booking-page", "list"] as const,
  /** One page by id. */
  page: (id: string) => ["booking-page", "page", id] as const,
  /** The page this business's own links point at. */
  settings: ["booking-page", "settings"] as const,
  public: (slug: string) => ["booking-page", "public", slug] as const,
};

export async function fetchBookingPageSettings(): Promise<BookingPageSettings> {
  const businessId = await ensureBusiness();

  const { data: existing, error } = await supabase
    .from("booking_page_settings")
    .select("*")
    .eq("business_id", businessId)
    // Active first, then oldest: a business that somehow has no active page
    // still gets a stable answer rather than an arbitrary one.
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);
  if (existing && existing.length > 0) return mapRow(existing[0] as BookingPageRow);

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("business_name")
    .eq("id", businessId)
    .single();

  if (businessError) throw new Error(businessError.message);

  const defaults = defaultBookingPageSettings(
    businessId,
    (business.business_name as string) ?? "",
  );
  defaults.slug = await uniqueSlug(defaults.slug, null);

  const { data: created, error: createError } = await supabase
    .from("booking_page_settings")
    // The business's first page is its active one.
    .insert({ ...toRow(defaults), is_active: true })
    .select()
    .single();

  if (createError) throw new Error(createError.message);
  return mapRow(created as BookingPageRow);
}

/**
 * A new, empty page: unpublished, inactive, on its own URL. Same shape as the
 * one a business gets automatically, so a second page starts where the first
 * one did rather than as a copy of it.
 */
export async function createBookingPage(title?: string): Promise<BookingPageSettings> {
  const businessId = await ensureBusiness();

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("business_name")
    .eq("id", businessId)
    .single();

  if (businessError) throw new Error(businessError.message);

  const defaults = defaultBookingPageSettings(
    businessId,
    (business.business_name as string) ?? "",
  );
  if (title?.trim()) defaults.pageTitle = title.trim();
  defaults.slug = await uniqueSlug(title?.trim() || `${defaults.slug}-2`, null);

  const { data, error } = await supabase
    .from("booking_page_settings")
    .insert(toRow(defaults))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as BookingPageRow);
}

/** Every booking page this business has, active first. */
export async function fetchBookingPages(): Promise<BookingPageSettings[]> {
  const businessId = await ensureBusiness();

  const { data, error } = await supabase
    .from("booking_page_settings")
    .select("*")
    .eq("business_id", businessId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  // A business with no page yet gets one, so the overview is never empty and
  // the first page is always the active one.
  if (!data || data.length === 0) {
    return [await fetchBookingPageSettings()];
  }

  return data.map((row) => mapRow(row as BookingPageRow));
}

export async function fetchBookingPage(id: string): Promise<BookingPageSettings> {
  const { data, error } = await supabase
    .from("booking_page_settings")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as BookingPageRow);
}

/**
 * A copy of an existing page, unpublished and inactive, with its own URL — so
 * duplicating never takes the original's traffic or its link.
 */
export async function duplicateBookingPage(id: string): Promise<BookingPageSettings> {
  const source = await fetchBookingPage(id);
  const businessId = await ensureBusiness();

  const copy: BookingPageSettings = {
    ...source,
    id: "",
    businessId,
    isActive: false,
    isPublished: false,
    pageTitle: `${source.pageTitle} (copy)`.trim(),
    slug: await uniqueSlug(`${source.slug}-copy`, null),
  };

  const { data, error } = await supabase
    .from("booking_page_settings")
    .insert(toRow(copy))
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as BookingPageRow);
}

/**
 * Which page this business's own links point at. The unique partial index means
 * the database will not hold two, so the old one is cleared first.
 */
export async function setActiveBookingPage(id: string): Promise<void> {
  const businessId = await ensureBusiness();

  const { error: clearError } = await supabase
    .from("booking_page_settings")
    .update({ is_active: false })
    .eq("business_id", businessId)
    .neq("id", id);

  if (clearError) throw new Error(clearError.message);

  const { error } = await supabase
    .from("booking_page_settings")
    .update({ is_active: true })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteBookingPage(id: string): Promise<void> {
  const { error } = await supabase.from("booking_page_settings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function saveBookingPageSettings(
  settings: BookingPageSettings,
): Promise<BookingPageSettings> {
  const businessId = await ensureBusiness();
  const slug = await uniqueSlug(settings.slug, settings.id || null);
  const row = toRow({ ...settings, businessId, slug });

  if (!settings.id) {
    const { data, error } = await supabase
      .from("booking_page_settings")
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return mapRow(data as BookingPageRow);
  }

  const { data, error } = await supabase
    .from("booking_page_settings")
    .update(row)
    .eq("id", settings.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return mapRow(data as BookingPageRow);
}

export async function fetchPublicBookingPage(slug: string): Promise<PublicBookingPage | null> {
  const { data: page, error } = await supabase
    .from("booking_page_settings")
    .select("*")
    .eq("slug", slugify(slug))
    .eq("is_published", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!page) return null;

  const businessId = page.business_id as string;
  const settings = mapRow(page as BookingPageRow);

  const [servicesRes, staffRes, hoursRes, depositRes] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, description, price, duration, deposit_required, deposit_amount")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .order("name"),
    settings.showStaffSelection
      ? supabase
          .from("staff_members")
          .select("id, name, position, working_days")
          .eq("business_id", businessId)
          .eq("is_active", true)
          .order("name")
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("business_operating_hours")
      .select("day_name, is_open")
      .eq("business_id", businessId),
    supabase
      .from("deposit_settings")
      .select("require_deposit, deposit_type, deposit_amount")
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  if (servicesRes.error) throw new Error(servicesRes.error.message);
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);
  if (depositRes.error) throw new Error(depositRes.error.message);

  const services: PublicService[] = (servicesRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    description: (s.description as string) ?? "",
    price: Number(s.price),
    duration: s.duration as number,
    depositRequired: Boolean(s.deposit_required),
    depositAmount: Number(s.deposit_amount ?? 0),
  }));

  const depositSettings: PublicDepositSettings | null = depositRes.data
    ? {
        requireDeposit: Boolean(depositRes.data.require_deposit),
        depositType: (depositRes.data.deposit_type as "percentage" | "fixed") ?? "percentage",
        depositAmount: Number(depositRes.data.deposit_amount ?? 0),
      }
    : null;

  const staff: PublicStaff[] = (staffRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    position: (s.position as string) ?? "",
    workingDays: (s.working_days as string[] | null) ?? undefined,
  }));

  const openDays = (hoursRes.data ?? [])
    .filter((row) => row.is_open as boolean)
    .map((row) => row.day_name as string);

  return { settings, services, staff, openDays, depositSettings };
}

export type PublicBookingSlotsInput = {
  slug: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  staffId?: string | null;
};

export async function fetchPublicBookingSlots(
  input: PublicBookingSlotsInput,
): Promise<BookingSlot[]> {
  const { data, error } = await supabase.rpc("get_public_booking_slots", {
    p_slug: slugify(input.slug),
    p_service_id: input.serviceId,
    p_date: input.date,
    p_staff_id: input.staffId ?? null,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row: { start_time: string; end_time: string }) => ({
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

export function bookingPageUrl(slug: string): string {
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/book/${slugify(slug)}`;
}

export type PublicBookingInput = {
  slug: string;
  serviceId: string;
  staffId?: string | null;
  clientName: string;
  clientPhone: string;
  clientEmail?: string | null;
  startTime: string; // ISO string
  notes?: string | null;
};

export async function createPublicBooking(input: PublicBookingInput): Promise<{ bookingId: string }> {
  console.log("[createPublicBooking] Called with:", input);
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_slug: slugify(input.slug),
    p_service_id: input.serviceId,
    p_staff_id: input.staffId ?? null,
    p_client_name: input.clientName,
    p_client_phone: input.clientPhone,
    p_client_email: input.clientEmail ?? null,
    p_start_time: input.startTime,
    p_notes: input.notes ?? null,
  });

  console.log("[createPublicBooking] Response data:", data);
  console.log("[createPublicBooking] Response error:", error);

  if (error) {
    console.error("[createPublicBooking] Error:", error);
    throw new Error(error.message || "Failed to create booking");
  }
  return { bookingId: String(data) };
}

export type PayFastIntent = {
  action: string;
  fields: Record<string, string>;
};

/**
 * Unauthenticated by design (POST /api/public-payments/payfast-intent) — the
 * public booking page has no session, same trust model as create_public_booking.
 */
export async function initiatePayFastDeposit(input: {
  slug: string;
  bookingId: string;
}): Promise<PayFastIntent> {
  const res = await fetch(buildApiUrl("/api/public-payments/payfast-intent"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: slugify(input.slug), bookingId: input.bookingId }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error || "Could not start deposit payment");
  }
  return payload as PayFastIntent;
}

export type PublicPaymentStatus = {
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  depositPaid: boolean;
};

/** Polled by the public payment-return page — the ITN webhook can land after the browser redirects back. */
export async function checkPublicPaymentStatus(input: {
  slug: string;
  bookingId: string;
}): Promise<PublicPaymentStatus> {
  const url = new URL(buildApiUrl("/api/public-payments/status"));
  url.searchParams.set("slug", slugify(input.slug));
  url.searchParams.set("bookingId", input.bookingId);

  const res = await fetch(url.toString());
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error || "Could not check payment status");
  }
  return payload as PublicPaymentStatus;
}

/** Auto-submits a hidden PayFast form — same technique as the dashboard's sandbox tester. */
export function redirectToPayFast(intent: PayFastIntent): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = intent.action;
  for (const [name, value] of Object.entries(intent.fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
