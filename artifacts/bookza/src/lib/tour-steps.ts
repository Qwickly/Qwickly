import type { TourStep } from "@/components/tour/TourOverlay";

// Step content for the Getting Started checklist's guided spotlight tours.
// Each tourId here matches the `?tour=` param set on the checklist's CTA
// links in pages/get-started.tsx, and each targetId matches a data-tour-id
// attribute placed on the real element in the target page.

export const SERVICE_TOUR_STEPS: TourStep[] = [
  {
    targetId: "add-service-button",
    title: "Start here",
    description: "A service is anything clients can book — a haircut, a consultation, a treatment. Give it a name, price, and duration.",
  },
  {
    targetId: "services-list",
    title: "Your services live here",
    description: "Once you add services, they'll show up in this list — and clients will see them on your public booking page.",
  },
];

/** Fires once, right after a business's genuinely first-ever service is
 * created — spotlights the real new card instead of a generic placeholder. */
export function serviceCreatedSteps(serviceId: string): TourStep[] {
  return [
    {
      targetId: `service-card-${serviceId}`,
      title: "Nice, that's your first service",
      description: "Use the ⋯ menu on any service card to edit its details, duplicate it as a starting point for a similar one, or archive it once you stop offering it.",
    },
  ];
}

export const STAFF_TOUR_STEPS: TourStep[] = [
  {
    targetId: "add-staff-button",
    title: "Add your team",
    description: "Add the people who take bookings so clients can choose who they see when they book online.",
  },
];

/** Same idea as serviceCreatedSteps, for a business's first-ever staff member. */
export function staffCreatedSteps(staffId: string): TourStep[] {
  return [
    {
      targetId: `staff-card-${staffId}`,
      title: "Your first team member",
      description: "Use the ⋯ menu on any staff card to edit their details, archive them if they leave, or permanently delete them if they were added by mistake.",
    },
  ];
}

export const WHATSAPP_BOT_TOUR_STEPS: TourStep[] = [
  {
    targetId: "bot-section-assistant",
    title: "Assistant",
    description: "The master switch, plus an at-a-glance summary of the assistant's mode and availability.",
  },
  {
    targetId: "bot-section-replies",
    title: "Replies",
    description: "Choose whether the assistant sends replies automatically, or drafts them for you to approve first before anything goes to a client.",
  },
  {
    targetId: "bot-section-booking",
    title: "Booking Rules",
    description: "Set how far in advance clients can cancel or reschedule online, and what the assistant says when a request falls outside those rules.",
  },
  {
    targetId: "bot-section-availability",
    title: "Availability",
    description: "Run the assistant 24/7, or only during your business hours — it'll politely hold off outside that window.",
  },
  {
    targetId: "bot-section-services",
    title: "Services",
    description: "Choose exactly which of your services the assistant is allowed to book — handy if some services need a human touch first.",
  },
  {
    targetId: "bot-section-knowledge",
    title: "Knowledge",
    description: "Add common questions and answers here so the assistant can answer things like pricing or parking without you lifting a finger.",
  },
  {
    targetId: "bot-section-identity",
    title: "Identity",
    description: "Give the assistant a name and a tone of voice, and write its welcome and fallback messages so it sounds like your business.",
  },
  {
    targetId: "bot-enabled-toggle",
    title: "Turn it on when ready",
    description: "Flip this on and the assistant starts replying to WhatsApp messages automatically — no rush, come back to it anytime once the rest is set up how you like.",
  },
];

/** One step per Settings tab nav item — mirrors WHATSAPP_BOT_TOUR_STEPS's
 * approach of spotlighting nav entries rather than tab content, since the
 * settings page's mobile layout hides all tab content behind a drill-down
 * and only the nav list (mobile) / nav aside (desktop) is reliably visible
 * throughout, in both layouts, without needing to open any section. */
export const SETTINGS_TOUR_STEPS: TourStep[] = [
  {
    targetId: "settings-tab-profile",
    title: "Business Profile",
    description: "Your business name, website, industry, description, and public booking page details all live here.",
  },
  {
    targetId: "settings-tab-booking",
    title: "Booking",
    description: "Set how far in advance clients can cancel or reschedule online.",
  },
  {
    targetId: "settings-tab-notifications",
    title: "Notifications",
    description: "Turn on automated reminders and updates for clients and staff — confirmations, 24-hour and 2-hour reminders, and more.",
  },
  {
    targetId: "settings-tab-payments",
    title: "Payments",
    description: "Set deposit requirements and connect a payment provider like PayFast or Yoco so clients can pay online.",
  },
  {
    targetId: "settings-tab-whatsapp",
    title: "WhatsApp",
    description: "Connect your WhatsApp number and manage the shared client inbox from here.",
  },
  {
    targetId: "settings-tab-team",
    title: "Team",
    description: "Staff logins, roles, and permissions — coming soon.",
  },
  {
    targetId: "settings-tab-security",
    title: "Security",
    description: "Change your password and manage account-level settings here.",
  },
];

export const CUSTOM_EMAIL_TOUR_STEPS: TourStep[] = [
  {
    targetId: "segment-custom",
    title: "Send from your own domain",
    description: "By default, booking emails come from Qwickly. Switch to Own domain to verify your business's domain and send from there instead.",
  },
];

// Billing walkthrough copy. The actual TourStep[] is assembled inline in
// pages/billing.tsx (not exported as a plain array here) because two of its
// steps need onAdvance callbacks tied to that page's own dialog-open state —
// this file just holds the words so the copy lives in one place.
export const BILLING_STEP_COPY = {
  plan: {
    title: "Your plan",
    description: "Your current plan, billing cycle, and what happens when your trial ends.",
  },
  usage: {
    title: "Usage this period",
    description: "Track things like AI messages and marketing emails against your plan's limits. Running low on staff seats? Top up from the dropdown here.",
  },
  addonsIntro: {
    title: "Add-ons",
    description: "Extra features on top of your base plan — some of these (like the WhatsApp AI assistant) may need to be added here once your trial ends.",
  },
  invoices: {
    title: "Billing History",
    description: "Every payment and invoice for this account shows up here, with a PDF download for each.",
  },
} as const;

/** Keyed by the same addon id used as the AddonRow's React key in billing.tsx. */
export const ADDON_TOUR_COPY: Record<string, { title: string; description: string }> = {
  whatsapp_chatbot: {
    title: "WhatsApp AI assistant",
    description: "The add-on that powers automatic WhatsApp replies and bookings — this is the one people most often forget to add back after their trial ends.",
  },
  branded_email: {
    title: "Branded email",
    description: "Send booking emails from your own verified domain instead of Qwickly's shared one.",
  },
  ai_assistant: {
    title: "AI Assistant",
    description: "Unlocks the in-app AI assistant widget for quick answers while you work.",
  },
  analytics: {
    title: "Analytics",
    description: "Deeper reporting — retention, no-show trends, and revenue breakdowns by service and staff.",
  },
  custom_domain: {
    title: "Custom domain",
    description: "Run your public booking page on your own domain instead of Qwickly's.",
  },
};
