/**
 * Marketing mockup video recorder.
 * ────────────────────────────────
 * Records chrome-free, viewport-only product videos by driving the REAL running
 * app with Playwright, then converts each to a web-optimised mp4 in
 * artifacts/bookza/public/videos/. A fake cursor is drawn on-screen; initial
 * load spinners are auto-trimmed (each flow calls ctx.markReady() when its first
 * screen is up).
 *
 * Output files (new names — they do NOT overwrite the existing videoMockup*.mp4;
 * point the marketing index.html <video src> at these to use them):
 *   videoBookingFlow      portrait  public booking → confirmation
 *   videoDashboard        desktop   dashboard KPIs/charts → week calendar
 *   videoBookingsClients  desktop   bookings table + search → client CRM
 *   videoCampaigns        portrait  campaign setup → message → audience → send
 *   videoWhatsappApproval portrait  inbound msg → AI draft (Approve & send)
 *   videoWhatsappAuto     portrait  1-step chatbot replying automatically
 *
 * Full workflow:
 *   pnpm mockups:seed          create the demo business "Glow Beauty Studio"
 *   pnpm dev                   start api + web (needed to record)
 *   pnpm mockups:auth          save the demo login (storageState)
 *   pnpm mockups:record        record all   |   pnpm mockups:record booking auto
 *   pnpm mockups:teardown      remove the demo business when done
 *
 * Notes:
 *   - Needs ffmpeg on PATH and api-server/.env.local (Supabase service key).
 *   - The FIRST authed record after an api-server restart can be slow (cold
 *     start) and may hit the content-wait timeout — just run it again warm.
 *   - The WhatsApp flows feed canned data via request interception and drive
 *     message reveals through the dev-only window.__mockupQueryClient hook, so
 *     they need no connected WhatsApp number.
 *   - Demo identity + viewports live in env.ts; per-flow scripting is below.
 *
 * Flow names: booking · dashboard · bookings · campaigns · whatsapp-approval · whatsapp-auto
 */
import type { Page, Route } from "playwright";
import { DEMO, WEB_URL } from "./env";
import { DESKTOP, PHONE, record, ui, goto, forceRefetch } from "./record";

/** Run an optional, non-critical step; never let it abort the recording. */
async function soft(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.log(`   (skipped: ${label} — ${err instanceof Error ? err.message : err})`);
  }
}

// ── Flow 1: public booking (mobile-first, no auth) ──────────────────────────

const timeSlot = (page: Page) =>
  page.getByRole("button").filter({ hasText: /^\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*$/i });

/**
 * Click through selectable future days until one actually has open time slots,
 * then return with slots visible. Availability varies by staff working days and
 * existing bookings, so we can't assume the first open day has room.
 */
async function pickDayWithSlots(page: Page) {
  const todayNum = new Date().getDate();

  for (let month = 0; month < 2; month++) {
    const days = page.locator(`.grid.grid-cols-7 button:not([disabled])`);
    const count = await days.count();
    for (let i = 0; i < count; i++) {
      const label = (await days.nth(i).innerText()).trim();
      const n = parseInt(label, 10);
      if (!Number.isFinite(n)) continue;
      if (month === 0 && n <= todayNum) continue; // future days only

      await days.nth(i).scrollIntoViewIfNeeded();
      await page.mouse.move(200, 380, { steps: 8 });
      await days.nth(i).click();

      // Give the slot RPC a moment; accept the day if any slot renders.
      try {
        await timeSlot(page).first().waitFor({ state: "visible", timeout: 6000 });
        return;
      } catch {
        /* fully booked / staff off — try the next day */
      }
    }
    await soft("next month", () => page.getByRole("button", { name: /next month/i }).click());
    await page.waitForTimeout(600);
  }
  throw new Error("no day with available slots found");
}

type Ctx = { markReady: () => void };

