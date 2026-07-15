# Qwickly Pricing Plan

> Last updated 2026-07-15. Supersedes the 2-plan (Starter R99 / Team R199) model from the
> July 8 billing plan — there is no Team plan. The model is **one plan + à-la-carte add-ons +
> two prepaid balances**.

---

## 1. Starter Plan — R129/month

Everything a solo business needs to manage bookings and customer communication. The only plan.

### Included

- 1 calendar
- 1 bookable staff member
- 1 user login
- Unlimited bookings, clients and services
- Custom Qwickly booking-page link
- Basic dashboard
- Pending and confirmed booking statuses
- Automated booking emails (confirmation, cancellation, rescheduling)
- One connected WhatsApp business number
- Unlimited WhatsApp booking confirmations
- Unlimited WhatsApp cancellation and rescheduling notifications
- Unlimited WhatsApp booking reminders
- Normal staff-to-client WhatsApp conversations
- Automatic client recognition and creation from incoming WhatsApp messages
- WhatsApp campaigns to existing clients using purchased tokens
- Official Meta API campaigns to new or cold contacts using purchased tokens
- Notifications sent to both the client and staff member
- Access to email campaigns
- 100 marketing emails per month
- 14-day free trial

Unlimited WhatsApp transactional notifications and normal conversations are subject to fair use.

Marketing campaign messages are not included and use purchased WhatsApp tokens.

### Not included

- WhatsApp marketing tokens
- WhatsApp Chatbot
- Analytics
- AI Assistant
- Branded Email Sender
- Custom Booking Domain

### Why R129 and not R99

The base price rose R30 to cover the per-business messaging infrastructure that now ships with
every plan. Connecting a business's own WhatsApp number was previously going to be a paid add-on;
that was rejected because a separate line item invites the comparison "I could just use my own
WhatsApp for free" — a comparison Qwickly loses. Folding it into the base removes the line item,
and every connected business becomes a token buyer and a Chatbot prospect. The infrastructure is
opt-in (nothing runs until a business connects), so only active users incur the cost.

### Why transactional WhatsApp is unlimited

An earlier draft capped this at 500/month with overage drawing tokens. That was dropped, for two
reasons:

1. **The cost is per-business, not per-message.** The infrastructure cost is the connection itself,
   which is fixed regardless of volume. Metering per message prices something whose cost isn't
   per-message. (This is the opposite of the official Meta API, where every message has a real
   per-message cost — which is why campaigns to cold contacts stay metered at 5 tokens.)
2. **500 was mis-sized and would have charged the best customers.** A fully-booked solo operator
   does roughly 200 bookings/month, and each booking fires a confirmation plus a 24-hour and 2-hour
   reminder — about 600 messages before any cancellation or reschedule traffic. The cap would have
   triggered surprise token charges for precisely the businesses getting the most value.

Fair use is therefore an **abuse control, not a volume cap**. The pacing infrastructure that
enforces it already exists — see §14.

---

## 2. Additional Staff — R20/month per staff member

A bookable person on the business's calendar. Not a login, and not a separate calendar.

Each additional bookable staff member receives:

- Their own availability
- Their own schedule within the business calendar
- Selected services
- The ability to receive bookings
- Their own booking notifications

The business still has **one calendar**; staff members are bookable lanes within it. R20 reflects
that — it adds a bookable person, not new infrastructure.

---

## 3. Team Member — Coming Soon

A human who logs in. This is a **separate plan**, not an add-on to Starter — pricing to be
confirmed closer to launch.

### Planned capabilities

- Own login and authenticated dashboard access
- Permissions/role scoping
- Access to their own schedule and bookings

### The customer-facing distinction

> **Additional Staff puts someone on the calendar. A Team Member gets the keys.**

This distinction must be explicit whenever both are on the page. Without it, the predictable
support question is "why am I paying for Sarah twice?" A Team Member who is also bookable is both
things attached to the same person.

**Internal note:** these are two separate seat counters (`staff` and `logins`), not one. That must
be encoded in plan metadata before anyone subscribes, even though Team Member ships later — see
§12.

---

## 4. WhatsApp Chatbot Add-on — R200/month

The WhatsApp Chatbot allows businesses to accept and manage bookings through WhatsApp 24/7.

The chatbot is **AI automation only**. Sending and receiving WhatsApp messages from the business's
own number is part of Starter — the chatbot is what makes those messages answer themselves.

### Included

- Automated booking and availability answers
- One-step automated replies
- Optional two-step replies requiring staff confirmation
- Pending-reply management
- Chatbot settings
- FAQ and business knowledge
- Normal chatbot replies, subject to fair use

