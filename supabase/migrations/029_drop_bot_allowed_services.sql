-- ============================================================================
-- Migration 029: Drop the retired whatsapp_bot_allowed_services table (contract step)
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- The contract half of the expand/contract started in migration 028.
--
-- "Can the WhatsApp bot book this service" now lives entirely on
-- services.bookable_by_bot (added + backfilled in 028). The old junction table
-- is no longer read or written by any code.
--
-- ⚠️ ONLY RUN THIS ONCE every developer and deployment is on the new code.
--    Dropping it while any old code is still live (it queried this table) will
--    break that code's bot-settings load and the WhatsApp bot. 028 kept the
--    table precisely so old and new code could coexist until then.
-- ============================================================================

DROP TABLE IF EXISTS public.whatsapp_bot_allowed_services;
