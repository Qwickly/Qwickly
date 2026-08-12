-- ============================================================================
-- Migration 057: Lower the Additional Staff quantity cap
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Migration 051 seeded extra_staff with max_quantity = 50, which is far more
-- bookable staff than any target business realistically has. Lowered to 20 — a
-- generous ceiling for a salon/clinic while still guarding against a runaway
-- stepper. Additional Staff remains a paid add-on (R20/seat) and is NOT included
-- free during the trial.
-- ============================================================================

UPDATE public.plan_addons
SET max_quantity = 20
WHERE id = 'extra_staff';
