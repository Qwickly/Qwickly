-- ============================================================================
-- Migration 070: Lock down public.meta_whatsapp_connections / meta_whatsapp_messages
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Supabase's linter flagged both tables (034, 035) as created without RLS,
-- which on this project means wide-open SELECT/INSERT/UPDATE/DELETE for the
-- anon/authenticated roles by default — and meta_whatsapp_connections holds a
-- live Meta Graph API `access_token` per business, so this was an active
-- credential leak, not just a lint nag.
--
-- Same treatment as payment_provider_credentials (068): RLS enabled with ZERO
-- policies. Every read/write of these tables already goes through
-- getSupabaseAdmin() (service role) in api-server and the whatsapp-send-message
-- / whatsapp-webhook edge functions (SUPABASE_SERVICE_ROLE_KEY) — none of that
-- is affected, since the service role bypasses RLS entirely.
--
-- The one browser-side usage — TopNav.tsx and marketing.tsx doing
-- `.from("meta_whatsapp_connections").select("id")` to render a "connected"
-- badge — would break under zero policies, so it's replaced with a narrow
-- SECURITY DEFINER RPC that returns a boolean and never exposes the row
-- (in particular, never exposes access_token) to the browser.
-- ============================================================================

ALTER TABLE public.meta_whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_whatsapp_messages ENABLE ROW LEVEL SECURITY;
-- No policies on either table. This denies all access to anon/authenticated;
-- only the service role (which bypasses RLS) can read or write.

CREATE OR REPLACE FUNCTION public.has_meta_whatsapp_connection(p_business_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meta_whatsapp_connections c
    WHERE c.business_id = p_business_id
      AND public.user_owns_business(p_business_id)
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.has_meta_whatsapp_connection(UUID) TO authenticated;