async function bookingFlow(page: Page, { markReady }: Ctx) {
  await goto(page, `/book/${DEMO.slug}`);
  await page.getByText("Balayage & Gloss").first().waitFor({ state: "visible", timeout: 25000 });
  markReady();
  await ui.wait(page, 1200);

  // Step 1 — choose a service.
  await ui.click(page, `text=Balayage & Gloss`, { settle: 700 });

  // Smoothly scroll down to the staff section instead of teleporting there.
  await ui.smoothTo(page, `text=Aisha Patel`);
  await ui.wait(page, 400);
  await soft("select staff", () => ui.click(page, `text=Aisha Patel`, { settle: 700 }));

  // Continue to the calendar.
  await ui.click(page, `button:has-text("Continue")`, { settle: 1100 });

  // Step 2 — pick a date that has availability, then a time slot.
  await pickDayWithSlots(page);
  await ui.wait(page, 900);
  const slot = timeSlot(page).first();
  await slot.scrollIntoViewIfNeeded();
  await slot.click();
  await ui.wait(page, 700);
  await ui.click(page, `button:has-text("Continue")`, { settle: 900 });

  // Step 3 — details, then submit. Email is required on this form.
  await ui.type(page, `input[placeholder="Jane Doe"]`, "Sipho Ndlovu");
  await ui.type(page, `input[placeholder="071 234 5678"]`, "071 555 0142");
  await ui.type(page, `input[placeholder="jane@email.com"]`, "sipho@example.co.za");
  await ui.wait(page, 500);
  await ui.click(page, `button:has-text("Make booking")`, { settle: 500 });

  // Land on the confirmation screen.
  await ui.wait(page, 3500);
}

// ── Flow 2: dashboard + calendar (desktop, authed) ──────────────────────────

async function dashboardFlow(page: Page, { markReady }: Ctx) {
  await goto(page, `/dashboard`);
  // Wait past the entitlements spinner + KPI load before filming movement.
  await page.getByText(/Revenue pulse/i).waitFor({ state: "visible", timeout: 25000 });
  markReady();
  await ui.wait(page, 1800); // cards + charts settle
  await ui.scroll(page, 420); // popular services + activity feed
  await ui.wait(page, 1600);
  await ui.scroll(page, -420);
  await ui.wait(page, 800);

  await goto(page, `/calendar`);
  await page.getByText(/Balayage & Gloss|Signature Cut|Gel Manicure/).first().waitFor({ state: "visible", timeout: 20000 });
  await ui.wait(page, 2200); // week grid full of colour-coded bookings
  // Open a booking block to reveal the detail dialog.
  await soft("open a booking block", async () => {
    await page.getByText("Zanele Khumalo").first().click({ timeout: 4000 });
    await ui.wait(page, 2400);
  });
}

// ── Flow 3: bookings + clients (desktop, authed) ────────────────────────────

async function bookingsFlow(page: Page, { markReady }: Ctx) {
  await goto(page, `/bookings`);
  await page.locator(`input[placeholder^="Search by client"]`).waitFor({ state: "visible", timeout: 25000 });
  markReady();
  await ui.wait(page, 1400);
  await ui.type(page, `input[placeholder^="Search by client"]`, "Naledi");
  await ui.wait(page, 1600);
  await soft("clear search", async () => {
    await page.locator(`input[placeholder^="Search by client"]`).fill("");
    await ui.wait(page, 900);
  });
  await ui.scroll(page, 320);
  await ui.wait(page, 1200);

  await goto(page, `/clients`);
  await ui.wait(page, 1800);
  await ui.type(page, `input[placeholder^="Search by name"]`, "Zanele");
  await ui.wait(page, 1500);
  await soft("open client card", async () => {
    await page.getByText("Zanele Khumalo").first().click({ timeout: 4000 });
    await ui.wait(page, 2200);
  });
}

// ── Flow 4: campaigns (portrait, authed) ────────────────────────────────────

