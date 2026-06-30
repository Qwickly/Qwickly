-- ============================================================================
-- Migration 028: WhatsApp bot — per-service "bookable_by_bot" flag (expand step)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Moves "can the WhatsApp bot book this service" onto a single boolean column on
-- each service, replacing the whatsapp_bot_allowed_services junction table.
--
-- Why:
--   The old junction was a whitelist (N rows per business). An EMPTY whitelist
--   was ambiguous — it could mean "owner unchecked every service" OR "owner
--   never configured the bot" — and the bot read empty as "allow all", so
--   turning every service off still let the bot offer them.
--
--   A per-service flag removes the ambiguity by construction:
--     • all services off  → every flag false → bot books nothing.
--     • brand-new service  → defaults true   → bot can book it (opt-out).
--
-- BACKWARD-COMPATIBLE BY DESIGN (expand/contract):
--   This step only ADDS + BACKFILLS the column and intentionally KEEPS the old
--   whatsapp_bot_allowed_services table, so code running the *old* schema keeps
--   working while everyone upgrades. The table is dropped separately in
--   migration 029 once all developers/deployments are on the new code.
-- ============================================================================

-- 1. Add the flag. Default true = a service is bot-bookable unless turned off.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS bookable_by_bot BOOLEAN NOT NULL DEFAULT true;

-- 2. Backfill from the existing whitelist, but ONLY for businesses that actually
--    configured it (have at least one whitelist row). For those, a service is
--    bookable iff it was whitelisted; everything else becomes false. Businesses
--    that never configured the whitelist keep the default true (allow all),
--    preserving today's effective behaviour.
UPDATE public.services s
SET bookable_by_bot = EXISTS (
  SELECT 1 FROM public.whatsapp_bot_allowed_services a
  WHERE a.business_id = s.business_id AND a.service_id = s.id
)
WHERE EXISTS (
  SELECT 1 FROM public.whatsapp_bot_allowed_services a2
  WHERE a2.business_id = s.business_id
);

-- NOTE: the whatsapp_bot_allowed_services table is deliberately kept here.
-- Drop it via migration 029 once everyone is running the new code.
