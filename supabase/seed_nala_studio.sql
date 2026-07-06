-- Seed demo data for "Nala Studio" (salon) so the dashboard has realistic
-- content for marketing screenshots.
--
-- HOW TO USE
-- 1. Sign up for real at /signup with email: dylanhunterolsen12@gmail.com
--    Business name: Nala Studio   Industry: Salon (or closest match)
--    Signing up auto-creates the `businesses` row via the on_auth_user_created
--    trigger — this script does NOT create the business itself, it only
--    looks it up by your auth email and attaches demo data to it.
-- 2. Paste this whole file into the Supabase SQL Editor and run it.
-- 3. Safe to re-run: every insert uses a fixed UUID + ON CONFLICT DO NOTHING,
--    so running it twice will not duplicate rows.
--
-- Seeds: 4 staff, 8 services, 18 clients, 35 bookings (mix of
-- completed/cancelled/no_show/confirmed/pending, spread across the past
-- ~24 days and next ~14 days), 18 payments.

DO $$
DECLARE
  biz_id UUID;
BEGIN
  SELECT b.id INTO biz_id
  FROM public.businesses b
  JOIN auth.users u ON u.id = b.user_id
  WHERE u.email = 'dylanhunterolsen12@gmail.com';

  IF biz_id IS NULL THEN
    RAISE EXCEPTION 'No business found for dylanhunterolsen12@gmail.com — sign up at /signup first, then re-run this script.';
  END IF;

  RAISE NOTICE 'Seeding business_id %', biz_id;

  -- ===================== STAFF =====================
  INSERT INTO public.staff_members (id, business_id, name, position, email, phone, is_active, working_days)
  VALUES
    ('a0a0a0a0-0000-0000-0000-000000000001', biz_id, 'Natalie', 'Stylist', 'natalie@nalastudio.co.za', '+27821234001', true, ARRAY['monday','tuesday','wednesday','thursday','friday']),
    ('a0a0a0a0-0000-0000-0000-000000000002', biz_id, 'Tyrone Olsen', 'Manager', 'tyrone@nalastudio.co.za', '+27821234002', true, ARRAY['monday','tuesday','wednesday','thursday','friday','saturday']),
    ('a0a0a0a0-0000-0000-0000-000000000003', biz_id, 'Zanele Khumalo', 'Colorist', 'zanele@nalastudio.co.za', '+27821234003', true, ARRAY['tuesday','wednesday','thursday','friday','saturday']),
    ('a0a0a0a0-0000-0000-0000-000000000004', biz_id, 'Kabelo Mokoena', 'Nail Technician', 'kabelo@nalastudio.co.za', '+27821234004', true, ARRAY['monday','wednesday','thursday','friday','saturday'])
  ON CONFLICT (id) DO NOTHING;

  -- ===================== SERVICES =====================
  INSERT INTO public.services (id, business_id, name, description, price, duration, color, is_active, deposit_required, deposit_amount)
  VALUES
    ('b0b0b0b0-0000-0000-0000-000000000001', biz_id, 'Nails', 'The best nails in town', 600, 60, '#10b981', true, true, 150),
    ('b0b0b0b0-0000-0000-0000-000000000002', biz_id, 'Styling', 'Get the best styles in the city', 399, 60, '#0ea5e9', true, false, 0),
    ('b0b0b0b0-0000-0000-0000-000000000003', biz_id, 'Haircut & Blow Dry', 'Wash, cut, and finish', 350, 60, '#f59e0b', true, false, 0),
    ('b0b0b0b0-0000-0000-0000-000000000004', biz_id, 'Full Color', 'All-over color with premium products', 850, 120, '#a855f7', true, true, 200),
    ('b0b0b0b0-0000-0000-0000-000000000005', biz_id, 'Balayage', 'Hand-painted highlights for a natural look', 1200, 180, '#ec4899', true, true, 300),
    ('b0b0b0b0-0000-0000-0000-000000000006', biz_id, 'Manicure', 'Classic manicure with polish', 280, 45, '#14b8a6', true, false, 0),
    ('b0b0b0b0-0000-0000-0000-000000000007', biz_id, 'Pedicure', 'Relaxing pedicure with polish', 320, 45, '#6366f1', true, false, 0),
    ('b0b0b0b0-0000-0000-0000-000000000008', biz_id, 'Brow Shape', 'Precision brow shaping and tint', 180, 30, '#84cc16', true, false, 0)
  ON CONFLICT (id) DO NOTHING;

  -- ===================== CLIENTS =====================
  INSERT INTO public.clients (id, business_id, name, phone, email, client_type, no_show_count, notes)
  VALUES
    ('c0c0c0c0-0000-0000-0000-000000000001', biz_id, 'Thandi Nkosi', '+27821234501', 'thandi.nkosi@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000002', biz_id, 'Sipho Dlamini', '+27821234502', 'sipho.d@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000003', biz_id, 'Amahle Mokoena', '+27821234503', 'amahle.m@gmail.com', 'vip', 0, 'Prefers Natalie'),
    ('c0c0c0c0-0000-0000-0000-000000000004', biz_id, 'Johan van der Merwe', '+27821234504', 'johan.vdm@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000005', biz_id, 'Lerato Sithole', '+27821234505', 'lerato.s@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000006', biz_id, 'Kagiso Mahlangu', '+27821234506', 'kagiso.m@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000007', biz_id, 'Nomvula Zulu', '+27821234507', 'nomvula.z@gmail.com', 'vip', 0, 'Allergic to ammonia-based color'),
    ('c0c0c0c0-0000-0000-0000-000000000008', biz_id, 'Pieter Botha', '+27821234508', 'pieter.b@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000009', biz_id, 'Zinhle Ndlovu', '+27821234509', 'zinhle.n@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000010', biz_id, 'Bongani Khumalo', '+27821234510', 'bongani.k@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000011', biz_id, 'Chantelle Adams', '+27821234511', 'chantelle.a@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000012', biz_id, 'Tumi Radebe', '+27821234512', 'tumi.r@gmail.com', 'vip', 0, 'Books Balayage every 6 weeks'),
    ('c0c0c0c0-0000-0000-0000-000000000013', biz_id, 'Marco Ferreira', '+27821234513', 'marco.f@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000014', biz_id, 'Precious Mabaso', '+27821234514', 'precious.m@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000015', biz_id, 'Ayesha Patel', '+27821234515', 'ayesha.p@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000016', biz_id, 'Wian Coetzee', '+27821234516', 'wian.c@gmail.com', 'returning', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000017', biz_id, 'Nokuthula Mthembu', '+27821234517', 'nokuthula.m@gmail.com', 'new', 0, NULL),
    ('c0c0c0c0-0000-0000-0000-000000000018', biz_id, 'Ryan de Wet', '+27821234518', 'ryan.dw@gmail.com', 'returning', 2, 'Missed last two appointments, confirm by phone')
  ON CONFLICT (id) DO NOTHING;

  -- ===================== BOOKINGS =====================
  -- start_time/status/notes are explicit; end_time, total_amount, and
  -- deposit_paid are derived from the linked service so they always stay
  -- consistent with the services table above.
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
    ('d0d0d0d0-0000-0000-0000-000000000001'::uuid, 'c0c0c0c0-0000-0000-0000-000000000001'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '24 days' + interval '9 hours',  'completed'::text, NULL::text),
    ('d0d0d0d0-0000-0000-0000-000000000002'::uuid, 'c0c0c0c0-0000-0000-0000-000000000002'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '20 days' + interval '10 hours', 'cancelled', 'Client rescheduled'),
    ('d0d0d0d0-0000-0000-0000-000000000003'::uuid, 'c0c0c0c0-0000-0000-0000-000000000003'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '17 days' + interval '11 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000004'::uuid, 'c0c0c0c0-0000-0000-0000-000000000004'::uuid, 'b0b0b0b0-0000-0000-0000-000000000004'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '13 days' + interval '12 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000005'::uuid, 'c0c0c0c0-0000-0000-0000-000000000005'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '9 days' + interval '13 hours', 'no_show', 'Did not arrive, no call'),
    ('d0d0d0d0-0000-0000-0000-000000000006'::uuid, 'c0c0c0c0-0000-0000-0000-000000000006'::uuid, 'b0b0b0b0-0000-0000-0000-000000000006'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '5 days' + interval '14 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000007'::uuid, 'c0c0c0c0-0000-0000-0000-000000000007'::uuid, 'b0b0b0b0-0000-0000-0000-000000000007'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) - interval '2 days' + interval '15 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000008'::uuid, 'c0c0c0c0-0000-0000-0000-000000000008'::uuid, 'b0b0b0b0-0000-0000-0000-000000000008'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '1 days' + interval '16 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000009'::uuid, 'c0c0c0c0-0000-0000-0000-000000000009'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '4 days' + interval '17 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000000a'::uuid, 'c0c0c0c0-0000-0000-0000-000000000010'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000001'::uuid, date_trunc('day', now()) + interval '8 days' + interval '9 hours',  'pending', 'Requested Natalie specifically'),

    -- Tyrone Olsen
    ('d0d0d0d0-0000-0000-0000-00000000000b'::uuid, 'c0c0c0c0-0000-0000-0000-000000000011'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '23 days' + interval '10 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000000c'::uuid, 'c0c0c0c0-0000-0000-0000-000000000012'::uuid, 'b0b0b0b0-0000-0000-0000-000000000004'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '19 days' + interval '11 hours', 'cancelled', 'Client was ill'),
    ('d0d0d0d0-0000-0000-0000-00000000000d'::uuid, 'c0c0c0c0-0000-0000-0000-000000000013'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '15 days' + interval '12 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000000e'::uuid, 'c0c0c0c0-0000-0000-0000-000000000014'::uuid, 'b0b0b0b0-0000-0000-0000-000000000006'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '11 days' + interval '13 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000000f'::uuid, 'c0c0c0c0-0000-0000-0000-000000000015'::uuid, 'b0b0b0b0-0000-0000-0000-000000000007'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '7 days' + interval '14 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000010'::uuid, 'c0c0c0c0-0000-0000-0000-000000000016'::uuid, 'b0b0b0b0-0000-0000-0000-000000000008'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) - interval '3 days' + interval '15 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000011'::uuid, 'c0c0c0c0-0000-0000-0000-000000000017'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '2 days' + interval '16 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000012'::uuid, 'c0c0c0c0-0000-0000-0000-000000000018'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '6 days' + interval '17 hours', 'confirmed', 'Confirm by phone — history of no-shows'),
    ('d0d0d0d0-0000-0000-0000-000000000013'::uuid, 'c0c0c0c0-0000-0000-0000-000000000001'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000002'::uuid, date_trunc('day', now()) + interval '10 days' + interval '9 hours',  'pending', NULL),

    -- Zanele Khumalo
    ('d0d0d0d0-0000-0000-0000-000000000014'::uuid, 'c0c0c0c0-0000-0000-0000-000000000002'::uuid, 'b0b0b0b0-0000-0000-0000-000000000004'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) - interval '22 days' + interval '10 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000015'::uuid, 'c0c0c0c0-0000-0000-0000-000000000003'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) - interval '18 days' + interval '11 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000016'::uuid, 'c0c0c0c0-0000-0000-0000-000000000004'::uuid, 'b0b0b0b0-0000-0000-0000-000000000006'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) - interval '14 days' + interval '12 hours', 'no_show', 'Did not arrive'),
    ('d0d0d0d0-0000-0000-0000-000000000017'::uuid, 'c0c0c0c0-0000-0000-0000-000000000005'::uuid, 'b0b0b0b0-0000-0000-0000-000000000007'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) - interval '10 days' + interval '13 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000018'::uuid, 'c0c0c0c0-0000-0000-0000-000000000006'::uuid, 'b0b0b0b0-0000-0000-0000-000000000008'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) - interval '6 days' + interval '14 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000019'::uuid, 'c0c0c0c0-0000-0000-0000-000000000007'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '3 days' + interval '15 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000001a'::uuid, 'c0c0c0c0-0000-0000-0000-000000000008'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '7 days' + interval '16 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000001b'::uuid, 'c0c0c0c0-0000-0000-0000-000000000009'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000003'::uuid, date_trunc('day', now()) + interval '12 days' + interval '9 hours',  'pending', NULL),

    -- Kabelo Mokoena
    ('d0d0d0d0-0000-0000-0000-00000000001c'::uuid, 'c0c0c0c0-0000-0000-0000-000000000010'::uuid, 'b0b0b0b0-0000-0000-0000-000000000004'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) - interval '21 days' + interval '9 hours',  'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000001d'::uuid, 'c0c0c0c0-0000-0000-0000-000000000011'::uuid, 'b0b0b0b0-0000-0000-0000-000000000005'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) - interval '16 days' + interval '10 hours', 'cancelled', 'Double-booked, rescheduled by phone'),
    ('d0d0d0d0-0000-0000-0000-00000000001e'::uuid, 'c0c0c0c0-0000-0000-0000-000000000012'::uuid, 'b0b0b0b0-0000-0000-0000-000000000006'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) - interval '12 days' + interval '11 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-00000000001f'::uuid, 'c0c0c0c0-0000-0000-0000-000000000013'::uuid, 'b0b0b0b0-0000-0000-0000-000000000007'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) - interval '8 days' + interval '12 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000020'::uuid, 'c0c0c0c0-0000-0000-0000-000000000014'::uuid, 'b0b0b0b0-0000-0000-0000-000000000008'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) - interval '4 days' + interval '13 hours', 'completed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000021'::uuid, 'c0c0c0c0-0000-0000-0000-000000000015'::uuid, 'b0b0b0b0-0000-0000-0000-000000000001'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '5 days' + interval '14 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000022'::uuid, 'c0c0c0c0-0000-0000-0000-000000000016'::uuid, 'b0b0b0b0-0000-0000-0000-000000000002'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '9 days' + interval '15 hours', 'confirmed', NULL),
    ('d0d0d0d0-0000-0000-0000-000000000023'::uuid, 'c0c0c0c0-0000-0000-0000-000000000017'::uuid, 'b0b0b0b0-0000-0000-0000-000000000003'::uuid, 'a0a0a0a0-0000-0000-0000-000000000004'::uuid, date_trunc('day', now()) + interval '14 days' + interval '16 hours', 'pending', NULL)
  ) AS v(id, client_id, service_id, staff_id, start_time, status, notes)
  JOIN public.services svc ON svc.id = v.service_id
  ON CONFLICT (id) DO NOTHING;

  -- ===================== PAYMENTS =====================
  -- 12 full payments against completed bookings, 4 deposits against the
  -- upcoming confirmed Nails bookings, 1 refund against a cancelled
  -- booking, and 1 cash walk-in sale not linked to any booking.
  INSERT INTO public.payments (id, business_id, client_id, booking_id, amount, method, status, type, paid_at, notes)
  VALUES
    ('e0e0e0e0-0000-0000-0000-000000000001', biz_id, 'c0c0c0c0-0000-0000-0000-000000000001', 'd0d0d0d0-0000-0000-0000-000000000001', 600,  'payfast', 'completed', 'full_payment', date_trunc('day', now()) - interval '24 days' + interval '9 hours',  NULL),
    ('e0e0e0e0-0000-0000-0000-000000000002', biz_id, 'c0c0c0c0-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-000000000003', 350,  'cash',    'completed', 'full_payment', date_trunc('day', now()) - interval '17 days' + interval '11 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000003', biz_id, 'c0c0c0c0-0000-0000-0000-000000000004', 'd0d0d0d0-0000-0000-0000-000000000004', 850,  'yoco',    'completed', 'full_payment', date_trunc('day', now()) - interval '13 days' + interval '12 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000004', biz_id, 'c0c0c0c0-0000-0000-0000-000000000006', 'd0d0d0d0-0000-0000-0000-000000000006', 280,  'eft',     'completed', 'full_payment', date_trunc('day', now()) - interval '5 days' + interval '14 hours',  NULL),
    ('e0e0e0e0-0000-0000-0000-000000000005', biz_id, 'c0c0c0c0-0000-0000-0000-000000000007', 'd0d0d0d0-0000-0000-0000-000000000007', 320,  'payfast', 'completed', 'full_payment', date_trunc('day', now()) - interval '2 days' + interval '15 hours',  NULL),
    ('e0e0e0e0-0000-0000-0000-000000000006', biz_id, 'c0c0c0c0-0000-0000-0000-000000000011', 'd0d0d0d0-0000-0000-0000-00000000000b', 350,  'cash',    'completed', 'full_payment', date_trunc('day', now()) - interval '23 days' + interval '10 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000007', biz_id, 'c0c0c0c0-0000-0000-0000-000000000013', 'd0d0d0d0-0000-0000-0000-00000000000d', 1200, 'yoco',    'completed', 'full_payment', date_trunc('day', now()) - interval '15 days' + interval '12 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000008', biz_id, 'c0c0c0c0-0000-0000-0000-000000000014', 'd0d0d0d0-0000-0000-0000-00000000000e', 280,  'eft',     'pending',   'full_payment', date_trunc('day', now()) - interval '11 days' + interval '13 hours', 'EFT awaiting bank clearance'),
    ('e0e0e0e0-0000-0000-0000-000000000009', biz_id, 'c0c0c0c0-0000-0000-0000-000000000015', 'd0d0d0d0-0000-0000-0000-00000000000f', 320,  'payfast', 'completed', 'full_payment', date_trunc('day', now()) - interval '7 days' + interval '14 hours',  NULL),
    ('e0e0e0e0-0000-0000-0000-00000000000a', biz_id, 'c0c0c0c0-0000-0000-0000-000000000002', 'd0d0d0d0-0000-0000-0000-000000000014', 850,  'cash',    'completed', 'full_payment', date_trunc('day', now()) - interval '22 days' + interval '10 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-00000000000b', biz_id, 'c0c0c0c0-0000-0000-0000-000000000003', 'd0d0d0d0-0000-0000-0000-000000000015', 1200, 'yoco',    'completed', 'full_payment', date_trunc('day', now()) - interval '18 days' + interval '11 hours', NULL),
    ('e0e0e0e0-0000-0000-0000-00000000000c', biz_id, 'c0c0c0c0-0000-0000-0000-000000000010', 'd0d0d0d0-0000-0000-0000-00000000001c', 850,  'eft',     'completed', 'full_payment', date_trunc('day', now()) - interval '21 days' + interval '9 hours',  NULL),

    -- Deposits on upcoming confirmed Nails bookings
    ('e0e0e0e0-0000-0000-0000-00000000000d', biz_id, 'c0c0c0c0-0000-0000-0000-000000000009', 'd0d0d0d0-0000-0000-0000-000000000009', 150, 'payfast', 'completed', 'deposit', now() - interval '2 days', NULL),
    ('e0e0e0e0-0000-0000-0000-00000000000e', biz_id, 'c0c0c0c0-0000-0000-0000-000000000017', 'd0d0d0d0-0000-0000-0000-000000000011', 150, 'payfast', 'completed', 'deposit', now() - interval '1 days', NULL),
    ('e0e0e0e0-0000-0000-0000-00000000000f', biz_id, 'c0c0c0c0-0000-0000-0000-000000000007', 'd0d0d0d0-0000-0000-0000-000000000019', 150, 'yoco',    'completed', 'deposit', now() - interval '3 days', NULL),
    ('e0e0e0e0-0000-0000-0000-000000000010', biz_id, 'c0c0c0c0-0000-0000-0000-000000000015', 'd0d0d0d0-0000-0000-0000-000000000021', 150, 'eft',     'completed', 'deposit', now() - interval '1 days', NULL),

    -- Refund on a cancelled booking's deposit
    ('e0e0e0e0-0000-0000-0000-000000000011', biz_id, 'c0c0c0c0-0000-0000-0000-000000000012', 'd0d0d0d0-0000-0000-0000-00000000000c', 200, 'payfast', 'refunded', 'refund', date_trunc('day', now()) - interval '19 days' + interval '11 hours', 'Client was ill, deposit refunded'),

    -- Walk-in cash sale, not linked to any booking
    ('e0e0e0e0-0000-0000-0000-000000000012', biz_id, 'c0c0c0c0-0000-0000-0000-000000000018', NULL, 180, 'cash', 'completed', 'full_payment', now() - interval '6 hours', 'Walk-in brow shape, no booking made')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Seed complete for business_id %', biz_id;
END $$;

-- Confirm what was seeded
SELECT
  (SELECT count(*) FROM public.staff_members s JOIN public.businesses b ON b.id = s.business_id JOIN auth.users u ON u.id = b.user_id WHERE u.email = 'dylanhunterolsen12@gmail.com') AS staff_count,
  (SELECT count(*) FROM public.services s JOIN public.businesses b ON b.id = s.business_id JOIN auth.users u ON u.id = b.user_id WHERE u.email = 'dylanhunterolsen12@gmail.com') AS service_count,
  (SELECT count(*) FROM public.clients c JOIN public.businesses b ON b.id = c.business_id JOIN auth.users u ON u.id = b.user_id WHERE u.email = 'dylanhunterolsen12@gmail.com') AS client_count,
  (SELECT count(*) FROM public.bookings bk JOIN public.businesses b ON b.id = bk.business_id JOIN auth.users u ON u.id = b.user_id WHERE u.email = 'dylanhunterolsen12@gmail.com') AS booking_count,
  (SELECT count(*) FROM public.payments p JOIN public.businesses b ON b.id = p.business_id JOIN auth.users u ON u.id = b.user_id WHERE u.email = 'dylanhunterolsen12@gmail.com') AS payment_count;
