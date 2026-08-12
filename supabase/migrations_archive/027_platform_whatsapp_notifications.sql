-- ============================================================================
-- Migration 027: Platform WhatsApp Notifications + Owner Approval Alerts
-- ----------------------------------------------------------------------------
-- Adds the data layer for OUTBOUND messages sent from the official Qwickly
-- number (Meta WhatsApp Cloud API) to business owners. This is the platform's
-- own channel, distinct from the per-tenant whatsapp-web.js sessions.
--
-- The queue is deliberately GENERIC (platform_whatsapp_notifications) so the
-- official number can serve many message kinds over time — not just the first
-- use case. A `kind` discriminator distinguishes them:
--     'approval_alert'  — a 2-step AI reply is waiting for approval (THIS migration)
--     'revenue_summary' — daily/weekly takings (future)
--     'ai_summary'      — AI business digest (future)
--     'report'          — scheduled reporting (future)
-- New kinds are just new string values; no schema change needed to add one.
--
-- Three pieces:
--   1. whatsapp_bot_settings columns — owner opt-in, alert number, quiet hours
--      (these are specific to the approval-alert use case).
--   2. platform_whatsapp_notifications — the generic durable send queue
--      (status + attempts + next_attempt_at retry/backoff, mirroring the
--      staff/client queues from migrations 014/015/024).
--   3. owner_approval_alert_state — per-business throttle/cooldown state for the
--      approval-alert kind specifically, so a burst of inbound client messages
--      produces ONE batched owner ping, not one per draft. (Other kinds will
--      have their own scheduling and don't use this table.)
--
-- The queue is drained by a background worker (api-server
-- platform-notification-worker.ts) using the service-role key, so writes happen
-- below RLS. Owners only need read access for a future in-app "alerts" view.
--
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- NOTE: the migrations folder has historical duplicate numbers (014/015/016/023);
-- 026 is the highest real number, so this is 027. Verify the directory before
-- adding the next one.
-- ============================================================================

-- ── 1. Owner-alert settings on the bot settings row ──────────────────────────
-- owner_review_alerts_enabled : master opt-in for the approval-alert ping
--                               (default on so review-mode users benefit
--                               immediately; the worker still no-ops unless
--                               review_mode != 'auto').
-- owner_alert_phone           : optional override. NULL = ping the number the
--                               business already runs WhatsApp on
--                               (whatsapp_sessions.connected_phone), resolved by
--                               the worker, falling back to businesses.phone.
-- owner_alert_quiet_start/end : local SAST quiet window; alerts inside it are
--                               deferred to the end of the window, never dropped.

ALTER TABLE public.whatsapp_bot_settings
  ADD COLUMN IF NOT EXISTS owner_review_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_alert_phone TEXT,
  ADD COLUMN IF NOT EXISTS owner_alert_quiet_start TIME NOT NULL DEFAULT '21:00',
  ADD COLUMN IF NOT EXISTS owner_alert_quiet_end   TIME NOT NULL DEFAULT '07:00';

-- ── 2. Generic platform → owner WhatsApp send queue ──────────────────────────
-- One row per message we intend to send from the official number, for any kind.
--   kind                = use-case discriminator (see header).
--   message             = human-readable rendering; used by the dev log sender
--                         and stored for history/UI.
--   template_name       = Cloud API template to use; NULL = the sender's default
--                         (lets each kind map to its own approved template).
--   template_params     = ordered template body variables (Cloud API requires a
--                         pre-approved template for business-initiated sends).
--   metadata            = kind-specific extras (e.g. {"pending_count": 3}).
--   channel             = which sender produced the row ('cloud_api' | 'log').
--   provider_message_id = Meta wamid returned on send, kept for delivery tracing.

CREATE TABLE IF NOT EXISTS public.platform_whatsapp_notifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL DEFAULT 'approval_alert',
  to_phone            TEXT NOT NULL,
  message             TEXT NOT NULL,
  template_name       TEXT,
  template_params     JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel             TEXT NOT NULL DEFAULT 'cloud_api',
  provider_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ,
  error_message       TEXT,
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Worker hot-path: fetch pending rows that are due (next_attempt_at NULL or past).
CREATE INDEX IF NOT EXISTS platform_whatsapp_notifications_due_idx
  ON public.platform_whatsapp_notifications (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS platform_whatsapp_notifications_business_idx
  ON public.platform_whatsapp_notifications (business_id, kind, created_at DESC);

-- One pending message per (business, kind) at a time: batching for a given kind,
-- and an approval_alert never blocks a revenue_summary. A second enqueue while
-- one of the same kind is still pending is a no-op rather than a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS platform_whatsapp_notifications_pending_uniq
  ON public.platform_whatsapp_notifications (business_id, kind)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS platform_whatsapp_notifications_updated_at ON public.platform_whatsapp_notifications;
CREATE TRIGGER platform_whatsapp_notifications_updated_at
  BEFORE UPDATE ON public.platform_whatsapp_notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.platform_whatsapp_notifications ENABLE ROW LEVEL SECURITY;

-- Owners may read their own notification history; all writes go through the
-- service-role worker, which bypasses RLS.
DROP POLICY IF EXISTS "platform_whatsapp_notifications_select_own" ON public.platform_whatsapp_notifications;
CREATE POLICY "platform_whatsapp_notifications_select_own" ON public.platform_whatsapp_notifications
  FOR SELECT USING (public.user_owns_business(business_id));

-- ── 3. Per-business throttle / cooldown state (approval-alert kind) ──────────
-- last_pinged_at      = when we last sent an approval alert; the worker enforces
--                       a cooldown window off this so we never re-ping too often.
-- last_pinged_count   = pending draft count at the last ping; lets the worker
--                       re-ping early if NEW drafts arrived (count grew), not
--                       just on a timer.
-- pings_today / day   = daily hard cap so a pathological day can't spam the owner.
-- snoozed_until       = owner-initiated mute set from the UI; honoured like quiet
--                       hours.

CREATE TABLE IF NOT EXISTS public.owner_approval_alert_state (
  business_id       UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  last_pinged_at    TIMESTAMPTZ,
  last_pinged_count INTEGER NOT NULL DEFAULT 0,
  pings_today       INTEGER NOT NULL DEFAULT 0,
  pings_day         DATE,
  snoozed_until     TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.owner_approval_alert_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_approval_alert_state_select_own" ON public.owner_approval_alert_state;
CREATE POLICY "owner_approval_alert_state_select_own" ON public.owner_approval_alert_state
  FOR SELECT USING (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS owner_approval_alert_state_updated_at ON public.owner_approval_alert_state;
CREATE TRIGGER owner_approval_alert_state_updated_at
  BEFORE UPDATE ON public.owner_approval_alert_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