### Included with Starter, not this add-on

The following moved to the base plan when WhatsApp messaging was folded in:

- Connecting the business's WhatsApp number
- Unlimited WhatsApp booking confirmations, cancellations and rescheduling notifications
- Unlimited WhatsApp booking reminders
- Staff conversations through the business's WhatsApp number
- Automatic client recognition and creation from incoming messages
- Connection monitoring
- The WhatsApp inbox

**Note:** client recognition/auto-creation was previously listed under this add-on. That was wrong
— it runs in a separate inbound listener with no chatbot gate, so it has always been base
behaviour. It is now correctly listed under Starter.

### Staff identification

Staff members should message the business's WhatsApp number from their own phone numbers. Their
numbers can then be recognised as staff accounts inside the inbox.

### Important distinction

The R200 chatbot subscription covers **AI automation**: customer conversations answered
automatically, booking assistance, and availability assistance, subject to fair use.

It does not include outbound WhatsApp marketing messages. WhatsApp marketing campaigns use
purchased WhatsApp tokens on every plan, with or without the chatbot.

---

## 5. AI Assistant — Coming Soon

The AI Assistant will be displayed as an upcoming add-on and will not be available for purchase at
launch.

### Planned capabilities

- Access to business information
- Access to staff information
- Client searches
- Booking searches
- Availability queries
- Schedule assistance
- Suggested business actions
- AI assistance across relevant pages

### Pricing still to be confirmed

Possible pricing options include:

- A fixed monthly price of approximately R50–R100
- A monthly message allowance
- Usage-based pricing
- A pricing slider based on expected monthly usage

A recommended usage package should be selected automatically for most users.

Before launch, the following must be defined:

- Monthly message or token limits
- Rate limits
- Fair-use rules
- Overage pricing
- Model costs
- Infrastructure costs

---

## 6. Analytics — R100/month

Analytics provides businesses with more detailed information than the basic Starter dashboard.

### Planned customer-facing features

- Revenue reports
- Booking trends
- Client trends
- Service-performance reports
- Staff-performance reports
- Cancellation and rescheduling trends
- Date-range comparisons
- Data exports
- Actionable business insights

**Internal note — build owned by Dylan.** The current analytics page is largely mock data
(random/hardcoded series), and several features above — staff-performance reports, date-range
comparisons, data exports — do not exist yet. The R100 add-on ships once that work lands; the
entitlement gate can be built against it in parallel.

**Internal note:** confirm the exact included reports and customer-facing wording with Torban
before publishing the final pricing page.

---

## 7. Branded Email Sender — R15/month

Connect an existing verified business email address and send emails from that address instead of a
Qwickly-branded sender.

### Included

- Custom sender email address
- Custom sender name
- Domain verification
- Use for booking confirmations
- Use for reminders
- Use for cancellation and rescheduling notifications
- Use for marketing campaigns

Marketing emails still use the business's included monthly email credits or purchased email
credits.

Qwickly does not create or host the business's mailbox through this add-on.

**Why this stays standalone:** bundling Branded Email with WhatsApp messaging was considered and
rejected. Branded Email requires a verified domain; WhatsApp messaging requires a phone. They
select for entirely different customers — the core Qwickly user has a Gmail address and a busy
phone, and would be forced to buy a domain-shaped product to get a phone-shaped feature.

---

## 8. Custom Booking Domain — Coming Soon

Connect a custom domain or subdomain to the business's Qwickly booking page.

Example:

`book.yourbusiness.co.za`

### Planned features

- Custom domain or subdomain connection
- Domain verification
- SSL certificate support
- Connection-status monitoring
- Branded booking-page address
- Setup guidance

Pricing will be confirmed before launch.

---

## 9. Marketing Credits and Tokens

Qwickly uses separate balances for email marketing and WhatsApp marketing.

This prevents included email credits from being used for WhatsApp messages and keeps both systems
easier to understand.

### Email credits

- 1 email credit sends 1 marketing email.
- The Starter plan includes 100 email credits per billing month.
- **Included email credits expire monthly** — they reset each billing month and do not roll over.
- Purchased email credits are separate from the monthly included allowance.
- Included credits are used before purchased credits.
- **Purchased email credits do not expire** while the subscription is active.
- Email credits cannot be converted into WhatsApp tokens.
- Transactional booking emails do not use marketing email credits.

Transactional booking emails include:

- Booking confirmations
- Pending-booking notifications
- Cancellation notifications
- Rescheduling notifications
- Other essential booking-related notifications

### WhatsApp tokens

