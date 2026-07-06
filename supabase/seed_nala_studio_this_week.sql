-- Adds extra bookings dated THIS WEEK (today through +6 days) on top of
-- seed_nala_studio.sql, so the calendar/week view has more to show right now.
--
-- Run seed_nala_studio.sql first if you haven't already — this script
-- references the same business/staff/service/client rows and will error
-- if they don't exist yet.
--
-- Safe to re-run: fixed UUIDs + ON CONFLICT DO NOTHING.
--
-- Checked against the existing 35 bookings before picking days below, so no
-- staff member gets double-booked on the same day (the DB also enforces
-- this for overlapping pending/confirmed bookings, so this would fail loudly
-- if it were wrong):
--   Natalie   already has day+1, day+4 this week -> new bookings use day 0, 3, 6
--   Tyrone    already has day+2, day+6 this week -> new bookings use day 0, 3, 5
--   Zanele    already has day+3 this week         -> new bookings use day 0, 2, 5
--   Kabelo    already has day+5 this week         -> new bookings use day 0, 2, 4

DO $$
DECLARE
  biz_id UUID;
BEGIN
  SELECT b.id INTO biz_id
  FROM public.businesses b
  JOIN auth.users u ON u.id = b.user_id
  WHERE u.email = 'dylanhunterolsen12@gmail.com';

  IF biz_id IS NULL THEN
    RAISE EXCEPTION 'No business found for dylanhunterolsen12@gmail.com — run seed_nala_studio.sql after signing up first.';
  END IF;

  INSERT INTO public.bookings (id, business_id, client_id, service_id, staff_id, start_time, end_time, status, deposit_paid, total_amount, notes)
  SELECT
    v.id,
    biz_id,
    v.client_id,
    v.service_id,
    v.staff_id,
    v.start_time,
    v.start_time + (svc.duration || ' minutes')::interval,
    v.status,
    (svc.deposit_required AND v.status IN ('completed', 'confirmed', 'no_show')),
    svc.price,
    v.notes
  FROM (VALUES
    -- Natalie
    ('d0d0d0d0-0000-0000-0000-000000000024'::uuid, 'c0c0c0c0-0000-0000-0000-000000000001'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '9 hours',                        'confirmed'::text, NULL::text),
    ('d0d0d0d0-0000-0000-0000-000000000025'::uuid, 'c0c0c0c0-0000-0000-0000-000000000005'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '3 days' + interval '11 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000026'::uuid, 'c0c0c0c0-0000-0000-0000-000000000009'::uuid, 'b0b0b0b0-0000-0000-0000-000000000008'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '6 days' + interval '14 hours', 'pending', NULL),

    -- Tyrone Olsen
    ('d0d0d0d0-0000-0000-0000-000000000027'::uuid, 'c0c0c0c0-0000-0000-0000-000000000002'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '10 hours',                       'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000028'::uuid, 'c0c0c0c0-0000-0000-0000-000000000006'::uuid, 'b0b0b0b0-0000-0000-0000-000000000006'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '3 days' + interval '12 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000029'::uuid, 'c0c0c0c0-0000-0000-0000-000000000010'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '5 days' + interval '15 hours', 'confirmed', NULL),

    -- Zanele Khumalo
    ('d0d0d0d0-0000-0000-0000-00000000002a'::uuid, 'c0c0c0c0-0000-0000-0000-000000000003'::uuid, 'b0b0b0b0-0000-0000-0000-000000000004'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '9 hours' + interval '30 minutes',  'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000002b'::uuid, 'c0c0c0c0-0000-0000-0000-000000000007'::uuid, 'b0b0b0b0-0000-0000-0000-000000000007'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '2 days' + interval '13 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000002c'::uuid, 'c0c0c0c0-0000-0000-0000-000000000011'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '5 days' + interval '16 hours', 'pending', NULL),

    -- Kabelo Mokoena
    ('d0d0d0d0-0000-0000-0000-00000000002d'::uuid, 'c0c0c0c0-0000-0000-0000-000000000004'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '10 hours' + interval '30 minutes', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000002e'::uuid, 'c0c0c0c0-0000-0000-0000-000000000008'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '2 days' + interval '12 hours' + interval '30 minutes', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000002f'::uuid, 'c0c0c0c0-0000-0000-0000-000000000012'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '4 days' + interval '15 hours' + interval '30 minutes', 'confirmed', NULL)
  ) AS v(id, client_id, service_id, staff_id, start_time, status, notes)
  JOIN public.services svc ON svc.id = v.service_id
  ON CONFLICT (id) DO NOTHING;

  -- Deposit payments for the 3 new confirmed bookings that use a
  -- deposit-required service (Nails / Full Color / Balayage), so
  -- deposit_paid=true on those bookings has a matching payment record.
  INSERT INTO public.payments (id, business_id, client_id, booking_id, amount, method, status, type, paid_at, notes)
  VALUES
    ('e0e0e0e0-0000-0000-0000-000000000013', biz_id, 'c0c0c0c0-0000-0000-0000-000000000010', 'd0d0d0d0-0000-0000-0000-000000000029', 150, 'payfast', 'completed', 'deposit', now() - interval '1 days', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000014', biz_id, 'c0c0c0c0-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-00000000002a', 200, 'yoco',    'completed', 'deposit', now() - interval '2 days', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000015', biz_id, 'c0c0c0c0-0000-0000-0000-000000000012', 'd0d0d0d0-0000-0000-0000-00000000002f', 300, 'eft',     'completed', 'deposit', now() - interval '1 days', NULL)
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Added this-week bookings for business_id %', biz_id;
END $$;

-- Confirm what's booked this week
SELECT bk.start_time, sm.name AS staff, c.name AS client, s.name AS service, bk.status
FROM public.bookings bk
JOIN public.businesses b ON b.id = bk.business_id
JOIN auth.users u ON u.id = b.user_id
JOIN public.staff_members sm ON sm.id = bk.staff_id
JOIN public.clients c ON c.id = bk.client_id
JOIN public.services s ON s.id = bk.service_id
WHERE u.email = 'dylanhunterolsen12@gmail.com'
  AND bk.start_time >= date_trunc('day', now())
  AND bk.start_time < date_trunc('day', now()) + interval '7 days'
ORDER BY bk.start_time;