async function campaignsFlow(page: Page, { markReady }: Ctx) {
  await page.route("**/api/whatsapp/campaigns/send", async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, totalRecipients: 14, sent: 14, failed: 0 }),
    });
  });

  await goto(page, `/marketing`);
  await page.getByRole("button", { name: /Create campaign/i }).waitFor({ state: "visible", timeout: 25000 });
  markReady();
  // Keep the intro tight: a short beat, then glide straight to the CTA. The old
  // scroll-in/out intro read as dead air because the fake cursor only tracks
  // mousemove (not wheel), so it stayed off-screen while the page scrolled.
  await ui.wait(page, 700);

  await ui.click(page, `button:has-text("Create campaign")`, { settle: 900 });
  await page.getByText("Campaign setup").waitFor({ state: "visible", timeout: 10000 });
  await ui.type(page, `input[placeholder="e.g. Summer Promo 2026"]`, "Winter Glow-Back Offer");
  await ui.wait(page, 700);
  await ui.click(page, `[role="dialog"] button:has-text("Next")`, { settle: 900 });

  await page.getByText("Message content").waitFor({ state: "visible", timeout: 10000 });
  await ui.type(
    page,
    `textarea[placeholder="Write a compelling message for your customers..."]`,
    "Hi {{first_name}}! Your winter glow-up is waiting. Book any colour or facial this week and get a complimentary treatment add-on. Reply GLOW and we'll help you choose a time.",
  );
  await ui.wait(page, 900);
  await ui.click(page, `[role="dialog"] button:has-text("Next")`, { settle: 900 });

  await page.getByText("Select audience").waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("button", { name: /Everyone|Send to everyone|Sending to everyone/i }).waitFor({ state: "visible", timeout: 15000 });
  await ui.click(page, `button:has-text("Everyone")`, { settle: 1000 });
  await page.getByText(/All \d+ clients will receive this campaign/i).waitFor({ state: "visible", timeout: 10000 });
  await ui.wait(page, 900);
  await ui.click(page, `[role="dialog"] button:has-text("Next")`, { settle: 900 });

  await page.getByText("Ready to send").waitFor({ state: "visible", timeout: 10000 });
  await ui.wait(page, 1600);
  await ui.click(page, `button:has-text("Send campaign")`, { settle: 1600 });
  // The list renders the name twice (responsive desktop/mobile variants); assert
  // on the one that's actually visible at this viewport, not the first in DOM.
  await page.getByText("Winter Glow-Back Offer").filter({ visible: true }).first().waitFor({ state: "visible", timeout: 15000 });
  await ui.wait(page, 2400);
}

// ── WhatsApp AI flows (mobile, authed + intercepted API) ────────────────────
//
// Both flows feed canned data via request interception and reveal messages on a
// scripted schedule — not the app's slow polling — through the dev-only
// window.__mockupQueryClient hook. New bubbles animate in on their own (the chat
// uses `animate-in slide-in-from-bottom`), so the effect reads as a live chat.

type WaMsg = { content: string; direction: "inbound" | "outbound"; isBot?: boolean };
type WaConversation = {
  id: number; clientId: number; clientName: string; clientPhone: string;
  lastMessage: string; lastMessageAt: string; unreadCount: number; isBot: boolean;
};

function iso(minsAgo: number): string {
  return new Date(Date.now() + minsAgo * 60_000).toISOString();
}

// Mutable simulation state, read by the route handlers.
const wa = {
  conversations: [] as WaConversation[],
  activeId: 1,
  script: [] as WaMsg[],
  reveal: 0, // number of script messages currently visible
  draft: null as Record<string, unknown> | null,
};

function waVisibleMessages() {
  const total = wa.script.length;
  return wa.script.slice(0, wa.reveal).map((m, i) => ({
    id: wa.activeId * 1000 + i,
    conversationId: wa.activeId,
    content: m.content,
    direction: m.direction,
    // Spaced ~a minute apart, ending "now", so they read as a recent live chat.
    timestamp: iso(-(total - i)),
    status: "read",
    isBot: m.isBot ?? false,
  }));
}

