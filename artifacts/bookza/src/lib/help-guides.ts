/**
 * Written guides, for the parts of the product a spotlight cannot explain.
 *
 * A tour is good at "this control does that" and bad at anything with more than
 * one moving part — why a slot is missing from the booking page, when a token
 * gets spent, what the assistant is allowed to do on its own. Those are the
 * questions that actually generate support messages, and they need paragraphs.
 *
 * Kept as data rather than JSX so the guides can be searched, counted and
 * eventually moved somewhere else without rewriting a page.
 */

export type GuideSection = {
  heading?: string;
  /** Paragraphs. Each renders as its own <p>. */
  body: string[];
  /** Optional bullet list, rendered after the paragraphs. */
  points?: string[];
};

export type GuideTopic =
  | "Bookings"
  | "Clients"
  | "Money"
  | "WhatsApp"
  | "Your page"
  | "Account";

export type Guide = {
  id: string;
  title: string;
  /** One line, shown on the card. */
  summary: string;
  /** Rough read time in minutes, for the card. */
  minutes: number;
  topic: GuideTopic;
  /**
   * Extra words to match on. The title and summary are searched too — this is
   * for the phrasing a worried business owner actually types, which is rarely
   * the phrasing a feature is documented under ("didn't show up", "double
   * booked", "charged twice").
   */
  keywords: string[];
  sections: GuideSection[];
};

export const GUIDE_TOPICS: GuideTopic[] = [
  "Bookings",
  "Clients",
  "Money",
  "WhatsApp",
  "Your page",
  "Account",
];

