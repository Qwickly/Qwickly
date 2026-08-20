/**
 * Starter services, keyed off whatever the business typed as its industry.
 *
 * The industry question is free text with suggestions, not a fixed list — a
 * mobile nail tech and a physiotherapist both need to be able to answer it. So
 * matching is on keywords found anywhere in the answer rather than on an exact
 * value, and anything unrecognised gets a neutral set that is still faster to
 * edit than an empty form.
 *
 * These are opening offers, not a price list: every row is editable before it
 * is saved, and nothing is created until the user moves on from the step.
 * Prices are ZAR, durations are minutes.
 */

export type SeedService = {
  name: string;
  duration: number;
  price: number;
};

type SeedGroup = {
  /** Lowercase fragments matched against the typed industry. */
  keywords: string[];
  services: SeedService[];
};

const SEED_GROUPS: SeedGroup[] = [
  {
    keywords: ["barber", "barbershop", "grooming"],
    services: [
      { name: "Haircut", duration: 30, price: 150 },
      { name: "Beard trim", duration: 20, price: 90 },
      { name: "Cut & beard", duration: 45, price: 220 },
      { name: "Kids cut", duration: 30, price: 110 },
    ],
  },
  {
    keywords: ["hair", "salon", "stylist", "braid", "dread", "weave"],
    services: [
      { name: "Cut & blow-dry", duration: 60, price: 350 },
      { name: "Blow-dry", duration: 30, price: 180 },
      { name: "Colour", duration: 120, price: 850 },
      { name: "Treatment", duration: 45, price: 300 },
    ],
  },
  {
    keywords: ["nail", "manicure", "pedicure", "gel", "acrylic"],
    services: [
      { name: "Gel manicure", duration: 60, price: 280 },
      { name: "Gel pedicure", duration: 60, price: 320 },
      { name: "Acrylic full set", duration: 90, price: 450 },
      { name: "Soak-off & refresh", duration: 30, price: 120 },
    ],
  },
  {
    keywords: ["beauty", "spa", "massage", "facial", "lash", "brow", "wax", "aesthet"],
    services: [
      { name: "Facial", duration: 60, price: 450 },
      { name: "Full body massage", duration: 60, price: 550 },
      { name: "Waxing", duration: 30, price: 200 },
      { name: "Lash extensions", duration: 90, price: 650 },
    ],
  },
  {
    keywords: ["tutor", "education", "lesson", "teach", "school", "coach", "music", "driving"],
    services: [
      { name: "One-hour lesson", duration: 60, price: 250 },
      { name: "Ninety-minute lesson", duration: 90, price: 350 },
      { name: "Assessment", duration: 45, price: 200 },
    ],
  },
  {
    keywords: ["mechanic", "motor", "auto", "car", "vehicle", "panel", "tyre"],
    services: [
      { name: "Vehicle inspection", duration: 60, price: 450 },
      { name: "Minor service", duration: 120, price: 1200 },
      { name: "Major service", duration: 180, price: 2500 },
      { name: "Diagnostics", duration: 45, price: 550 },
    ],
  },
  {
    keywords: ["consult", "advis", "account", "legal", "attorney", "bookkeep", "financ"],
    services: [
      { name: "Intro call", duration: 30, price: 0 },
      { name: "Consultation", duration: 60, price: 850 },
      { name: "Strategy session", duration: 90, price: 1500 },
    ],
  },
  {
    keywords: ["photo", "video", "film", "content", "studio"],
    services: [
      { name: "Portrait session", duration: 60, price: 1200 },
      { name: "Family shoot", duration: 90, price: 1800 },
      { name: "Event coverage", duration: 180, price: 3500 },
    ],
  },
  {
    keywords: ["train", "fitness", "gym", "pilates", "yoga", "physio", "biokinet"],
    services: [
      { name: "Single session", duration: 60, price: 300 },
      { name: "Fitness assessment", duration: 45, price: 250 },
      { name: "Follow-up session", duration: 45, price: 250 },
    ],
  },
  {
    keywords: ["dent", "doctor", "medical", "clinic", "chiro", "optom", "health"],
    services: [
      { name: "Check-up", duration: 30, price: 650 },
      { name: "Cleaning", duration: 45, price: 850 },
      { name: "Follow-up", duration: 30, price: 450 },
    ],
  },
  {
    keywords: ["market", "design", "agency", "brand", "web", "software"],
    services: [
      { name: "Discovery call", duration: 30, price: 0 },
      { name: "Strategy session", duration: 60, price: 1500 },
      { name: "Monthly review", duration: 60, price: 1200 },
    ],
  },
];

/** Used when the typed industry matches nothing above, and as the empty-state. */
export const GENERIC_SEED_SERVICES: SeedService[] = [
  { name: "Standard appointment", duration: 60, price: 350 },
  { name: "Extended appointment", duration: 90, price: 500 },
  { name: "Quick consultation", duration: 30, price: 200 },
];

export function seedServicesForIndustry(industry: string): SeedService[] {
  const value = industry.trim().toLowerCase();
  if (!value) return GENERIC_SEED_SERVICES;

  const group = SEED_GROUPS.find((candidate) =>
    candidate.keywords.some((keyword) => value.includes(keyword)),
  );
  return group ? group.services : GENERIC_SEED_SERVICES;
}

/**
 * What to call the one bookable person, in the language of the trade. Only used
 * as a default in the field — the user can type anything.
 */
export function seedStaffRoleForIndustry(industry: string): string {
  const value = industry.trim().toLowerCase();
  if (value.includes("barber")) return "Barber";
  if (value.includes("nail")) return "Nail technician";
  if (value.includes("hair") || value.includes("salon")) return "Stylist";
  if (value.includes("spa") || value.includes("beauty") || value.includes("massage")) return "Therapist";
  if (value.includes("tutor") || value.includes("teach") || value.includes("lesson")) return "Tutor";
  if (value.includes("mechanic") || value.includes("auto") || value.includes("motor")) return "Technician";
  if (value.includes("train") || value.includes("fitness") || value.includes("coach")) return "Trainer";
  if (value.includes("photo") || value.includes("video")) return "Photographer";
  return "Owner";
}
