-- ============================================================================
-- Migration 058: Enforce the bookable-staff seat limit
-- Run this in Supabase SQL Editor: Dashboard → SQL → New query
-- ============================================================================
-- Staff seats are a paid entitlement: base plan (Starter = 1) plus each
-- purchased Additional Staff seat (R20). But staff are created by a DIRECT
-- Supabase insert from the browser (lib/catalog.ts createStaff), which bypasses
-- any api-server middleware — so the only place this can be enforced for real is
-- a database trigger.
--
-- Mirrors the seat calculation in the entitlement resolver
-- (artifacts/api-server/src/lib/entitlements.ts): allowed = plan.staff +
-- Σ active extra_staff quantity. A NULL plan.staff means unlimited
-- (dev_full_access). Only is_active staff count toward the limit, so archiving
-- frees a seat.
--
-- No live subscription is fail-closed. Staff rows are inserted directly from the
-- browser, so allowing no-subscription inserts here would turn lapsed/no-plan
-- accounts into unlimited-seat accounts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_staff_seat_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_sub_id        UUID;
  v_plan_meta     JSONB;
  v_plan_staff    INTEGER;
  v_extra         INTEGER;
  v_allowed       INTEGER;
  v_current       INTEGER;
BEGIN
  -- Only enforce when this row will occupy a seat:
  --   INSERT of an active staff member, or
  --   UPDATE that flips an archived member back to active.
  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(NEW.is_active, true) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT (COALESCE(NEW.is_active, true) AND NOT COALESCE(OLD.is_active, true)) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- The live subscription decides the allowance.
  SELECT s.id, p.metadata
    INTO v_sub_id, v_plan_meta
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.business_id = NEW.business_id
    AND s.status IN ('active', 'trialing')
  ORDER BY s.created_at DESC
  LIMIT 1;

  -- No live subscription → no paid staff entitlement.
  IF v_sub_id IS NULL THEN
    RAISE EXCEPTION
      'staff_seat_limit_reached: no active subscription grants bookable staff seats.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- NULL plan.staff = unlimited.
  IF v_plan_meta->'staff' IS NULL OR jsonb_typeof(v_plan_meta->'staff') = 'null' THEN
    RETURN NEW;
  END IF;
  v_plan_staff := (v_plan_meta->>'staff')::INTEGER;

  -- Purchased extra seats that are still active (not scheduled-removed and past it).
  SELECT COALESCE(SUM(sa.quantity), 0)
    INTO v_extra
  FROM public.subscription_addons sa
  WHERE sa.subscription_id = v_sub_id
    AND sa.addon_id = 'extra_staff'
    AND (sa.remove_at IS NULL OR sa.remove_at > now());

  v_allowed := v_plan_staff + COALESCE(v_extra, 0);

  -- Count seats already occupied, excluding this row (matters on UPDATE).
  SELECT COUNT(*)
    INTO v_current
  FROM public.staff_members
  WHERE business_id = NEW.business_id
    AND is_active = true
    AND id <> NEW.id;

  IF v_current >= v_allowed THEN
    RAISE EXCEPTION
      'staff_seat_limit_reached: your plan includes % bookable staff. Add an Additional Staff seat to add more.',
      v_allowed
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS staff_members_seat_limit ON public.staff_members;
CREATE TRIGGER staff_members_seat_limit
  BEFORE INSERT OR UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_staff_seat_limit();
