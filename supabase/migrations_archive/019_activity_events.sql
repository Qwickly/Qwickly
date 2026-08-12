-- ============================================================================
-- Migration 019: Activity Events
-- General business activity timeline for auditability and dashboard/bell feeds.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL DEFAULT 'system'
                 CHECK (actor_type IN ('user', 'ai', 'system', 'client')),
  actor_id     TEXT,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  event_type   TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_business_created_idx
  ON public.activity_events(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_business_read_idx
  ON public.activity_events(business_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_entity_idx
  ON public.activity_events(entity_type, entity_id);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_events_all_own" ON public.activity_events;
CREATE POLICY "activity_events_all_own" ON public.activity_events
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
