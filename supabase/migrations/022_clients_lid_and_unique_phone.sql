-- ============================================================================
-- Migration 022: Client LID column + phone/LID uniqueness
-- ----------------------------------------------------------------------------
-- Context: this WhatsApp account uses LID addressing (inbound JIDs end in @lid).
-- The app now resolves the real phone from contact.id, but we also store the LID
-- for reference/linking, and enforce uniqueness at the DB so the duplicate-client
-- bug can never silently recur.
--
-- NOTE: if the clients table still contains duplicate rows for the same
-- (business_id, phone), the unique index creation below will fail. Clear/dedupe
-- duplicate clients first (childless duplicates can be deleted; rows with
-- bookings/payments are protected by ON DELETE RESTRICT).
-- ============================================================================

-- 1. Store the WhatsApp LID alongside the phone (nullable; unknown for non-WA rows)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lid TEXT;

-- 2. One client per real phone per business. Empty phones ('') are exempt so that
--    manually-added clients without a phone do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS clients_business_phone_uniq
  ON public.clients (business_id, phone)
  WHERE phone <> '';

-- 3. One client per LID per business (only where a LID is known).
CREATE UNIQUE INDEX IF NOT EXISTS clients_business_lid_uniq
  ON public.clients (business_id, lid)
  WHERE lid IS NOT NULL;
