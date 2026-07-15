-- ============================================================================
-- Migration 054: Persist email campaign content type
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- The compose form lets a customer pick text vs HTML, and POSTs `contentType` to
-- /api/email/campaigns/send — which then dropped it, because marketing_campaigns
-- had nowhere to put it. The worker had no way to know how to render the body.
--
-- Subject and body were never lost: they are already on the campaign row as
-- `name` and `message`. Only the content type needs a home.
-- ============================================================================

ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text'
    CHECK (content_type IN ('text', 'html'));
