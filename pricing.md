# Qwickly — Launch Pricing Spec (simplified)

> Single source of truth for plans, add-ons, tokens and billing behaviour.
> Drives the billing page UI, the `plans` table, and the `subscription-management` edge function.
> Last updated: 2026-07-08. Status: **spec — not yet built.**

Currency: South African Rand (R). Positioning: **Qwickly starts as an affordable booking system; businesses add AI, WhatsApp automation, and campaign tokens when they're ready.**

Launch principle: **pay for the booking system first, add automation only when needed.** Don't price every future feature before the core product has users.

---

## 1. Model at a glance

- **2 base plans:** **Starter (R99/mo)** and **Team (R199/mo)**. **Monthly only** at launch.
- **3 add-ons:** AI Assistant (R99/mo), WhatsApp Chatbot (R199/mo), Extra Staff (R49/mo, Team only).
- **Automated WhatsApp booking reminders** are **in the base plans** (own monthly allowance), separate from campaign tokens — protects the WhatsApp-first positioning.
- **Campaign tokens:** 1 campaign message = 1 token. Each plan includes a monthly allowance; buy prepaid bundles to send more.
- **Marketing emails:** separate included monthly allowance (email is cheap; keep it off the token system for now).
- **Deposits / online payment at booking** included in both plans, with a **small Qwickly platform fee (~1%)** on payments processed (see §5.5).
- **14-day free trial, card required.** Annual billing deferred post-launch.
- Existing **custom builder** stays untouched/secondary for now; fate decided later.

---

## 2. Base plans

| Feature | **Starter** | **Team** |
|---|---|---|
| **Monthly price** | **R99** | **R199** |
| Best for | one-person business | small salon with staff |
| Staff / calendars | **1** | **up to 3** (then +R49/staff) |
| Booking page + direct link | ✅ | ✅ |
| Online bookings | unlimited | unlimited |
| Clients | unlimited | unlimited |
| Services | unlimited | unlimited |
| Booking email notifications | ✅ | ✅ |
| Client confirmation emails | ✅ | ✅ |
| Automated WhatsApp booking reminders | ✅ | ✅ |
| Free WhatsApp reminders / month | _TBD_ | _TBD_ |
| Deposits / online payment at booking | ✅ (~1% fee) | ✅ (~1% fee) |
| Dashboard | basic | full |
| Staff scheduling | — | ✅ |
| Campaign access | ✅ | ✅ |
| Free campaign tokens / month | 50 | 150 |
| Free marketing emails / month | 50 | 150 |
| AI Assistant | add-on | add-on |
| WhatsApp Chatbot | add-on | add-on |

**Starter public wording:** *For solo beauty businesses that need a simple online booking page. Includes one staff calendar, unlimited bookings, unlimited clients, unlimited services, email booking notifications, client confirmation emails, and 50 free campaign tokens.*

**Team public wording:** *For small salons with staff. Includes up to 3 staff calendars, unlimited bookings, unlimited clients, unlimited services, staff scheduling, email booking notifications, client confirmation emails, dashboard access, and 150 free campaign tokens.*

---

## 3. Add-ons

| Add-on | Price | Purpose | Notes |
|---|---|---|---|
| AI Assistant | R99/mo | Helps write campaigns, service descriptions, promotions, summaries, and business tips. | Both plans |
| WhatsApp Chatbot | R199/mo | Answers FAQs, shares prices/hours/location, sends booking links, helps clients choose a service, hands over to the owner. | Both plans |
| Extra staff member | R49/mo each | Adds another bookable staff calendar. | **Team only** — not available on Starter (forces Starter→Team) |
| Campaign tokens | from R49 | Send more campaign messages than the monthly allowance. | Prepaid bundles, see §4 |

---

## 4. Campaign token system

Simple rule: **1 campaign message = 1 token.** The UI shows how many tokens the business has, how many a campaign will use, and lets them top up before sending (prepaid — pay before send).

| | Included / month |
|---|---|
| Starter | 50 tokens |
| Team | 150 tokens |

**Prepaid top-up bundles** (bought on the billing page):

| Bundle | Price | Effective / token |
|---|---|---|
| 100 tokens | R49 | R0.49 |
| 250 tokens | R99 | R0.40 |
| 500 tokens | R179 | R0.36 |
| 1,000 tokens | R299 | R0.30 |

**Campaign UI example:** *"You have 150 tokens. Sending a campaign to 120 clients will use 120 tokens."*

> ⚠️ Token economics depend on the WhatsApp/SMS transport (OQ-1). If campaign messages go via Meta Cloud API (metered, ~R0.80+/marketing conversation) the R0.30–R0.49/token bundles are **underwater**; via `whatsapp-web.js` (no per-message fee) they're pure margin but ban-risky at volume. Resolve before finalising bundle prices.

---

## 4.5 Automated WhatsApp booking reminders

Utility reminders (confirmation / 24h / 2h) — the WhatsApp-first core value. **Included in both base plans** with a monthly allowance, **separate from campaign tokens** (campaign = marketing blasts; reminders = booking-triggered utility).

| Plan | Included WhatsApp reminders / month |
|---|---|
| Starter | _TBD_ |
| Team | _TBD_ |

- **Overage:** _TBD_ — proposed: draws from the same prepaid token balance as campaigns once the free allowance is used, so there's one top-up currency and one "1 message = 1 token" mental model. (Confirm; alternative is a separate reminder top-up.)
- Allowance numbers and overage both depend on transport (OQ-1): on `whatsapp-web.js` reminders are effectively free to send (allowance = fair-use cap); on Meta Cloud API they carry a real per-message cost.