async function stubWhatsappApi(page: Page) {
  // Patch entitlements so the inbox + chatbot render (real payload, then tweaked).
  await page.route("**/api/entitlements**", async (route: Route) => {
    const res = await route.fetch();
    let body: any = {};
    try { body = await res.json(); } catch { /* keep {} */ }
    body.entitled = true;
    body.whatsappSession = true;
    body.grants = { ...(body.grants ?? {}), whatsapp_chatbot: true };
    await route.fulfill({ response: res, json: body });
  });

  await page.route("**/api/whatsapp/**", async (route: Route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (data: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

    // Approve/dismiss: brief delay so the button spinner reads on camera.
    if (/\/ai-drafts\/[^/]+\/(approve|dismiss)/.test(p)) {
      await new Promise((r) => setTimeout(r, 500));
      return json({ ok: true });
    }
    if (p.endsWith("/whatsapp/status")) {
      return json({ status: "connected", instanceId: "demo", qrCode: null, connectedPhone: "27821110000", updatedAt: iso(-1) });
    }
    if (p.endsWith("/whatsapp/ai-drafts")) {
      return json({ drafts: wa.draft ? [wa.draft] : [] });
    }
    if (/\/whatsapp\/conversations\/\d+\/messages/.test(p)) {
      if (req.method() === "POST") return json({ ok: true }); // manual send, unused
      return json(waVisibleMessages());
    }
    if (p.endsWith("/whatsapp/conversations")) {
      const last = wa.script[Math.max(0, wa.reveal - 1)];
      const convs = wa.conversations.map((c) =>
        c.id === wa.activeId && last
          ? { ...c, lastMessage: last.content, lastMessageAt: iso(0) }
          : c,
      );
      return json(convs);
    }
    return route.fallback();
  });
}

/** Wait, reveal the next scripted message, and refetch so it animates in. */
async function revealNext(page: Page, delayBefore: number) {
  await ui.wait(page, delayBefore);
  wa.reveal += 1;
  await forceRefetch(page, "whatsapp");
}

const WA_CONVERSATIONS: WaConversation[] = [
  { id: 1, clientId: 101, clientName: "Naledi Dlamini", clientPhone: "27823334001", lastMessage: "Hi! I'd love to book a balayage 😊", lastMessageAt: iso(-1), unreadCount: 1, isBot: true },
  { id: 2, clientId: 102, clientName: "Emma Botha", clientPhone: "27823334002", lastMessage: "Ideally to Saturday afternoon 🙏", lastMessageAt: iso(-2), unreadCount: 2, isBot: true },
  { id: 3, clientId: 103, clientName: "Zanele Khumalo", clientPhone: "27823334003", lastMessage: "Thank you so much!", lastMessageAt: iso(-140), unreadCount: 0, isBot: false },
  { id: 4, clientId: 104, clientName: "Sarah Nel", clientPhone: "27823334004", lastMessage: "Do you have anything on Friday morning?", lastMessageAt: iso(-260), unreadCount: 1, isBot: true },
];

async function openWhatsapp(page: Page, markReady: () => void, clientName: string) {
  await stubWhatsappApi(page);
  await goto(page, `/whatsapp`);
  await page.getByText(clientName).first().waitFor({ state: "visible", timeout: 25000 });
  markReady();
  await ui.wait(page, 1500); // inbox reads on camera
  await page.getByText(clientName).first().click({ timeout: 8000 });
  await ui.wait(page, 1400); // thread opens with the first message
}

// 1-step chatbot: the AI answers automatically, no human in the loop.
async function whatsappAutoFlow(page: Page, { markReady }: Ctx) {
  wa.conversations = WA_CONVERSATIONS;
  wa.activeId = 1;
  wa.draft = null;
  wa.script = [
    { content: "Hi! I'd love to book a balayage 😊", direction: "inbound" },
    { content: "Hi Naledi! 💚 Our Balayage & Gloss is 2h30 with Thandi or Aisha. Which day suits you?", direction: "outbound", isBot: true },
    { content: "Saturday with Aisha please", direction: "inbound" },
    { content: "Aisha has 9:30am open this Saturday — shall I book it? ✨", direction: "outbound", isBot: true },
    { content: "Yes please!", direction: "inbound" },
    { content: "All done ✅ Balayage & Gloss with Aisha, Sat 9:30am. I'll send a reminder the day before 💚", direction: "outbound", isBot: true },
  ];
  wa.reveal = 1; // customer's opener is already showing when the chat opens

  await openWhatsapp(page, markReady, "Naledi Dlamini");

  await revealNext(page, 1500); // bot answers automatically
  await revealNext(page, 2000); // customer
  await revealNext(page, 1400); // bot
  await revealNext(page, 1900); // customer confirms
  await revealNext(page, 1400); // bot confirmation
  await ui.wait(page, 2600);
}

// 2-step approval: the AI drafts a reply, the owner approves before it sends.
async function whatsappApprovalFlow(page: Page, { markReady }: Ctx) {
  wa.conversations = WA_CONVERSATIONS;
  wa.activeId = 2;
  wa.draft = null;
  wa.script = [
    { content: "Hi, can I move my Friday appointment?", direction: "inbound" },
    { content: "Ideally to Saturday afternoon 🙏", direction: "inbound" },
  ];
  wa.reveal = 1;

  await openWhatsapp(page, markReady, "Emma Botha");
  await revealNext(page, 1600); // her second message

  // The AI proposes a reply — the "Pending AI reply" card appears.
  await ui.wait(page, 1300);
  wa.draft = {
    id: "draft-1",
    remoteJid: "27823334002@c.us",
    clientId: null,
    clientName: "Emma Botha",
    clientPhone: "27823334002",
    inboundMessageText: "Ideally to Saturday afternoon",
    suggestedReply:
      "Of course, Emma! I can move your Gel Manicure to Saturday at 2:00pm with Lerato. Shall I confirm? 💚",
    proposedActions: [{ type: "reschedule", service: "Gel Manicure", to: "Saturday 14:00" }],
    status: "pending",
    createdAt: iso(0),
  };
  await forceRefetch(page, "whatsapp-ai-drafts");
  await ui.wait(page, 1200);

  // Feature the in-chat "Pending AI reply" card (the one that pops up inside the
  // thread), not the "Pending AI replies" table at the top of the page.
  await soft("scroll to in-chat draft", () =>
    ui.smoothTo(page, `text="Pending AI reply"`, "center"),
  );
  await ui.wait(page, 2400); // the in-chat approve/dismiss card reads on camera

  // Owner approves from the in-chat card — the reply sends into the thread.
  // The in-chat button is the LAST "Approve & send" in the DOM (the table's
  // buttons render earlier, up the page).
  await soft("approve draft", async () => {
    const approve = page
      .getByRole("button", { name: /Approve & send/i })
      .filter({ visible: true })
      .last();
    const box = await approve.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    await page.waitForTimeout(300);
    await approve.click({ timeout: 6000 });
  });
  wa.draft = null;
  wa.script.push({
    content:
      "Of course, Emma! I can move your Gel Manicure to Saturday at 2:00pm with Lerato. Shall I confirm? 💚",
    direction: "outbound",
    isBot: true,
  });
  wa.reveal = wa.script.length;
  await ui.wait(page, 900);
  await forceRefetch(page, "whatsapp");
  await ui.wait(page, 2800);
}

// ── Registry + CLI ──────────────────────────────────────────────────────────

const FLOWS: Record<string, { file: string; run: () => Promise<void> }> = {
  booking: {
    file: "videoBookingFlow",
    run: () => record({ name: "videoBookingFlow", viewport: PHONE, action: bookingFlow, trimStart: 1.0 }).then(logDone),
  },
  dashboard: {
    file: "videoDashboard",
    run: () => record({ name: "videoDashboard", viewport: DESKTOP, authed: true, action: dashboardFlow, trimStart: 1.2 }).then(logDone),
  },
  bookings: {
    file: "videoBookingsClients",
    run: () => record({ name: "videoBookingsClients", viewport: DESKTOP, authed: true, action: bookingsFlow, trimStart: 1.2 }).then(logDone),
  },
  campaigns: {
    file: "videoCampaigns",
    run: () => record({ name: "videoCampaigns", viewport: PHONE, authed: true, action: campaignsFlow, trimStart: 1.0 }).then(logDone),
  },
  "whatsapp-auto": {
    file: "videoWhatsappAuto",
    run: () => record({ name: "videoWhatsappAuto", viewport: PHONE, authed: true, action: whatsappAutoFlow, trimStart: 1.0 }).then(logDone),
  },
  "whatsapp-approval": {
    file: "videoWhatsappApproval",
    run: () => record({ name: "videoWhatsappApproval", viewport: PHONE, authed: true, action: whatsappApprovalFlow, trimStart: 1.0 }).then(logDone),
  },
};

function logDone(out: string) {
  console.log(`   ✅ ${out}`);
}

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const names = requested.length ? requested : Object.keys(FLOWS);

  console.log(`Recording against ${WEB_URL} — flows: ${names.join(", ")}\n`);
  const failed: string[] = [];
  for (const name of names) {
    const flow = FLOWS[name];
    if (!flow) {
      console.warn(`! unknown flow "${name}" (have: ${Object.keys(FLOWS).join(", ")})`);
      continue;
    }
    console.log(`▶ ${name}`);
    // Keep going if one flow fails (e.g. a cold-start timeout) so the rest of
    // the batch still records; report the failures at the end.
    try {
      await flow.run();
    } catch (err) {
      failed.push(name);
      console.error(`   ❌ ${name} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(failed.length ? `\nDone with failures: ${failed.join(", ")}` : "\nDone.");
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("\n❌ Recording failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
