-- Team roles (Admin/User/Viewer) with real enforcement, on top of team_members.
-- Widens the role enum, adds invite/auth linkage (mirrors staff_members'
-- invite_status pattern), and retiers RLS on the tables the main dashboard
-- touches so restricted roles are enforced at the database, not just the UI.

-- ── 1. Widen the role enum ───────────────────────────────────────────────────
UPDATE public.team_members SET role = 'admin' WHERE role = 'manager';
UPDATE public.team_members SET role = 'user' WHERE role = 'staff';

ALTER TABLE public.team_members DROP CONSTRAINT IF EXISTS team_members_role_check;
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role IN ('owner', 'admin', 'user', 'viewer'));

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'not_invited';

ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_invite_status_check;
ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_invite_status_check
  CHECK (invite_status IN ('not_invited', 'invited', 'active'));

CREATE UNIQUE INDEX IF NOT EXISTS team_members_user_id_key
  ON public.team_members (user_id)
  WHERE user_id IS NOT NULL;

-- ── 2. Helper functions (SECURITY DEFINER, mirror user_owns_business) ───────
CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.user_owns_business(p_business_id)
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.business_id = p_business_id AND tm.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.is_business_editor(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.user_owns_business(p_business_id)
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.business_id = p_business_id AND tm.user_id = auth.uid() AND tm.role = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_business_operator(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.user_owns_business(p_business_id)
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.business_id = p_business_id AND tm.user_id = auth.uid() AND tm.role IN ('admin', 'user')
    );
$$;

-- Excludes role='user' — payments stay hidden from the "bookings+clients only" role.
CREATE OR REPLACE FUNCTION public.is_business_restricted_reader(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.user_owns_business(p_business_id)
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.business_id = p_business_id AND tm.user_id = auth.uid() AND tm.role IN ('admin', 'viewer')
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_editor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_operator(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_restricted_reader(uuid) TO authenticated;

-- ── 3. team_members: keep the owner-only ALL policy, add read-only policies ─
DROP POLICY IF EXISTS "team_members_self_read" ON public.team_members;
CREATE POLICY "team_members_self_read" ON public.team_members
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "team_members_read" ON public.team_members;
CREATE POLICY "team_members_read" ON public.team_members
  FOR SELECT
  USING (public.is_business_member(business_id));

-- ── 4. businesses: let team members read the business row; admins can edit it ─
DROP POLICY IF EXISTS "businesses_team_read" ON public.businesses;
CREATE POLICY "businesses_team_read" ON public.businesses
  FOR SELECT
  USING (public.is_business_member(id));

DROP POLICY IF EXISTS "businesses_admin_update" ON public.businesses;
CREATE POLICY "businesses_admin_update" ON public.businesses
  FOR UPDATE
  USING (public.is_business_editor(id))
  WITH CHECK (public.is_business_editor(id));

-- ── 5. Retier the single "*_all_own" ALL policies ────────────────────────────
-- Member-read / admin-write tables.
DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_events', 'booking_page_settings', 'whatsapp_bot_faqs',
    'whatsapp_bot_working_hours', 'whatsapp_bot_settings', 'client_notifications',
    'deposit_settings', 'business_operating_hours', 'marketing_campaign_recipients',
    'notification_settings', 'payment_provider_settings', 'whatsapp_reminders',
    'services', 'staff_members', 'staff_notifications', 'whatsapp_ai_drafts',
    'whatsapp_settings', 'booking_policies', 'marketing_campaigns', 'scheduled_campaigns'
  ] LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND qual LIKE '%user_owns_business(business_id)%'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_business_member(business_id))',
      t || '_member_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_business_editor(business_id)) WITH CHECK (public.is_business_editor(business_id))',
      t || '_editor_write', t
    );
  END LOOP;
END $$;

-- Member-read / operator-write tables (bookings, clients). Bookings keeps its
-- separate staff-portal policies (bookings_staff_read, and the
-- staff_update_booking_status RPC) — those are named/keyed differently and are
-- untouched by the drop loop below.
DO $$
DECLARE
  t text;
  pol record;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings', 'clients'] LOOP
    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND qual LIKE '%user_owns_business(business_id)%'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_business_member(business_id))',
      t || '_member_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (public.is_business_operator(business_id)) WITH CHECK (public.is_business_operator(business_id))',
      t || '_operator_write', t
    );
  END LOOP;
END $$;

-- Restricted-read / admin-write: payments (role='user' cannot see or touch payments).
DROP POLICY IF EXISTS "payments_all_own" ON public.payments;
DROP POLICY IF EXISTS "payments_restricted_read" ON public.payments;
CREATE POLICY "payments_restricted_read" ON public.payments
  FOR SELECT
  USING (public.is_business_restricted_reader(business_id));

DROP POLICY IF EXISTS "payments_editor_write" ON public.payments;
CREATE POLICY "payments_editor_write" ON public.payments
  FOR ALL
  USING (public.is_business_editor(business_id))
  WITH CHECK (public.is_business_editor(business_id));
