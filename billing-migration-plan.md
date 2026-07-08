# Billing Migration Plan — Custom-Builder → 2-Plan + Add-ons + Tokens

> Companion to [pricing.md](pricing.md). Turns the launch pricing spec into a concrete build.
> Status: **plan only — no code written yet.** Last updated 2026-07-08.

## Locked decisions (this session)

- **Transport: HYBRID.** `whatsapp-web.js` (each business's own connected number) for **reminders + AI chatbot**; **Meta Cloud API** for **bulk marketing campaigns**. Meta connections/messages tables already exist (migrations 034/035).
- **Reminder allowances:** Starter **500/mo**, Team **1,500/mo**. Fair-use caps (free on whatsapp-web.js). Overage draws from the campaign token balance.
- **Model:** Starter R99 / Team R199 monthly-only. Add-ons: AI Assistant R99, WhatsApp Chatbot R199, Extra Staff R49 (Team only). Campaign tokens (50/150 included + prepaid bundles). Marketing emails (50/150 included). 14-day trial, card required. Deposits + ~1% platform fee. Custom builder demoted to secondary, kept working.

## ⚠️ Open pricing tension to resolve before finalising bundle prices

Under **Hybrid**, campaigns run on **metered Meta Cloud API (~R0.80+/marketing conversation)**, so the current token bundles (R0.30–0.49/token, pricing.md §4) are **underwater**. Options, to decide before the token top-up UI ships:
1. Reprice bundles up to clear the Meta floor (e.g. ≥ R0.90/token), or
2. Route campaigns via whatsapp-web.js too at launch (bundles stay margin, accept ban-risk), or
3. Ship plans + reminders + add-ons first and **defer the paid token top-up** until this is settled (recommended — unblocks launch).

The token *balance + ledger + included allowance* can be built regardless; only the **prepaid bundle prices/purchase** depend on this.

---

## Current-state map (verified)

| Concern | Where it lives today | Change needed |
|---|---|---|
| Plan catalog | `plans` table seed — starter/growth/business @ R400/1500/5000 ([018](supabase/migrations/018_subscription_ad_hoc_schema.sql#L21-L25)) | Reseed Starter R99, add Team R199, deactivate growth/business |
| Fixed-plan prices (server) | `PLAN_PRICES` hardcoded ([index.ts:9-13](supabase/functions/subscription-management/index.ts#L9-L13)) | Update to {Starter:99, Team:199} |
| Custom-plan price | **client-trusted `finalPrice`** ([index.ts:681](supabase/functions/subscription-management/index.ts#L681),[842](supabase/functions/subscription-management/index.ts#L842)) | Add-ons/tokens must be server-priced; leave custom as-is (secondary) |
| Trial | none; `incomplete → active`, no `billing_date` | Add card-required 14-day trial |
| Add-ons | do not exist | New catalog + per-subscription tables |
| Tokens | do not exist; `usage_tracking` is daily ([024](supabase/migrations/024_usage_tracking.sql)) | New persistent balance + ledger + bundle catalog |
| Billing UI | custom slider builder ([billing.tsx](artifacts/bookza/src/pages/billing.tsx)) | Rewrite hero to 2 plan cards + add-ons + tokens; keep builder behind a link |
| Client API | [catalog-subscriptions.ts](artifacts/bookza/src/lib/catalog-subscriptions.ts) | Add addon + token fetch/purchase fns |
| Branding | "Bookza" in edge fn + billing.tsx:676,1107 | → "Qwickly" |
| Signup copy | "No credit card required" | → card required |

---

## Phase 0 — Lock spec (DONE except bundle-price tension above)

Fill the two remaining `_TBD_` in pricing.md §2/§4.5 with **500 / 1,500** and mark OQ-2 fully resolved. Leave OQ-1 marked "Hybrid; bundle pricing pending."

## Phase 1 — Backend schema (migrations 039+)

Use next free numbers (highest existing is **038**; do **not** reuse 014-style duplicates).

**039_plans_relaunch.sql**
- Add `plans.is_active BOOLEAN NOT NULL DEFAULT true` and `plans.public BOOLEAN NOT NULL DEFAULT true` (so old plans stay for FK integrity but stop being offered — OQ-6).
- `UPDATE` `starter_monthly` → `price_cents = 9900`, refreshed metadata.
- `INSERT` `team_monthly` (R199 = 19900).
- `UPDATE growth_monthly, business_monthly SET public = false` (keep rows; existing subs still resolve).
- New metadata shape per plan:
  ```json
  // starter_monthly
  {"staff":1,"reminderAllowance":500,"campaignTokens":50,"marketingEmails":50,
   "dashboard":"basic","staffScheduling":false,"aiAssistant":false,"whatsappChatbot":false}
  // team_monthly
  {"staff":3,"reminderAllowance":1500,"campaignTokens":150,"marketingEmails":150,
   "dashboard":"full","staffScheduling":true,"aiAssistant":false,"whatsappChatbot":false}
  ```

**040_plan_addons.sql**
- `plan_addons` catalog: `id TEXT PK, name TEXT, price_cents INT, applies_to TEXT CHECK (all|team_only), max_quantity INT DEFAULT 1, is_active BOOL`. Seed: `ai_assistant` (9900, all, 1), `whatsapp_chatbot` (19900, all, 1), `extra_staff` (4900, team_only, e.g. 20).
- `subscription_addons`: `id UUID PK, subscription_id UUID FK, addon_id TEXT FK, quantity INT DEFAULT 1, created_at`. Unique (subscription_id, addon_id). RLS via `user_owns_business` (join through subscriptions) — mirror existing subscription RLS.

**041_campaign_tokens.sql**
- `token_balances`: `business_id UUID PK/FK, balance INT NOT NULL DEFAULT 0, updated_at`. (Persistent, not daily.)
- `token_ledger`: `id UUID PK, business_id FK, delta INT, reason TEXT CHECK (monthly_grant|purchase|campaign_spend|reminder_overage|adjustment), ref TEXT, created_at`. Append-only audit.
- `token_bundles` catalog: `id TEXT PK, tokens INT, price_cents INT, is_active BOOL`. Seed the §4 bundles **but gate on the pricing-tension decision** (leave `is_active=false` until bundle prices are cleared against Meta cost).
- RLS: select own; writes via service role (edge fn) only.
- Helper fn `public.spend_tokens(business_id, amount, reason, ref)` that decrements atomically + writes ledger, returns success/insufficient (reuse the atomic-claim pattern from the notification-worker dedup fix).

## Phase 2 — Edge function (`subscription-management/index.ts`)

- Replace `PLAN_PRICES` with `{ Starter: 99, Team: 199 }`. Rebuild `planId` mapping (`team_monthly`). Reject unknown plans.
- **Add-on endpoints** (all server-priced from `plan_addons`, never client):
  - `POST /addons` — attach add-on (validate `applies_to`: reject `extra_staff` unless plan is Team; validate quantity ≤ max). Recompute subscription total = plan + Σ add-ons; push amount change to PayFast via existing `updatePayFastSubscription`.
  - `DELETE /addons/:id` — detach + recompute + PayFast update.
- **Token endpoints:**
  - `GET /tokens` — balance + recent ledger.
  - `POST /tokens/purchase` — look up bundle price **from `token_bundles`**, build a PayFast **one-time** payment (no subscription_type), credit balance + ledger on webhook confirm. (Blocked by bundle-price decision.)
  - Internal: campaign-send path calls `spend_tokens`; reminder overage path calls it with `reminder_overage`.
- **Trial:** in `POST /payfast`, set `billing_date = today+14` (PayFast defers first charge), insert subscription `status:'trialing'`, keep `subscription_type:1` (tokenised). Webhook flips `trialing → active` on first successful charge; grant included tokens on activation and each renewal (`monthly_grant`).
- **Branding:** `Bookza`→`Qwickly`, `subscriptions@bookza.co.za`→Qwickly address, `custom_str1` tags.

## Phase 3 — Client API (`catalog-subscriptions.ts`)

- Extend `CatalogPlan.metadata` type to the new shape (staff, reminderAllowance, campaignTokens, marketingEmails, dashboard, flags).
- `fetchAddons()`, `attachAddon()`, `detachAddon()`.
- `fetchTokenBalance()`, `fetchTokenBundles()`, `purchaseTokenBundle()`.
- `subscribeToPlan(planName)` already exists as `createSubscriptionWithPayFast` — reuse for Starter/Team.

## Phase 4 — Billing page UI (`billing.tsx`)

- **Hero → 2 plan cards** (Starter/Team) with the §2 feature lists + "Choose" / "Current plan". Trial banner when `status==='trialing'` (days left to first charge).
- **Add-ons section:** three toggles (AI Assistant, WhatsApp Chatbot, Extra Staff), Extra-staff as a stepper, disabled on Starter with "upgrade to Team" hint.
- **Tokens panel:** balance + included allowance + "Top up" (bundles) — top-up disabled/"coming soon" until bundle pricing resolved.
- **Usage:** repoint the existing rings/bars to real metadata (staff seats, reminders used vs allowance, tokens, emails).
- **Keep the custom builder** dialog and its endpoints, but move entry to a small secondary "Need a custom plan? Talk to us" link, not the hero.
- Remove/relabel the "50% off core for 6 months" + volume-discount promos (they belong to the old model).

## Phase 5 — Feature gating (spec §10) — separate follow-up PRs

- Staff seats: block create beyond `metadata.staff` (+ Extra Staff quantity); prompt upgrade.
- Staff scheduling / full dashboard: gate on `metadata.staffScheduling` / `metadata.dashboard`.
- AI Assistant: already gated in [ai-assistant.tsx:63-64](artifacts/bookza/src/pages/ai-assistant.tsx#L63-L64) on `metadata.aiAssistantEnabled` — align the add-on flag name (`aiAssistant`) so it lights up.
- WhatsApp Chatbot: gate bot on `whatsappChatbot` add-on flag.
- Campaign send: decrement tokens via `spend_tokens`, block/top-up when empty.
- Marketing emails + reminders: count monthly against allowance.

## Phase 6 — Cleanup

- Signup copy: "No credit card required" → card-required trial wording.
- Sweep remaining "Bookza" strings in billing.tsx.
- Backfill: existing custom_* and growth/business subscriptions keep working (public=false hides them from new selection; no data migration forced).

---

## Suggested build order (smallest shippable increments)

1. **039 + edge PLAN_PRICES + branding + signup copy** → real Starter/Team selectable, trial-less. (Smallest visible win.)
2. **Trial** (billing_date + trialing status + webhook activation + token grant).
3. **Add-ons** (040 + endpoints + UI toggles).
4. **Tokens balance/ledger/allowance + usage display** (no paid top-up yet).
5. **Resolve bundle-price tension → enable token purchase.**
6. **Feature gating PRs** (§10), one capability at a time.
