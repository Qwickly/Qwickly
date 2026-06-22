CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'whatsapp_session_status'
  ) THEN
    CREATE TYPE public.whatsapp_session_status AS ENUM ('qrcode', 'connected', 'disconnected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_owner_user_id_idx
  ON public.tenants(owner_user_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL UNIQUE,
  instance_token TEXT NOT NULL,
  status public.whatsapp_session_status NOT NULL DEFAULT 'disconnected',
  qr_code TEXT,
  connected_phone TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_sessions_status_idx
  ON public.whatsapp_sessions(status);

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  whatsapp_session_id UUID REFERENCES public.whatsapp_sessions(id) ON DELETE SET NULL,
  instance_id TEXT NOT NULL,
  message_id TEXT,
  remote_jid TEXT NOT NULL,
  sender_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  text_body TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inbound_messages_message_id_unique UNIQUE NULLS NOT DISTINCT (message_id)
);

CREATE INDEX IF NOT EXISTS inbound_messages_tenant_id_idx
  ON public.inbound_messages(tenant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS inbound_messages_instance_id_idx
  ON public.inbound_messages(instance_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_updated_at ON public.tenants;
CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS whatsapp_sessions_updated_at ON public.whatsapp_sessions;
CREATE TRIGGER whatsapp_sessions_updated_at
  BEFORE UPDATE ON public.whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.user_owns_tenant(p_tenant_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND t.owner_user_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.ensure_my_tenant()
RETURNS UUID AS $$
DECLARE
  tenant_id UUID;
  tenant_name TEXT;
BEGIN
  SELECT id
  INTO tenant_id
  FROM public.tenants
  WHERE owner_user_id = auth.uid();

  IF tenant_id IS NOT NULL THEN
    RETURN tenant_id;
  END IF;

  SELECT COALESCE(
    NULLIF(TRIM(raw_user_meta_data->>'business_name'), ''),
    NULLIF(TRIM(raw_user_meta_data->>'full_name'), ''),
    split_part(email, '@', 1),
    'Tenant'
  )
  INTO tenant_name
  FROM auth.users
  WHERE id = auth.uid();

  INSERT INTO public.tenants (owner_user_id, name)
  VALUES (auth.uid(), tenant_name)
  RETURNING id INTO tenant_id;

  RETURN tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenants_select_own" ON public.tenants;
CREATE POLICY "tenants_select_own" ON public.tenants
  FOR SELECT USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "tenants_insert_own" ON public.tenants;
CREATE POLICY "tenants_insert_own" ON public.tenants
  FOR INSERT WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "tenants_update_own" ON public.tenants;
CREATE POLICY "tenants_update_own" ON public.tenants
  FOR UPDATE USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "tenants_delete_own" ON public.tenants;
CREATE POLICY "tenants_delete_own" ON public.tenants
  FOR DELETE USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "whatsapp_sessions_all_own" ON public.whatsapp_sessions;
CREATE POLICY "whatsapp_sessions_all_own" ON public.whatsapp_sessions
  FOR ALL
  USING (public.user_owns_tenant(tenant_id))
  WITH CHECK (public.user_owns_tenant(tenant_id));

DROP POLICY IF EXISTS "inbound_messages_all_own" ON public.inbound_messages;
CREATE POLICY "inbound_messages_all_own" ON public.inbound_messages
  FOR ALL
  USING (public.user_owns_tenant(tenant_id))
  WITH CHECK (public.user_owns_tenant(tenant_id));

GRANT EXECUTE ON FUNCTION public.ensure_my_tenant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_owns_tenant(UUID) TO authenticated;
