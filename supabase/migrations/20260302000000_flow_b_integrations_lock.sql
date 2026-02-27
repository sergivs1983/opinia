-- supabase/migrations/20260302000000_flow_b_integrations_lock.sql
--
-- Flow B — Google OAuth: integrations status + refresh mutex columns + RPCs.
--
-- Adds to integrations:
--   status             — connection health ('connected' | 'needs_reauth' | 'disconnected')
--   refresh_lock_until — mutex TTL (30 s); NULL = unlocked
--   refresh_lock_nonce — nonce UUID for lock validation; NULL = unlocked
--   last_refresh_at    — last successful token refresh
--   last_error_code    — last error code (e.g. 'invalid_grant')
--   last_error_at      — timestamp of last error
--
-- RPCs (SECURITY DEFINER, GRANT service_role only):
--   claim_google_refresh_lock(p_integration_id)          -> uuid | null
--   confirm_google_refresh(p_integration_id, p_nonce, …) -> void
--   fail_google_refresh(p_integration_id, p_nonce, …)    -> void
--
-- Idempotent: safe to re-run.

-- ─── New columns on integrations ──────────────────────────────────────────────

ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS status
    text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'needs_reauth', 'disconnected')),
  ADD COLUMN IF NOT EXISTS refresh_lock_until  timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_lock_nonce  uuid,
  ADD COLUMN IF NOT EXISTS last_refresh_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code     text,
  ADD COLUMN IF NOT EXISTS last_error_at       timestamptz;

COMMENT ON COLUMN public.integrations.status           IS 'Connection health: connected | needs_reauth | disconnected.';
COMMENT ON COLUMN public.integrations.refresh_lock_until IS 'Distributed mutex TTL. NULL = unlocked.';
COMMENT ON COLUMN public.integrations.refresh_lock_nonce IS 'Nonce matching the current lock holder. NULL = unlocked.';
COMMENT ON COLUMN public.integrations.last_refresh_at  IS 'Timestamp of last successful token refresh.';
COMMENT ON COLUMN public.integrations.last_error_code  IS 'Last refresh error code (e.g. invalid_grant).';
COMMENT ON COLUMN public.integrations.last_error_at    IS 'Timestamp of last refresh error.';

-- Index: worker queries by status to skip needs_reauth integrations
CREATE INDEX IF NOT EXISTS idx_integrations_status
  ON public.integrations (status);

-- ─── RPC: claim_google_refresh_lock ──────────────────────────────────────────
--
-- Attempts to claim a 30-second refresh mutex for the given integration.
-- Returns the nonce UUID on success (caller holds the lock).
-- Returns NULL if the lock is already held by another worker.
--
-- GRANT service_role only — never callable from user sessions.

CREATE OR REPLACE FUNCTION public.claim_google_refresh_lock(
  p_integration_id uuid
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.integrations
  SET
    refresh_lock_until = now() + interval '30 seconds',
    refresh_lock_nonce = gen_random_uuid(),
    updated_at         = now()
  WHERE id = p_integration_id
    AND (refresh_lock_until IS NULL OR refresh_lock_until < now())
  RETURNING refresh_lock_nonce;
$$;

REVOKE ALL  ON FUNCTION public.claim_google_refresh_lock(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_google_refresh_lock(uuid) TO service_role;

-- ─── RPC: confirm_google_refresh ──────────────────────────────────────────────
--
-- Validates the nonce, releases the lock, marks the integration 'connected',
-- and atomically upserts the new tokens into integrations_secrets.
--
-- COALESCE on refresh_token_enc: if p_refresh_token_enc IS NULL, the existing
-- refresh token is preserved (Google only issues a new one when prompt=consent).
--
-- Raises an exception if the nonce doesn't match or the lock has expired.
-- GRANT service_role only.

CREATE OR REPLACE FUNCTION public.confirm_google_refresh(
  p_integration_id    uuid,
  p_nonce             uuid,
  p_access_token_enc  text,
  p_refresh_token_enc text,    -- NULL → preserve existing refresh token
  p_key_version       int,
  p_token_expires_at  timestamptz DEFAULT NULL  -- NULL → don't update
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Release lock + update status + optional expires_at (atomic)
  UPDATE public.integrations
  SET
    refresh_lock_until  = NULL,
    refresh_lock_nonce  = NULL,
    status              = 'connected',
    last_refresh_at     = now(),
    last_error_code     = NULL,
    last_error_at       = NULL,
    token_expires_at    = COALESCE(p_token_expires_at, token_expires_at),
    updated_at          = now()
  WHERE id                 = p_integration_id
    AND refresh_lock_nonce = p_nonce
    AND refresh_lock_until > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'confirm_google_refresh: nonce mismatch or lock expired for integration %',
      p_integration_id;
  END IF;

  -- Upsert secrets: COALESCE refresh token so existing token survives
  -- a rotation response that omits it (standard Google behaviour).
  INSERT INTO public.integrations_secrets
    (integration_id, access_token_enc, refresh_token_enc, key_version, updated_at)
  VALUES
    (p_integration_id, p_access_token_enc, p_refresh_token_enc, p_key_version, now())
  ON CONFLICT (integration_id) DO UPDATE
  SET
    access_token_enc  = EXCLUDED.access_token_enc,
    refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc,
                                 integrations_secrets.refresh_token_enc),
    key_version       = EXCLUDED.key_version,
    updated_at        = now();
END;
$$;

REVOKE ALL  ON FUNCTION public.confirm_google_refresh(uuid, uuid, text, text, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_google_refresh(uuid, uuid, text, text, int, timestamptz) TO service_role;

-- ─── RPC: fail_google_refresh ────────────────────────────────────────────────
--
-- Releases the refresh lock and records the error.
-- If p_error_code = 'invalid_grant' → sets status = 'needs_reauth'
--   (user must re-authorize via /api/integrations/google/connect).
-- GRANT service_role only.

CREATE OR REPLACE FUNCTION public.fail_google_refresh(
  p_integration_id uuid,
  p_nonce          uuid,
  p_error_code     text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.integrations
  SET
    refresh_lock_until = NULL,
    refresh_lock_nonce = NULL,
    last_error_code    = p_error_code,
    last_error_at      = now(),
    -- invalid_grant means the refresh token is revoked → user must re-auth
    status             = CASE
                           WHEN p_error_code = 'invalid_grant' THEN 'needs_reauth'
                           ELSE status
                         END,
    updated_at         = now()
  WHERE id                 = p_integration_id
    AND refresh_lock_nonce = p_nonce;
$$;

REVOKE ALL  ON FUNCTION public.fail_google_refresh(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_google_refresh(uuid, uuid, text) TO service_role;
