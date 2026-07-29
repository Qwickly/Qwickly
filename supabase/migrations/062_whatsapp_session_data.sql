-- Migration 062: Create whatsapp_session_data table for persistent session archiving
-- This table stores a gzip-compressed archive of the Chromium/LocalAuth session
-- directory so that WhatsApp connections survive Railway container restarts and
-- volume reprovisioning. Enabled via WHATSAPP_SESSION_ARCHIVE_ENABLED=true.

CREATE TABLE IF NOT EXISTS whatsapp_session_data (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  -- gzip-compressed JSON archive, base64-encoded (see SessionArchive type in whatsapp.ts)
  session_archive text NOT NULL,
  saved_at     timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Only the service role (API server) should read/write this table.
-- No RLS needed because only the backend accesses it via service_role key.
ALTER TABLE whatsapp_session_data ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; deny everything else.
CREATE POLICY "No public access to whatsapp_session_data"
  ON whatsapp_session_data
  FOR ALL
  TO authenticated, anon
  USING (false);

-- Index for fast tenant lookups (the UNIQUE constraint already creates one,
-- but an explicit index makes the query planner's intent clear).
CREATE INDEX IF NOT EXISTS idx_whatsapp_session_data_tenant_id
  ON whatsapp_session_data (tenant_id);
