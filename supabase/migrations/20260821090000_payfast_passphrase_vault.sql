-- Move PayFast passphrases out of a plaintext column and into Supabase Vault.
--
-- WHAT THE PASSPHRASE IS
-- ----------------------
-- It is PayFast's signing secret, not a spending credential. Holding a
-- merchant's id + key + passphrase does not let anyone withdraw their money —
-- but it does let them forge a valid ITN, which marks a payment `completed`
-- without a cent moving. That is a fraud-and-reconciliation problem, and it
-- gets worse with every merchant we sign up.
--
-- WHY THE CURRENT STORAGE IS NOT ENOUGH
-- ------------------------------------
-- `payment_provider_credentials` already has RLS on with no policies, so `anon`
-- and `authenticated` cannot read it at all, and the API never echoes the
-- passphrase back. That covers the browser. It does not cover a database dump,
-- a leaked service-role key, or anyone with dashboard access — all of whom
-- currently read every merchant's passphrase in the clear.
--
-- HOW VAULT CHANGES THAT
-- ----------------------
-- `vault.create_secret()` stores the value encrypted with a key that lives in
-- Supabase's infrastructure rather than in the database. A `pg_dump` of these
-- tables contains ciphertext and a secret id, and neither is any use on its
-- own. Decryption happens through `vault.decrypted_secrets`, which only
-- elevated roles can read — so this migration wraps both directions in
-- SECURITY DEFINER functions and grants them to `service_role` alone.
--
-- The api-server is the only caller, and it already holds the service-role key.

ALTER TABLE public.payment_provider_credentials
  ADD COLUMN IF NOT EXISTS passphrase_secret_id UUID;

COMMENT ON COLUMN public.payment_provider_credentials.passphrase IS
  'DEPRECATED — plaintext, nulled by migration 20260821090000. Read through get_payfast_passphrase() instead. Kept only so an in-flight deploy of the old server code cannot crash on a missing column; drop once the fleet is on the new build.';

COMMENT ON COLUMN public.payment_provider_credentials.passphrase_secret_id IS
  'vault.secrets id holding this merchant''s PayFast passphrase. NULL means the merchant has no passphrase set on their PayFast account, which is a valid configuration.';


-- ── Write ────────────────────────────────────────────────────────────────────
-- Creates the secret on first use and updates it afterwards, so re-saving
-- credentials does not leave a trail of orphaned secrets. Passing NULL or an
-- empty string clears it, which is how a merchant who removes their PayFast
-- passphrase gets that reflected here.
CREATE OR REPLACE FUNCTION public.set_payfast_passphrase(
  p_business_id UUID,
  p_passphrase TEXT
) RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'vault'
AS $$
DECLARE
  v_secret_id UUID;
BEGIN
  SELECT passphrase_secret_id INTO v_secret_id
  FROM public.payment_provider_credentials
  WHERE business_id = p_business_id;

  IF p_passphrase IS NULL OR btrim(p_passphrase) = '' THEN
    IF v_secret_id IS NOT NULL THEN
      DELETE FROM vault.secrets WHERE id = v_secret_id;
    END IF;

    UPDATE public.payment_provider_credentials
    SET passphrase_secret_id = NULL, passphrase = NULL
    WHERE business_id = p_business_id;
    RETURN;
  END IF;

  IF v_secret_id IS NULL THEN
    -- The name has to be unique across the vault, and the business id is the
    -- one identifier that is already unique per row here.
    v_secret_id := vault.create_secret(
      p_passphrase,
      'payfast_passphrase_' || p_business_id::text,
      'PayFast signing passphrase for business ' || p_business_id::text
    );
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_passphrase);
  END IF;

  UPDATE public.payment_provider_credentials
  SET passphrase_secret_id = v_secret_id,
      -- Belt and braces: never leave a copy behind in the old column.
      passphrase = NULL
  WHERE business_id = p_business_id;
END;
$$;


-- ── Read ─────────────────────────────────────────────────────────────────────
-- Returns NULL when the merchant has no passphrase, which the signing code
-- already treats as "sign without one" — PayFast makes the passphrase optional.
CREATE OR REPLACE FUNCTION public.get_payfast_passphrase(p_business_id UUID)
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'vault'
AS $$
DECLARE
  v_secret_id UUID;
  v_secret TEXT;
BEGIN
  SELECT passphrase_secret_id INTO v_secret_id
  FROM public.payment_provider_credentials
  WHERE business_id = p_business_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  RETURN v_secret;
END;
$$;


-- ── Who may call these ───────────────────────────────────────────────────────
-- A SECURITY DEFINER function runs with the privileges of its owner, so leaving
-- these executable by `authenticated` would hand every signed-in user a way to
-- read any business's passphrase by id. Only the api-server's service role.
REVOKE ALL ON FUNCTION public.set_payfast_passphrase(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payfast_passphrase(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_payfast_passphrase(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payfast_passphrase(UUID) TO service_role;


-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every passphrase already stored in the clear moves into the vault and is
-- cleared from the column. Idempotent: rows that already have a secret id, or
-- that never had a passphrase, are skipped.
DO $$
DECLARE
  row RECORD;
BEGIN
  FOR row IN
    SELECT business_id, passphrase
    FROM public.payment_provider_credentials
    WHERE passphrase IS NOT NULL
      AND btrim(passphrase) <> ''
      AND passphrase_secret_id IS NULL
  LOOP
    PERFORM public.set_payfast_passphrase(row.business_id, row.passphrase);
  END LOOP;
END;
$$;
