-- Staff portal: lets a staff_members row be linked to a real Supabase Auth
-- user, so the staff member can log in and see only their own bookings.
-- Separate from the pre-existing `team_members` table (owner/manager/staff
-- permission roles used on the main dashboard) — this is purely about the
-- bookable staff roster gaining self-service login.

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'not_invited';

ALTER TABLE public.staff_members
  DROP CONSTRAINT IF EXISTS staff_members_invite_status_check;

ALTER TABLE public.staff_members
  ADD CONSTRAINT staff_members_invite_status_check
  CHECK (invite_status IN ('not_invited', 'invited', 'active'));

CREATE UNIQUE INDEX IF NOT EXISTS staff_members_user_id_key
  ON public.staff_members (user_id)
  WHERE user_id IS NOT NULL;

-- A staff user can read their own roster row (their name/position/etc).
DROP POLICY IF EXISTS "staff_members_self_read" ON public.staff_members;
CREATE POLICY "staff_members_self_read" ON public.staff_members
  FOR SELECT
  USING (user_id = auth.uid());

-- A staff user can read bookings assigned to them.
DROP POLICY IF EXISTS "bookings_staff_read" ON public.bookings;
CREATE POLICY "bookings_staff_read" ON public.bookings
  FOR SELECT
  USING (
    staff_id IN (
      SELECT id FROM public.staff_members WHERE user_id = auth.uid()
    )
  );

-- Staff can flip a booking's status to completed/no_show, and only for
-- bookings assigned to them — deliberately narrower than a bookings UPDATE
-- policy so a staff account can never touch pricing, notes, or reassign the
-- booking to someone else.
CREATE OR REPLACE FUNCTION public.staff_update_booking_status(
  p_booking_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('completed', 'no_show') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE public.bookings
  SET status = p_status, updated_at = now()
  WHERE id = p_booking_id
    AND staff_id IN (
      SELECT id FROM public.staff_members WHERE user_id = auth.uid()
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found or not permitted';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_update_booking_status(uuid, text) TO authenticated;