WhatsApp tokens are used only for outbound WhatsApp marketing campaigns.

| WhatsApp activity                                                              |                   Tokens charged |
| ------------------------------------------------------------------------------ | -------------------------------: |
| First marketing message to a new or cold contact through the official Meta API |                         5 tokens |
| Campaign message to an existing WhatsApp contact from the business's own number |                          1 token |
| Transactional WhatsApp booking notification                                    | Included with Starter, unlimited |
| Normal staff conversation                                                      | Included with Starter, unlimited |
| Normal chatbot reply                                                           | Included with the chatbot add-on |

Transactional notifications and staff conversations are unlimited on every plan and remain subject
to fair use (§14). Chatbot replies remain subject to fair use.

Email credits and WhatsApp tokens are separate and cannot be exchanged or transferred between
balances.

---

## 10. WhatsApp Token Packs

All proposed WhatsApp marketing rates are below the current R2.50 comparison rate used in the
internal Fresha benchmark.

|    Token pack |  Price | Price per token |
| ------------: | -----: | --------------: |
|    100 tokens |    R35 |           R0.35 |
|    500 tokens |   R150 |           R0.30 |
|  1,500 tokens |   R405 |           R0.27 |
|  5,000 tokens | R1,200 |           R0.24 |
| 10,000 tokens | R2,100 |           R0.21 |

### Example new-contact WhatsApp marketing costs

A marketing message sent to a new or cold contact through the official Meta API costs 5 tokens.

|    Token pack | Effective price per new-contact message |
| ------------: | --------------------------------------: |
|    100 tokens |                                   R1.75 |
|    500 tokens |                                   R1.50 |
|  1,500 tokens |                                   R1.35 |
|  5,000 tokens |                                   R1.20 |
| 10,000 tokens |                                   R1.05 |

A campaign message sent to an existing WhatsApp contact from the business's own number costs
between R0.21 and R0.35, depending on the token pack purchased.

**Margin note:** the 5-token multiplier clears Meta's ~R0.80/marketing-conversation floor at every
pack size, which resolves the pricing tension flagged in the July plan. The 10,000-token pack is
the thin one — R1.05 revenue against ~R0.80 cost is roughly 24% before PayFast fees and VAT.
Verify the real Meta rate before publishing the largest pack.

---

## 11. Additional Marketing Email Packs

The Starter plan includes 100 marketing email credits every month.

Customers who need additional marketing emails can purchase separate email-credit packs.

|    Email pack | Price | Price per email |
| ------------: | ----: | --------------: |
|    250 emails |   R25 |           R0.10 |
|    500 emails |   R45 |           R0.09 |
|  1,000 emails |   R85 |          R0.085 |
|  5,000 emails |  R400 |           R0.08 |
| 10,000 emails |  R750 |          R0.075 |

### Email-credit rules

- Email credits are separate from WhatsApp tokens.
- Included monthly email credits are used before purchased credits.
- Included email credits reset every billing month and do not roll over.
- Purchased email credits do not expire while the subscription remains active.
- Email credits cannot be exchanged for WhatsApp tokens.
- Transactional booking emails do not use marketing email credits.

### Expiry and cancellation (applies to both balances)

- **Purchased WhatsApp tokens do not expire** while the subscription is active.
- **Purchased email credits do not expire** while the subscription is active.
- **Included monthly email credits expire** at the end of each billing month.
- **On cancellation, unused purchased tokens and credits are forfeited. There is no cash refund
  and no payout.** Customers should spend what they have bought before cancelling.

This must be stated plainly at the point of purchase, not only in the terms — a customer who buys
a 10,000-token pack for R2,100 and cancels the next week will otherwise raise a chargeback.

---

## 12. Implementation Notes (internal)

### Customer-facing language rules

Never name the mechanism. Customers do not know what WhatsApp Web is, and the phrase makes the
product sound like a workaround.

| Use                                                     | Never use                            |
| ------------------------------------------------------- | ------------------------------------ |
| "One connected WhatsApp business number"                | "WhatsApp Web"                       |
| "WhatsApp booking notifications from your own number"   | "session"                            |
| "WhatsApp campaigns to your existing clients"           | "QR code" (outside the setup screen) |
| "Unlimited WhatsApp booking confirmations"              | "whatsapp-web.js", "browser session" |

"Connected WhatsApp business number" is approved — it describes the outcome. "WhatsApp connection"
as a standalone noun/feature name is not: it reads as a billable mechanism, which is exactly the
framing that made the add-on fail.

The one legitimate exception is the setup screen itself, where "Scan this with WhatsApp on your
phone" simply describes the action being taken.