export const GUIDES: Guide[] = [
  {
    id: "booking-statuses",
    title: "Pending, confirmed, no-show: what each status does",
    summary:
      "A status isn't a label — it decides whether the slot is held and whether reminders go out.",
    minutes: 2,
    topic: "Bookings",
    keywords: ["pending", "confirmed", "cancelled", "no show", "status", "accept", "decline"],
    sections: [
      {
        body: [
          "Every booking carries a status, and each one changes what the rest of the product does. They are not just colours on the calendar.",
        ],
      },
      {
        heading: "Pending",
        body: [
          "A client has asked for the slot; you have not accepted yet. The time is already blocked — nobody else can request it. This is deliberate: the alternative is two people asking for the same slot and you having to disappoint one of them.",
          "Reminders do not go out for a pending booking. It is a request, and reminding someone about an appointment you have not agreed to is worse than saying nothing.",
        ],
      },
      {
        heading: "Confirmed",
        body: [
          "You have accepted. The slot stays blocked and the reminder schedule starts — confirmation now, then the reminders you have switched on in Settings › Notifications.",
        ],
      },
      {
        heading: "Cancelled",
        body: [
          "The slot is released immediately and becomes bookable again. No further reminders. The booking stays in your history and in your reports, which is what you want when you are looking at how often this happens.",
        ],
      },
      {
        heading: "Completed",
        body: [
          "The appointment happened. Counts towards the client's history, their lifetime spend, and the staff member's numbers.",
        ],
      },
      {
        heading: "No-show",
        body: [
          "They did not arrive. Mark it rather than deleting it: a deleted booking is a booking that never happened, and a client with two no-shows on file gets flagged as a risk in your client list. That flag is only as good as the marking.",
        ],
      },
    ],
  },
  {
    id: "reminders",
    title: "Which messages send automatically, and when",
    summary:
      "Confirmations, 24-hour and 2-hour reminders, and how the product decides whether to use WhatsApp or email.",
    minutes: 3,
    topic: "Clients",
    keywords: ["reminder", "confirmation", "notification", "sms", "email", "didn't get", "not sent"],
    sections: [
      {
        body: [
          "Switch these on in Settings › Notifications. Once on, they send on their own — there is nothing to trigger and nothing to remember.",
        ],
      },
      {
        heading: "The schedule",
        body: [
          "A confirmation goes out as soon as a booking is confirmed. A reminder goes 24 hours before, and another 2 hours before. Each is a separate switch, so you can run only the ones that suit how far ahead your clients book.",
          "Cancellations and reschedules send their own message the moment they happen, so a client is never left holding a time that has moved.",
        ],
      },
      {
        heading: "WhatsApp or email",
        body: [
          "The product picks per client, and it is not a preference — it is a reachability rule. WhatsApp can only be used for someone who has messaged your number first; that is a platform restriction, not ours. Anyone else gets email.",
          "This is why an email address on a client record matters even for a business that lives on WhatsApp: it is the fallback for everyone who has not messaged you yet.",
        ],
      },
      {
        heading: "If a client says they got nothing",
        body: [
          "Check the client has an email address, or has messaged your WhatsApp number. A client with neither is unreachable, and no setting will change that.",
          "Then check the event is switched on. The switches are per-event, and turning off the 2-hour reminder does not turn off the 24-hour one.",
        ],
      },
    ],
  },
  {
    id: "staff-vs-team",
    title: "Staff and Team are two different lists",
    summary:
      "One is who clients can book. The other is who can log in. Most people only need the first.",
    minutes: 2,
    topic: "Account",
    keywords: ["staff", "team", "login", "permissions", "seat", "invite", "access", "roles"],
    sections: [
      {
        body: [
          "This trips almost everybody up once, because most products only have one of these.",
        ],
      },
      {
        heading: "Staff — who clients can book",
        body: [
          "Everyone on the Staff page gets a calendar, their own working days, and a place on your booking page. Adding someone here is what lets a client choose between people when they book.",
          "Each of them uses a seat, and your plan includes one. Extra seats are an add-on in Billing.",
        ],
      },
      {
        heading: "Team — who can log in",
        body: [
          "Settings › Team is about access to this dashboard: who can see clients, payments, reports and settings. A receptionist who books people in but never takes appointments belongs here and not on the Staff page.",
          "Team members do not use staff seats. Someone can be on both lists if they both take bookings and need to log in.",
        ],
      },
      {
        heading: "The short version",
        body: [
          "If a client should be able to pick their name, they go on Staff. If they need to see the dashboard, they go on Team.",
        ],
      },
    ],
  },
  {
    id: "cancellation-window",
    title: "Setting how much notice you need",
    summary:
      "What the cancellation and reschedule windows actually stop, and what happens when a client is too late.",
    minutes: 2,
    topic: "Bookings",
    keywords: ["cancel", "reschedule", "notice", "window", "policy", "last minute", "change booking"],
    sections: [
      {
        body: [
          "Settings › Booking has two windows: how much notice you need for a cancellation, and how much for a reschedule. They can be different, and often should be — moving an appointment costs you far less than losing it.",
        ],
      },
      {
        heading: "What they control",
        body: [
          "Both windows govern what a client can do on their own — through the link in their confirmation, or by asking the WhatsApp assistant. Inside the window, the client is told no and pointed at you.",
          "Neither window restricts you. You can move or cancel anything from the dashboard at any time.",
        ],
      },
      {
        heading: "What the client is told",
        body: [
          "You write the wording. A refusal in your own voice — with what you would like them to do instead — reads very differently to a flat error, and it is the message clients see most often when they are already anxious about being late.",
        ],
      },
      {
        heading: "Turning them off",
        body: [
          "Set either window to zero and clients can cancel or move right up to the appointment. Fine for a business with a waiting list; expensive for one without.",
        ],
      },
    ],
  },
  {
    id: "booking-page-link",
    title: "Your booking page link, and where to put it",
    summary:
      "One link does the whole job. Changing prices or hours never means re-sharing it.",
    minutes: 2,
    topic: "Your page",
    keywords: ["link", "url", "share", "instagram", "bio", "slug", "website", "publish"],
    sections: [
      {
        body: [
          "Your booking page lives at its own address, and everything on it is read live from your account. Change a price, archive a service, adjust your hours — the page follows, immediately. There is nothing to publish again and no reason to re-share the link.",
        ],
      },
      {
        heading: "Where it earns its keep",
        body: [
          "The Instagram or Facebook bio link, your WhatsApp business profile, your email signature, and the reply you send when someone asks whether you're free on Saturday. That last one converts best: a link is a booking, a conversation is a maybe.",
        ],
      },
      {
        heading: "One page at a time",
        body: [
          "A business publishes one page. You can build others and keep them as drafts, but publishing one takes the current one down — so the link you have shared is always the link that works.",
        ],
      },
      {
        heading: "If it looks empty",
        body: [
          "A page with no active services, or no open days, has nothing to offer and will say so. See the guide on why a time isn't showing.",
        ],
      },
    ],
  },
  {
    id: "client-records",
    title: "Where clients come from, and why duplicates happen",
    summary:
      "Clients are created automatically from three directions. Here's how they get matched up.",
    minutes: 2,
    topic: "Clients",
    keywords: ["duplicate", "client", "crm", "merge", "same person", "twice", "contact"],
    sections: [
      {
        body: [
          "You rarely add a client by hand. They arrive from your booking page, from a WhatsApp message, or from you creating a booking on the dashboard — and the product tries to recognise someone it has seen before rather than making a second record.",
        ],
      },
      {
        heading: "How matching works",
        body: [
          "Phone number first, because it is the one thing that is the same across all three routes. Someone who books online and later messages your WhatsApp lands on the same record, with both histories on it.",
        ],
      },
      {
        heading: "Why you might still see two",
        body: [
          "Different phone formats are the usual cause — the same number written with and without the country code reads as two people. Booking under a nickname does not create a duplicate; a different number does.",
        ],
      },
      {
        heading: "What a client record is worth",
        body: [
          "Lifetime spend, every past booking, and the no-show count that flags someone as a risk. All of it is only accurate if the bookings are on one record, which is worth a minute of tidying when you spot a pair.",
        ],
      },
    ],
  },
  {
    id: "available-times",
    title: "Why a time isn't showing on your booking page",
    summary:
      "Four separate settings decide whether a slot is offered. This is the order they're applied in.",
    minutes: 3,
    topic: "Your page",
    keywords: ["no times", "empty", "not showing", "availability", "slots", "missing", "unavailable"],
    sections: [
      {
        body: [
          "Your public booking page never shows a raw calendar. It works out, for the service and person a client picked, which start times are genuinely available — and it has to agree with four different settings before it offers one.",
          "When a client says a time isn't there, it is almost always one of these, checked in this order.",
        ],
      },
      {
        heading: "1. Your business hours",
        body: [
          "Set in Settings › Booking. Nothing outside these is ever offered, on any day, for anyone. A brand-new business starts with every day closed, so if your page is showing no times at all, start here.",
        ],
      },
      {
        heading: "2. That person's working days",
        body: [
          "Each staff member has their own days and hours, set on their profile. These narrow your business hours — they never widen them. Someone who works Tuesday to Saturday offers nothing on a Monday even if the business is open, and someone whose day ends at 15:00 offers nothing after that even if you close at 18:00.",
          "If a client can pick which person they see, they are picking that person's availability along with them. Two people with different days genuinely produce two different sets of times.",
        ],
      },
      {
        heading: "3. The service's duration",
        body: [
          "A slot only appears if the whole appointment fits before the end of the working day. A 90-minute service against a day that ends at 17:00 stops being offered after 15:30 — which is correct, and is the usual reason a page looks emptier for long services than short ones.",
        ],
      },
      {
        heading: "4. Bookings already on the calendar",
        body: [
          "Anything pending or confirmed blocks its slot. Pending counts: a request that has not been accepted yet still holds the time, so two clients can't ask for the same slot and leave you to disappoint one of them.",
          "Cancelled and no-show bookings release the time straight away.",
        ],
      },
      {
        heading: "If it still looks wrong",
        body: [
          "Check the staff member is active. An archived person is off the booking page entirely, along with every time they would have offered — which is the right behaviour when someone leaves, and a confusing one if they were archived by accident.",
        ],
      },
    ],
  },
  {
    id: "deposits",
    title: "Deposits, and what they actually do about no-shows",
    summary:
      "How a deposit is charged, what happens if a client doesn't pay it, and when to ask for one.",
    minutes: 2,
    topic: "Money",
    keywords: ["deposit", "no-show", "noshow", "didn't turn up", "prepay", "upfront", "payfast"],
    sections: [
      {
        body: [
          "A deposit is set per service, not per business. That matters: you can ask for one on the two-hour appointment that costs you the afternoon and skip it on the twenty-minute one, which is usually the right shape.",
        ],
      },
      {
        heading: "When it's taken",
        body: [
          "At the moment of booking, through PayFast, before the booking is confirmed. Not on arrival, and not on a card kept on file — Qwickly does not store client cards.",
          "A client who abandons the payment screen does not get the slot. The time is released and stays bookable.",
        ],
      },
      {
        heading: "Why it works",
        body: [
          "A no-show costs you the slot and the revenue. A deposit converts most of that into a decision the client has to make with their card in their hand, at the point where changing their mind is still free for you.",
          "It also filters. People who were never going to come mostly do not pay a deposit, and you find that out days early instead of at 10am on the day.",
        ],
      },
      {
        heading: "What it isn't",
        body: [
          "It isn't a cancellation policy. Set how much notice you need in Settings › Booking — that decides whether a client can move or cancel the appointment themselves, and what they're told when they try to do it too late.",
        ],
      },
    ],
  },
  {
    id: "whatsapp-assistant",
    title: "What the WhatsApp assistant will and won't do",
    summary:
      "The assistant can book, cancel and reschedule on its own. Here's exactly where its limits are.",
    minutes: 3,
    topic: "WhatsApp",
    keywords: ["bot", "ai", "assistant", "auto reply", "chatbot", "answers"],
    sections: [
      {
        body: [
          "When someone messages your connected WhatsApp number, the assistant reads the conversation, works out what they want, and either answers or acts. It is not a keyword menu — a client can write like a person and it will follow.",
        ],
      },
      {
        heading: "What it can do on its own",
        body: [
          "Check availability against everything on your booking page, take a booking, cancel one, move one, and answer questions from the FAQs you have written for it.",
          "It creates a client record for a number it hasn't seen before, so someone who books over WhatsApp still lands in your client list with their history attached.",
        ],
      },
      {
        heading: "What it will not do",
        body: [
          "It only books the services you have allowed it to book — set per service, so anything that needs a conversation first can be kept off the list.",
          "It respects your cancellation and reschedule notice. A client asking to move a booking inside your notice window is told no, in wording you control, rather than being quietly allowed to.",
          "It never invents an appointment. If it cannot complete the booking, it says so instead of confirming something that did not happen.",
        ],
      },
      {
        heading: "Two-step replies",
        body: [
          "By default the assistant drafts its reply and waits for you to approve it before anything reaches the client. That is the right setting while you are learning what it sounds like.",
          "Turn it off in WhatsApp › Bot Setup once you trust it, and replies go out immediately. You can turn it back on at any point without losing anything.",
        ],
      },
      {
        heading: "Working hours",
        body: [
          "The assistant can run around the clock or only during your business hours. Outside its window it holds off entirely rather than replying — so a message at midnight waits for you rather than getting an automated answer at midnight.",
        ],
      },
    ],
  },
  {
    id: "tokens-and-allowances",
    title: "Tokens, marketing emails, and what actually gets counted",
    summary:
      "Reminders and confirmations are free. Only campaigns spend anything — this is how the counting works.",
    minutes: 2,
    topic: "Money",
    keywords: ["tokens", "credits", "allowance", "quota", "ran out", "limit", "campaign cost"],
    sections: [
      {
        body: [
          "The two numbers on your Billing page — WhatsApp tokens and marketing emails — only ever move when you send a campaign. Everything the product sends on your behalf is free and uncounted.",
        ],
      },
      {
        heading: "Free, always",
        body: [
          "Booking confirmations, reminders, cancellation notices, reschedule notices, and every reply the WhatsApp assistant sends. These are part of running the business, not marketing, and your plan covers them without limit.",
        ],
      },
      {
        heading: "What spends",
        body: [
          "Campaigns. Sending a WhatsApp campaign to a client spends tokens; sending an email campaign spends marketing emails. One recipient, one send.",
        ],
      },
      {
        heading: "Allowance versus top-up",
        body: [
          "Your plan includes an allowance that resets at the start of each billing cycle — unused allowance does not roll over. Top-ups are bought separately, do not expire while you stay subscribed, and are only drawn on once the cycle's allowance is used up.",
          "The Billing page shows both together, with the split underneath each bar, so you can see which part of the number is about to reset.",
        ],
      },
    ],
  },
];

export function findGuide(id: string): Guide | undefined {
  return GUIDES.find((guide) => guide.id === id);
}

/**
 * Matches on the title, the summary and the keywords — not on the body.
 *
 * Searching the article text sounds more thorough and reads worse: a word that
 * appears once in a passing sentence scores the same as one in the title, so a
 * search for "deposit" returns every guide that happens to mention deposits
 * rather than the guide about deposits. The keywords carry the phrasing someone
 * actually types instead.
 */
export function searchGuides(query: string, topic: GuideTopic | null): Guide[] {
  const q = query.trim().toLowerCase();

  return GUIDES.filter((guide) => {
    if (topic && guide.topic !== topic) return false;
    if (!q) return true;
    return [guide.title, guide.summary, guide.topic, ...guide.keywords]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
}
