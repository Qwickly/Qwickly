-- Contact form submissions from the public marketing site (contact.html).
-- Inserted by the API server via service role only — no anon/auth policies.

CREATE TABLE IF NOT EXISTS public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  business_type TEXT NOT NULL DEFAULT '',
  help_with TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'replied', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON public.contact_submissions (created_at DESC);

-- Service role bypasses RLS; enabling it with no policies locks out anon/auth clients.
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;