Internal/code naming is unaffected — the entitlement key stays `whatsapp_session`.

### Seat counters

There are **two** counters, not one. This must be encoded before anyone subscribes; retrofitting
it after the fact means migrating live subscriptions.

- `staff` — bookable calendar entities (R20 each)
- `logins` — authenticated humans (future Team Member plan, pricing TBC)

Migration 039 currently seeds `staff: 1` only, and still seeds a `team_monthly` plan that no
longer exists in this model. Both need a successor migration.

`staff_members` has `name`/`email`/`phone` and **no `user_id`** — staff today is purely a calendar
entity with no auth link. Team Member is therefore a new relationship (staff ↔ auth user +
permissions), not a flag on an existing row.

### Entitlement layer

No entitlement enforcement exists anywhere in the application today — no route checks a plan,
tier, or add-on. Every business currently gets every feature. This layer has to be built before
any of the above can be sold.

Add-on entitlement keys: `whatsapp_chatbot`, `analytics`, `branded_email`, `extra_staff`
(quantity), `team_member` (quantity, future), `ai_assistant` (future), `custom_domain` (future).

`whatsapp_session` is now a Starter entitlement, not an add-on.

---

## 13. Recommended Customer-Facing Pricing Page

### Starter — R129/month

Everything a solo business needs to manage bookings and customer communication.

Includes:

- Unlimited bookings, clients and services
- 1 calendar
- 1 bookable staff member
- Automated booking emails
- One connected WhatsApp business number
- Unlimited WhatsApp booking confirmations, reminders and cancellation notices
- Normal staff-to-client WhatsApp conversations
- Clients recognised and added automatically from incoming WhatsApp messages
- WhatsApp campaigns to your existing clients (using tokens)
- Email campaign tools
- 100 marketing emails every month
- 14-day free trial

Unlimited WhatsApp notifications and conversations are subject to fair use. Marketing campaign
messages use purchased WhatsApp tokens.

### Additional Staff — R20/month per staff member

Add another bookable team member with their own availability, services and calendar schedule.

### WhatsApp Chatbot — R200/month

Let customers ask questions, check availability and make bookings through WhatsApp 24/7, answered
automatically.

Chatbot conversations are included, subject to fair use. Marketing campaign messages use purchased
WhatsApp tokens.

### Analytics — R100/month

Access detailed reports and insights about bookings, revenue, services, clients and staff.

### Branded Email Sender — R15/month

Send booking notifications, reminders and campaigns from your own verified business email address.

Marketing email usage still comes from the included monthly allowance or purchased email credits.

### WhatsApp Marketing Tokens — From R35

Use WhatsApp tokens for outbound WhatsApp marketing campaigns.

### Additional Marketing Emails — From R25

Purchase extra marketing email credits after using the 100 emails included with Starter.

### Team Member — Coming Soon

Give a team member their own login and dashboard access.

### Custom Booking Domain — Coming Soon

Connect your own domain or subdomain to your Qwickly booking page.

### AI Assistant — Coming Soon

Search bookings and clients, check availability, assist with schedules and receive suggested
business actions using AI.

---

## 14. Decisions — Resolved and Open

### Resolved (2026-07-15)

**Unit costs.** Confirmed by Dylan:

| Item                                  | Cost to Qwickly              | Sells for      | Margin |
| ------------------------------------- | ---------------------------- | -------------- | ------ |
| Marketing email                       | ~$20 per 50,000 ≈ **R0.007** | R0.075–R0.10   | ~90%+  |
| Official Meta API message (cold)      | **R0.80**                    | R1.05–R1.75 (5 tokens) | 24%–54% |
| Message from the business's own number | **R0** (processing only)     | R0.21–R0.35 (1 token) | ~100%  |

Three consequences worth keeping in mind:

- The 100 included marketing emails cost roughly **R0.72 per business per month**. Negligible —
  the allowance could be raised as a competitive lever at almost no cost, if ever useful.
- **The Meta route is the only place with a real per-message cost**, and the 10,000-token pack is
  the thin one: R1.05 revenue against R0.80 cost is ~24% before PayFast fees and VAT. Verify the
  R0.80 figure against an actual invoice before publishing that pack.
- Own-number messages costing nothing is what makes unlimited transactional messaging safe, and
  what makes 1-token campaign messages nearly pure margin. This is the core economic engine of
  the model.

