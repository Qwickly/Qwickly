import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { fetchEntitlements } from "@/lib/entitlements";
import { fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchBotSettings } from "@/lib/bot-settings";
import { fetchEmailDomain } from "@/lib/email-domains";
import { fetchWhatsappConnectionStatus } from "@/lib/settings";
import { fetchBookingPageSettings } from "@/lib/booking-page";

export const GETTING_STARTED_STEPS = [
  {
    id: "business_details",
    title: "Complete your business details",
    description: "Add your business name, industry, and phone number so clients recognise you on the booking page and in WhatsApp messages.",
  },
  {
    id: "first_service",
    title: "Create your first service",
    description: "Add what you offer — a haircut, a consultation, a treatment — with a price and duration.",
  },
  {
    id: "first_staff",
    title: "Add a staff member",
    description: "Add the people who take bookings so clients can pick who they see.",
  },
  {
    id: "staff_topup",
    title: "Your plan, allowances and invoices",
    description: "What your plan includes, what you have left this cycle, the add-ons you can put on top, and where to find every invoice. Also where you buy extra staff seats when your team grows.",
    optional: true,
  },
  {
    id: "whatsapp_bot",
    title: "WhatsApp AI assistant",
    description: "Open Bot Setup on your laptop or another device, generate a QR code, then scan it from WhatsApp > Linked devices on your phone. After WhatsApp is connected, you can turn on the AI assistant for bookings and client questions.",
    optional: true,
  },
  {
    id: "custom_email",
    title: "Custom email domain",
    description: "By default, booking emails come from Qwickly. Verify your own domain so they come from your business instead.",
    optional: true,
  },
  {
    id: "booking_page",
    title: "Customize your booking page",
    description: "Add branding, pick a theme, choose what clients can book, and publish your page so clients can start booking online.",
    optional: true,
  },
  {
    id: "calendar",
    title: "Explore your calendar",
    description: "Walk through day, week, and month views with sample appointments so you know how to manage your schedule once bookings arrive.",
    optional: true,
  },
] as const;

export type GettingStartedStepId = (typeof GETTING_STARTED_STEPS)[number]["id"];

export type GettingStartedStep = {
  id: GettingStartedStepId;
  title: string;
  description: string;
  optional: boolean;
  complete: boolean;
};

export type GettingStartedStatus = {
  businessId: string;
  steps: GettingStartedStep[];
  completedCount: number;
  total: number;
};

export async function fetchGettingStartedStatus(): Promise<GettingStartedStatus> {
  const businessId = await ensureBusiness();

  const [entitlements, businessRes] = await Promise.all([
    fetchEntitlements(),
    supabase
      .from("businesses")
      .select("business_name, industry, phone, getting_started_dismissed_steps")
      .eq("id", businessId)
      .single(),
  ]);

  if (businessRes.error) throw new Error(businessRes.error.message);

  const business = businessRes.data as {
    business_name: string;
    industry: string;
    phone: string;
    getting_started_dismissed_steps: string[] | null;
  };
  const dismissed = new Set(business.getting_started_dismissed_steps ?? []);

  if (!entitlements.entitled) {
    const lockedSteps: GettingStartedStep[] = GETTING_STARTED_STEPS.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      optional: Boolean("optional" in step && step.optional),
      complete: false,
    }));

    return {
      businessId,
      steps: lockedSteps,
      completedCount: 0,
      total: lockedSteps.length,
    };
  }

  const [services, staff, botSettings, connection, emailDomain, bookingPage] = await Promise.all([
    fetchServices(),
    fetchStaff(),
    fetchBotSettings(),
    fetchWhatsappConnectionStatus(),
    fetchEmailDomain().catch(() => null),
    fetchBookingPageSettings(),
  ]);

  const completionById: Record<GettingStartedStepId, boolean> = {
    business_details: Boolean(business.business_name && business.industry && business.phone),
    first_service: services.length > 0,
    first_staff: staff.length > 0,
    staff_topup: dismissed.has("staff_topup"),
    whatsapp_bot: (connection.status === "connected" && botSettings.settings.bot_enabled) || dismissed.has("whatsapp_bot"),
    custom_email: emailDomain?.status === "verified" || dismissed.has("custom_email"),
    booking_page: bookingPage.isPublished || dismissed.has("booking_page"),
    calendar: dismissed.has("calendar"),
  };

  const steps: GettingStartedStep[] = GETTING_STARTED_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    optional: Boolean("optional" in step && step.optional),
    complete: completionById[step.id],
  }));

  return {
    businessId,
    steps,
    completedCount: steps.filter((s) => s.complete).length,
    total: steps.length,
  };
}

export async function dismissGettingStartedStep(
  businessId: string,
  stepId: GettingStartedStepId,
): Promise<void> {
  const { data, error: fetchError } = await supabase
    .from("businesses")
    .select("getting_started_dismissed_steps")
    .eq("id", businessId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const current = (data as { getting_started_dismissed_steps: string[] | null }).getting_started_dismissed_steps ?? [];
  if (current.includes(stepId)) return;

  const { error } = await supabase
    .from("businesses")
    .update({ getting_started_dismissed_steps: [...current, stepId] })
    .eq("id", businessId);
  if (error) throw new Error(error.message);
}
