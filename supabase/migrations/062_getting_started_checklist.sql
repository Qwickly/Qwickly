-- Getting Started checklist: dismissible steps that don't have an objective
-- "done" state derived from real data (staff seat top-up, WhatsApp bot setup,
-- custom email sender — all legitimately optional, so a business can mark
-- them as "not now" instead of them staying incomplete forever). Steps that
-- *do* have a real completion signal (business details filled in, first
-- service/staff member created, trial started) are derived live and need no
-- new column.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS getting_started_dismissed_steps JSONB NOT NULL DEFAULT '[]'::jsonb;
