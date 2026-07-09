import { ensureBusiness } from "@/lib/settings";
import { supabase } from "@/lib/supabase";
import type {
  BookingPageSettings,
  BookingSlot,
  PublicBookingPage,
  PublicService,
  PublicStaff,
} from "@/types/booking-page";
import { defaultBookingPageSettings, slugify } from "@/types/booking-page";

type BookingPageRow = {
  business_id: string;
  page_title: string;
  description: string;
  welcome_message: string;
  slug: string;
  require_deposit: boolean;
  allow_rescheduling: boolean;
  show_staff_selection: boolean;
  show_prices: boolean;
  show_duration: boolean;
  cover_image_url: string | null;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  layout: BookingPageSettings["layout"];
  font_family: BookingPageSettings["fontFamily"];
  border_radius: BookingPageSettings["borderRadius"];
  header_style: BookingPageSettings["headerStyle"];
  button_style: BookingPageSettings["buttonStyle"];
  background_style: BookingPageSettings["backgroundStyle"];
  is_published: boolean;
};

function mapRow(row: BookingPageRow): BookingPageSettings {
  return {
    businessId: row.business_id,
    pageTitle: row.page_title,
    description: row.description,
    welcomeMessage: row.welcome_message,
    slug: row.slug,
    requireDeposit: row.require_deposit,
    allowRescheduling: row.allow_rescheduling,
    showStaffSelection: row.show_staff_selection,
    showPrices: row.show_prices,
    showDuration: row.show_duration,
    coverImageUrl: row.cover_image_url,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    layout: row.layout,
    fontFamily: row.font_family,
    borderRadius: row.border_radius,
    headerStyle: row.header_style,
    buttonStyle: row.button_style,
    backgroundStyle: row.background_style,
    isPublished: row.is_published,
  };
}

function toRow(settings: BookingPageSettings): BookingPageRow {
  return {
    business_id: settings.businessId,
    page_title: settings.pageTitle,
    description: settings.description,
    welcome_message: settings.welcomeMessage,
    slug: slugify(settings.slug),
    require_deposit: settings.requireDeposit,
    allow_rescheduling: settings.allowRescheduling,
    show_staff_selection: settings.showStaffSelection,
    show_prices: settings.showPrices,
    show_duration: settings.showDuration,
    cover_image_url: settings.coverImageUrl || null,
    logo_url: settings.logoUrl || null,
    primary_color: settings.primaryColor,
    secondary_color: settings.secondaryColor,
    layout: settings.layout,
    font_family: settings.fontFamily,
    border_radius: settings.borderRadius,
    header_style: settings.headerStyle,
    button_style: settings.buttonStyle,
    background_style: settings.backgroundStyle,
    is_published: settings.isPublished,
  };
}

async function uniqueSlug(base: string, businessId: string): Promise<string> {
  let candidate = slugify(base);
  let attempt = 0;

  while (attempt < 20) {
    const { data, error } = await supabase
      .from("booking_page_settings")
      .select("business_id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data || data.business_id === businessId) return candidate;

    attempt += 1;
    candidate = `${slugify(base)}-${attempt}`;
  }

  return `${slugify(base)}-${businessId.slice(0, 8)}`;
}

export const bookingPageKeys = {
  settings: ["booking-page", "settings"] as const,
  public: (slug: string) => ["booking-page", "public", slug] as const,
};

export async function fetchBookingPageSettings(): Promise<BookingPageSettings> {
  const businessId = await ensureBusiness();

  const { data: existing, error } = await supabase
    .from("booking_page_settings")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (existing) return mapRow(existing as BookingPageRow);

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
  defaults.slug = await uniqueSlug(defaults.slug, businessId);

  const { data: created, error: createError } = await supabase
    .from("booking_page_settings")
    .insert(toRow(defaults))
    .select()
    .single();

  if (createError) throw new Error(createError.message);
  return mapRow(created as BookingPageRow);
}

export async function saveBookingPageSettings(
  settings: BookingPageSettings,
): Promise<BookingPageSettings> {
  const businessId = await ensureBusiness();
  const slug = await uniqueSlug(settings.slug, businessId);
  const row = toRow({ ...settings, businessId, slug });

  const { data, error } = await supabase
    .from("booking_page_settings")
    .upsert(row, { onConflict: "business_id" })
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

  const [servicesRes, staffRes, hoursRes] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, description, price, duration")
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
  ]);

  if (servicesRes.error) throw new Error(servicesRes.error.message);
  if (staffRes.error) throw new Error(staffRes.error.message);
  if (hoursRes.error) throw new Error(hoursRes.error.message);

  const services: PublicService[] = (servicesRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    description: (s.description as string) ?? "",
    price: Number(s.price),
    duration: s.duration as number,
  }));

  const staff: PublicStaff[] = (staffRes.data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    position: (s.position as string) ?? "",
    workingDays: (s.working_days as string[] | null) ?? undefined,
  }));

  const openDays = (hoursRes.data ?? [])
    .filter((row) => row.is_open as boolean)
    .map((row) => row.day_name as string);

  return { settings, services, staff, openDays };
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