**Fair use is already enforced in code.** The queues do pace sends: `notification-worker.ts`
applies anti-fingerprint jitter after real dispatches, and the campaign path runs the full
`whatsapp-anti-fingerprint.ts` treatment (randomised 5–15s delays, cool-downs, and a
`dailyLimitPerSession` of 1,000). One gap to be aware of rather than fix now: **the 1,000/day
ceiling lives in the campaign path, not the transactional queue** — the transactional worker gets
jitter but no daily cap. That is fine in practice (a fully-booked solo operator sends ~600/month,
nowhere near 1,000/day) and abusing it would require mass-creating fake bookings. Revisit only if
that pattern is ever observed.

**Free trial requires a card.** 14 days, card captured at signup, first charge on day 14. The
PayFast recipe for this is already built (amount=0.00 tokenises without charging;
billing_date=today+14). ⚠️ **`signup.tsx` still says "No credit card required" — that copy is now
wrong and must change before launch.**

**Additional Staff does not require separate-calendar work.** Staff are bookable lanes within the
one business calendar, not separate calendars. The old "separate calendar support" blocker was
based on a misreading and is dropped.

**Deposits + ~1% platform fee: dropped.** Was a locked revenue line in the July plan; deliberately
removed from this model. Deposits remain a product feature; Qwickly takes no percentage.

**Token and credit expiry: settled.** See §11 — purchased balances don't expire while active,
included email credits reset monthly, and everything unused is forfeited on cancellation with no
refund.

**Both-channel notifications: working as intended, no change needed.** The business's own toggles
decide. See the note below.

### Open

1. **Team Member** — confirm pricing and what a login unlocks. Ships as a separate plan, later.
2. **Analytics** — the R100 add-on ships once the real reports are built (owned by Dylan, §6).
3. **VAT** — included in displayed prices, or added at checkout?
4. **Competitor pricing** — verify before publishing any direct Fresha comparison.
5. **Remaining cost lines to account for:** payment-processing fees, hosting, customer support,
   per-business messaging infrastructure, failed messages, refunds, taxes.

### Note: does a client with both a phone and an email get two messages?

Yes — if the business has turned both on. The channels are **independent switches, not a
fallback**. Migration 049 computes `send_whatsapp = <event toggle> AND client is WhatsApp-reachable`
and `send_email = <event>_email AND client has an email` separately, then enqueues a row for each
that is true. There is no either/or logic anywhere in the queue.

In practice this is safe and behaves as intended:

- The `_email` columns default to `false`, so no business starts sending duplicates.
- Migration 048 backfilled existing businesses to exactly their prior behaviour
  (`<event>_email = <event> AND email_enabled`), so nobody's messaging changed when it shipped.
- A business that deliberately enables both channels for one event has asked for both.

So this is a **settings question, owned by the business**, exactly as expected. The only thing
worth doing is making sure the notification settings UI makes it obvious that enabling both means
the client receives two messages.

---

## 15. Recommended Initial Launch Structure

Launch with the products that are ready:

- Starter — R129/month
- Additional Staff — R20/month per staff member
- WhatsApp Chatbot — R200/month
- Analytics — R100/month *(subject to §6)*
- Branded Email Sender — R15/month
- WhatsApp Token Packs — from R35
- Additional Marketing Email Packs — from R25
- Team Member — Coming Soon
- AI Assistant — Coming Soon
- Custom Booking Domain — Coming Soon

---

## 16. Open Issue: Existing-Contact Route Safeguard

The earlier campaign-access issue is **resolved**. It rested on the assumption that connecting a
WhatsApp number required the Chatbot add-on. It never did — the connect route has no subscription
check, and the chatbot is gated only on a free user toggle. With messaging now in the base plan,
every subscriber can use both campaign routes, so there is nothing to gate, hide, or upsell on the
campaign page.

One question from that section survives, and it is the important one:

> **Add safeguards to prevent businesses from incorrectly using the cheaper existing-contact
> campaign route.**

This is a token-accounting problem, not an entitlement problem.

The send path already splits recipients by `clients.status` — `active` sends from the business's
own number (1 token), `new`/`api` go via the official Meta API (5 tokens). The natural safeguard is
already in place: `status` flips to `active` only when a person messages the business inbound,
written server-side by the inbound handler. A business cannot import a cold list and mark it
`active`.

The hole to audit: the send path **trusts `clients.status` as stored**. If any UI, import, or API
path can write `status: 'active'`, the 1-token route is forgeable and the 5-token Meta route —
where the real per-message cost lives — can be bypassed. Before tokens are charged for real:

1. Audit every write path to `clients.status` and confirm none is client-controllable.
2. Consider deriving the route at send time from real conversation evidence rather than from the
   stored status column.
3. Charge tokens server-side at send time, never from a client-supplied count or route choice.
