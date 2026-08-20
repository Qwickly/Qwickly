import type { CatalogService, CatalogStaff } from "@/types/catalog";

/**
 * Example rows shown only while a walkthrough is running.
 *
 * The services and staff tours used to wait for the business's genuinely first
 * service or staff member and then spotlight that — which meant they could only
 * teach you after you had already worked out how to do the thing, and, since
 * /onboarding creates both, meant they stopped firing entirely.
 *
 * These are the same trick the calendar tour has always used: build a plausible
 * row on the client, merge it into what the page renders, throw it away when the
 * tour ends. Nothing is written and nothing is fetched, so it behaves the same
 * on an account with no services and an account with forty — and unlike a real
 * row, an example can be chosen to carry the details worth explaining.
 *
 * The ids are prefixed `tour-demo-` so anything that keys off them (the card's
 * own data-tour-id, click handlers, the pager) is obviously looking at a
 * fixture rather than a record.
 */

const DEMO_CREATED_AT = "2026-01-01T09:00:00.000Z";

export const TOUR_DEMO_SERVICE_ID = "tour-demo-service";
export const TOUR_DEMO_STAFF_ID = "tour-demo-staff";

/**
 * Deliberately a 45-minute service at a middling price with a deposit on it:
 * duration and deposit are the two fields whose consequences happen somewhere
 * else — on the calendar, and at checkout — so they are the two the tour has
 * something to say about.
 */
export const TOUR_DEMO_SERVICE: CatalogService = {
  id: TOUR_DEMO_SERVICE_ID,
  name: "Example — Full appointment",
  description: "A sample service, shown only during this walkthrough. It is not saved to your account.",
  price: 350,
  duration: 45,
  icon: "sparkles",
  color: "#24a374",
  isActive: true,
  depositRequired: true,
  depositAmount: 100,
  createdAt: DEMO_CREATED_AT,
};

export const TOUR_DEMO_STAFF: CatalogStaff = {
  id: TOUR_DEMO_STAFF_ID,
  name: "Example — Sam Dlamini",
  position: "Stylist",
  email: null,
  phone: null,
  avatarUrl: null,
  isActive: true,
  // Tuesday to Saturday rather than the default working week: the tour's point
  // is that these days decide which slots the public page offers, and a row
  // that matched the default would have nothing to demonstrate.
  workingDays: ["tuesday", "wednesday", "thursday", "friday", "saturday"],
  upcomingBookings: 6,
  revenueGenerated: 4200,
  completedBookings: 38,
  createdAt: DEMO_CREATED_AT,
};
