-- ============================================================================
-- Migration 026: Let the WhatsApp bot reuse the booking-availability RPCs
-- The bot runs as the Supabase service role and books directly. To make its
-- availability checks identical to the UI, grant it EXECUTE on the same slot
-- helpers the UI uses. These stay REVOKEd from PUBLIC (anon/authenticated must
-- still go through the ownership-checked entry points).
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.compute_available_slots(UUID, UUID, DATE, UUID)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.public_booking_slot_is_free(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
