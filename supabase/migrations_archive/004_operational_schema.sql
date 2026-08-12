-- Operational data: services, clients, staff, bookings (scoped per business)

CREATE TABLE IF NOT EXISTS public.services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration        INTEGER NOT NULL DEFAULT 60 CHECK (duration >= 5),
  color           TEXT NOT NULL DEFAULT '#10b981',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  deposit_required BOOLEAN NOT NULL DEFAULT false,
  deposit_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS services_business_id_idx ON public.services(business_id);

CREATE TABLE IF NOT EXISTS public.clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  email         TEXT,
  client_type   TEXT NOT NULL DEFAULT 'new' CHECK (client_type IN ('new','returning','vip')),
  no_show_count INTEGER NOT NULL DEFAULT 0,
  avatar_url    TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_business_id_idx ON public.clients(business_id);

CREATE TABLE IF NOT EXISTS public.staff_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    TEXT NOT NULL DEFAULT '',
  email       TEXT,
  phone       TEXT,
  avatar_url  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_members_business_id_idx ON public.staff_members(business_id);

CREATE TABLE IF NOT EXISTS public.bookings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  service_id   UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  staff_id     UUID REFERENCES public.staff_members(id) ON DELETE SET NULL,
  start_time   TIMESTAMPTZ NOT NULL,
  end_time     TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'confirmed','pending','cancelled','completed','no_show'
  )),
  deposit_paid BOOLEAN NOT NULL DEFAULT false,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_business_id_idx ON public.bookings(business_id);
CREATE INDEX IF NOT EXISTS bookings_start_time_idx ON public.bookings(start_time);
CREATE INDEX IF NOT EXISTS bookings_client_id_idx ON public.bookings(client_id);

DROP TRIGGER IF EXISTS services_updated_at ON public.services;
CREATE TRIGGER services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS clients_updated_at ON public.clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS staff_members_updated_at ON public.staff_members;
CREATE TRIGGER staff_members_updated_at
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services_all_own" ON public.services;
CREATE POLICY "services_all_own" ON public.services
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "clients_all_own" ON public.clients;
CREATE POLICY "clients_all_own" ON public.clients
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "staff_all_own" ON public.staff_members;
CREATE POLICY "staff_all_own" ON public.staff_members
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "bookings_all_own" ON public.bookings;
CREATE POLICY "bookings_all_own" ON public.bookings
  FOR ALL USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));
