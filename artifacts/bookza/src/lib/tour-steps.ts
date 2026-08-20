import type { TourStep } from "@/components/tour/TourOverlay";

// Step content for the guided spotlight tours on /help. Each tourId matches the
// `?tour=` param on a tutorial's link in pages/help.tsx, and each targetId
// matches a data-tour-id attribute on the real element in the target page.
//
// House rule for the copy: a step must say something the screen does not. The
// label under the spotlight already names the control — what a walkthrough is
// for is the part you cannot see, which is usually where the value ends up
// (on the booking page, in a reminder, on an invoice) or what happens if you
// leave it alone.

export const SERVICE_TOUR_STEPS: TourStep[] = [
  {
    targetId: "add-service-button",
    title: "A service is a bookable slot",
    description: "Name, price and duration. The duration is the important one — it decides how long the appointment blocks out on your calendar, and how many slots a day can hold.",
  },
  {
    targetId: "service-card-tour-demo-service",
    title: "Here's one as an example",
    description: "This card isn't saved to your account — it's here for the walkthrough. Every active service you do have appears on your public booking page exactly like this, in this order, at this price.",
  },
  {
    targetId: "service-card-tour-demo-service",
    title: "45 minutes means 45 minutes",
    description: "The duration blocks that much time on the calendar of whoever takes the booking, and the next slot your page offers starts after it. Get it wrong and you either double-book yourself or leave gaps nobody can fill.",
  },
  {
    targetId: "service-card-tour-demo-service",
    title: "A deposit is charged at booking",
    description: "This example asks for R100 up front, taken when the client books rather than when they arrive. It's the single most effective thing you can do about no-shows — set it per service, so you can ask for one on the long appointments and not the short ones.",
  },
  {
    targetId: "services-search",
    title: "Archive rather than delete",
    description: "Stopped offering something? Archive it. It disappears from your booking page but stays on the bookings that already used it, so your history and revenue stay correct. Use this filter to see archived ones again.",
  },
];

export const STAFF_TOUR_STEPS: TourStep[] = [
  {
    targetId: "staff-seat-badge",
    title: "Seats, not people",
    description: "This counts bookable calendars against what your plan includes. Someone who never takes bookings — a receptionist, a manager — doesn't need a seat here; they get a login from Settings › Team instead.",
  },
  {
    targetId: "add-staff-button",
    title: "Each person gets their own calendar",
    description: "Bookings land on the calendar of whoever the client picked, so adding someone here is what lets clients choose between them.",
  },
  {
    targetId: "staff-card-tour-demo-staff",
    title: "Here's one as an example",
    description: "This person isn't saved to your account — they're here for the walkthrough. Open a real one and you get their schedule, their upcoming bookings and what they've brought in.",
  },
  {
    targetId: "staff-card-tour-demo-staff",
    title: "Working days decide your open slots",
    description: "This example works Tuesday to Saturday, so your booking page offers none of their times on a Monday — no matter what your business hours say. Two people with different days means two different sets of available slots, and a client picking a person picks their availability with them.",
  },
  {
    targetId: "staff-search",
    title: "Archive when someone leaves",
    description: "Archiving takes them off your booking page and frees their seat, without touching the bookings they already took. That keeps last month's revenue reports honest.",
  },
];

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
    description: "How much notice you need. Set the window for online cancellations and reschedules, and anything inside it has to come through you instead — which is what stops a client moving a 9am appointment at 8:55.",
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
    description: "Invite people to log in and choose what each of them can see — bookings, clients, payments, reports, settings. Separate from Staff: this is about access to the dashboard, not about who clients can book.",
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
    title: "Who your confirmations come from",
    description: "By default they arrive from a Qwickly address, which works but doesn't look like you. Switching to your own domain means clients see your business in their inbox — and are far less likely to file it as spam.",
  },
  {
    targetId: "segment-custom",
    title: "It needs two DNS records",
    description: "Verifying a domain means adding a couple of records at whoever hosts it — the screen gives you the exact values to paste. It usually takes a few minutes to go through, and nothing breaks while you wait: emails keep sending from the Qwickly address until yours is verified.",
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
    description: "Track WhatsApp tokens, marketing emails, and staff seats against your plan's limits. Running low on any of them? Buy a top-up further down this page.",
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

// Booking Page builder walkthrough copy. Assembled inline in pages/booking-page.tsx
// (not exported as a plain array) because the final step's onAdvance needs to
// call that page's own setSelectedStep to bring the "Publish page" button into
// the DOM before spotlighting it — same reason billing.tsx assembles its own.
export const BOOKING_PAGE_STEP_COPY: Record<string, { title: string; description: string }> = {
  details: {
    title: "Content",
    description: "Your booking page's title, description, and the web address clients will visit.",
  },
  branding: {
    title: "Look",
    description: "Cover image, logo, colours, and the overall page style — everything about how it looks.",
  },
  services: {
    title: "Services & staff",
    description: "Choose exactly which services and staff members clients can see and book on this page.",
  },
  options: {
    title: "Booking options",
    description: "Decide whether clients pay a deposit up front, and whether they can reschedule themselves.",
  },
  share: {
    title: "Share",
    description: "Your public link and a QR code you can print or post.",
  },
  publishAction: {
    title: "Go live",
    description: "Once you're happy with the preview, publish it here — clients can't book until you do.",
  },
};

// Calendar walkthrough copy. Assembled inline in pages/calendar.tsx (not
// exported as a plain array) because the steps need onAdvance callbacks tied
// to that page's own viewMode/expandedDay state — same reason billing.tsx and
// booking-page.tsx assemble their own instead of using a plain export.
export const CALENDAR_STEP_COPY = {
  viewSelect: {
    title: "Day, Week, or Month",
    description: "Switch between views depending on how much of your schedule you want to see at once.",
  },
  demoDay: {
    title: "Click any day",
    description: "We've added a couple of sample bookings so you can see how this works — click a day to see everything booked on it.",
  },
  daySummary: {
    title: "The full day, at a glance",
    description: "Every appointment for that day, in one list. Click any of them for full client details. Once clients start booking, this is where your real schedule shows up.",
  },
} as const;
