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

export const STAFF_TOUR_STEPS: TourStep[] = [
  {
    targetId: "add-staff-button",
    title: "Add your team",
    description: "Add the people who take bookings so clients can choose who they see when they book online.",
  },
];

export const WHATSAPP_BOT_TOUR_STEPS: TourStep[] = [
  {
    targetId: "bot-section-assistant",
    title: "Bot behavior lives here",
    description: "This section controls how your WhatsApp AI assistant replies, confirms bookings, and answers questions.",
  },
  {
    targetId: "bot-enabled-toggle",
    title: "Turn it on when ready",
    description: "Flip this on and the assistant starts replying to WhatsApp messages automatically — no rush, come back to it anytime.",
  },
];

export const CUSTOM_EMAIL_TOUR_STEPS: TourStep[] = [
  {
    targetId: "segment-custom",
    title: "Send from your own domain",
    description: "By default, booking emails come from Qwickly. Switch to Own domain to verify your business's domain and send from there instead.",
  },
];