---

## 5. Marketing emails

Separate included allowance (email is far cheaper than WhatsApp/SMS, so it stays off the token system for now).

| Plan | Email allowance / month |
|---|---|
| Starter | 50 |
| Team | 150 |
| Future | Sell extra email bundles once campaign usage is proven |

---

## 5.5 Deposits & online payment at booking

The app already supports taking **deposits** and **full payment** at booking via PayFast/Yoco.

- **Included in both plans** — solo operators need no-show protection most, so it's not gated to Team.
- **Qwickly platform fee: ~1%** on payments processed (in addition to the processor's own fees, which the business pays). This is a revenue line that scales with the customer's success.
- **Ties into no-show / cancellation policy:** deposits make the bot's configurable cancel/reschedule notice windows enforceable (deposit forfeit on late cancel / no-show). Included, not separately priced.
- **Open — collection mechanism:** how the ~1% is actually collected (PayFast split payment, aggregated invoice, or deducted from payouts) is an implementation detail to resolve in the backend step.

---

## 6. Deferred — do NOT sell at launch

| Deferred item | Reason |
|---|---|
| 3+ base plans | Creates confusion too early |
| Bot Lite / Pro / Plus split | Use one WhatsApp Chatbot add-on first |
| Loyalty plans | Not needed for launch |
| Google Review Boost add-on | Add when the feature is ready |
| Multi-location pricing | Contact-us later |
| POS, inventory, gift cards, memberships, payroll | Too much scope |
| Annual billing | See §8 — carried decision, likely post-launch |

---

## 7. Final launch structure

| Item | Price |
|---|---|
| Starter | R99/month |
| Team | R199/month |
| AI Assistant | R99/month |
| WhatsApp Chatbot | R199/month |
| Extra staff | R49/month |
| Campaign tokens | from R49 |

**Positioning sentence:** *Qwickly starts as an affordable booking system. Then businesses can add AI, WhatsApp automation, and campaign tokens when they're ready.*

---

## 8. Confirmed decisions

- **Free trial: KEPT.** 14-day trial, **card required** — mandate captured at signup, auto-charge on day 14 unless cancelled. Status `trialing` → `active` on first charge. ⚠️ signup.tsx says *"No credit card required"* — **must change** to card-required.
- **Annual billing: DEFERRED.** Launch **monthly-only**; add annual (e.g. 2 months free) post-launch as a retention lever.
- **Prepaid model = tokens.** The token system IS the prepaid primitive; no separate "wallet". WhatsApp reminder overage proposed to draw from the same token balance (§4.5).
- **WhatsApp reminders: in base plans**, own allowance, separate from campaign tokens (§4.5).
- **Deposits: included in both plans + ~1% Qwickly platform fee** (§5.5).

---

## 9. Open questions / gaps (brainstorm — 2026-07-08)

- **OQ-1 — WhatsApp/SMS transport.** `whatsapp-web.js` vs Meta Cloud API. Sets whether §4 token bundles clear cost and whether bulk campaigns are deliverable/compliant. Biggest dependency.
- ✅ **OQ-2 — WhatsApp booking reminders — RESOLVED.** In base plans, own allowance, separate from campaign tokens (§4.5). Remaining: set the allowance numbers + confirm overage draws from token balance.
- ✅ **OQ-3 — Deposits — RESOLVED.** Included in both plans + ~1% Qwickly platform fee (§5.5). Remaining: the fee-collection mechanism.
- **OQ-4 — Analytics placement.** New model only says "Dashboard: basic vs full." Where does the Analytics page sit — Team-only, both, or an add-on? (It's currently mock and needs real data regardless.)
- **OQ-5 — Channel per token.** Is a "campaign message" WhatsApp only, or WhatsApp + SMS? SMS and WhatsApp have different real costs; "1 token = 1 message" flattens that. Fine if transport is settled.
- **OQ-6 — Existing custom `custom_*` subscriptions.** Back-compat when the 2-plan model ships.

---

## 10. Feature-gating reference (for the app)

| Capability | Starter | Team | Enforcement |
|---|---|---|---|
| Staff seats | 1 | 3 (+R49) | Block create beyond limit; prompt upgrade/add-on |
| Staff scheduling | — | ✅ | Gate scheduling UI |
| Dashboard | basic | full | Gate full dashboard views |
| WhatsApp reminders | _TBD_/mo | _TBD_/mo | Count separately; overage draws from token balance |
| Deposits / payments | ✅ (~1% fee) | ✅ (~1% fee) | Apply platform fee on processed payments |
| Campaign tokens | 50/mo | 150/mo | Decrement per message; block/top-up when empty |
| Marketing emails | 50/mo | 150/mo | Count in `usage_tracking` |
| AI Assistant | via add-on | via add-on | Gate on add-on flag |
| WhatsApp Chatbot | via add-on | via add-on | Gate on add-on flag |

---

## 11. Build sequence

1. **Lock this spec + resolve the OQ-2/OQ-3 gaps.** ← current step.
2. **Backend:** seed Starter/Team into `plans`; model add-ons + token balance + token ledger; enforce prices server-side.
3. **Backend:** trial lifecycle (if kept) + token top-up via PayFast.
4. **Billing page UI:** 2 plan cards + add-on toggles + token balance/top-up + current-plan state (+ trial banner if kept).
5. **Cleanup:** update signup copy; fix stale "Bookza" branding strings in `billing.tsx`.
