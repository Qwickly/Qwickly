import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { fetchEntitlements } from "@/lib/entitlements";
import { fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchBotSettings } from "@/lib/bot-settings";
import { fetchEmailDomain } from "@/lib/email-domains";
import { fetchWhatsappConnectionStatus } from "@/lib/settings";

export const GETTING_STARTED_STEPS = [
  {
    id: "trial",
    title: "Start your free trial",
    description: "Your 14-day trial unlocks every feature — no charge until day 14, cancel anytime.",
  },
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
    title: "Need more staff seats?",
    description: "Your plan includes a set number of staff seats. If your team is bigger, you can top up seats anytime in Billing.",
    optional: true,
  },
  {
    id: "whatsapp_bot",
    title: "Set up your WhatsApp AI assistant",
    description: "Connect WhatsApp and turn on the AI assistant so it can confirm bookings and answer client questions automatically.",
    optional: true,
  },
  {
    id: "custom_email",
    title: "Send email from your own domain",
    description: "By default, booking emails come from Qwickly. Verify your own domain so they come from your business instead.",
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

  const [
    entitlements,
    businessRes,
    services,
    staff,
    botSettings,
    connection,
    emailDomain,
  ] = await Promise.all([
    fetchEntitlements(),
    supabase
      .from("businesses")
      .select("business_name, industry, phone, getting_started_dismissed_steps")
      .eq("id", businessId)
      .single(),
    fetchServices(),
    fetchStaff(),
    fetchBotSettings(),
    fetchWhatsappConnectionStatus(),
    fetchEmailDomain().catch(() => null),
  ]);

  if (businessRes.error) throw new Error(businessRes.error.message);

  const business = businessRes.data as {
    business_name: string;
    industry: string;
    phone: string;
    getting_started_dismissed_steps: string[] | null;
  };
  const dismissed = new Set(business.getting_started_dismissed_steps ?? []);

  const completionById: Record<GettingStartedStepId, boolean> = {
    trial: entitlements.entitled,
    business_details: Boolean(business.business_name && business.industry && business.phone),
    first_service: services.length > 0,
    first_staff: staff.length > 0,
    staff_topup: dismissed.has("staff_topup"),
    whatsapp_bot: (connection.status === "connected" && botSettings.settings.bot_enabled) || dismissed.has("whatsapp_bot"),
    custom_email: emailDomain?.status === "verified" || dismissed.has("custom_email"),
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
