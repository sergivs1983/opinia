-- supabase/migrations/20260301000000_flow_b_oauth_states.sql
--
-- Flow B — Google OAuth PKCE: oauth_states table + consume RPC.
--
-- oauth_states holds one-time state tokens for the OAuth2 PKCE flow.
-- Each row expires after 15 minutes and can only be consumed once.
--
-- Idempotent: safe to re-run.

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.oauth_states (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  biz_id         uuid        NOT NULL REFERENCES public.businesses(id)  ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  code_verifier  text        NOT NULL,
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.oauth_states IS 'Single-use PKCE state tokens for Google OAuth2 flow (15 min TTL).';
COMMENT ON COLUMN public.oauth_states.code_verifier IS 'PKCE code_verifier — stored server-side, never sent to client.';
COMMENT ON COLUMN public.oauth_states.used_at IS 'Set on first successful consume; row becomes invalid for reuse.';

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id
  ON public.oauth_states (user_id);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
  ON public.oauth_states (expires_at)
  WHERE used_at IS NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

-- Authenticated users: INSERT their own states (user_id must match session)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_states' AND policyname = 'users_insert_own_oauth_states'
  ) THEN
    CREATE POLICY "users_insert_own_oauth_states"
      ON public.oauth_states FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Authenticated users: SELECT their own states (read-only, for debugging)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_states' AND policyname = 'users_select_own_oauth_states'
  ) THEN
    CREATE POLICY "users_select_own_oauth_states"
      ON public.oauth_states FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

-- service_role: full access (for cleanup cron + smoke tests)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'oauth_states' AND policyname = 'service_role_full_oauth_states'
  ) THEN
    CREATE POLICY "service_role_full_oauth_states"
      ON public.oauth_states FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ─── RPC: consume_oauth_state ─────────────────────────────────────────────────
--
-- Atomically validates and consumes a one-time state token.
-- Ownership: verified via auth.uid() — caller must be the user who created it.
-- Returns (biz_id, code_verifier) on success; empty on any failure.
--
-- Failure cases (all return empty, not an error):
--   - State not found
--   - user_id != auth.uid()
--   - used_at IS NOT NULL (already consumed)
--   - expires_at <= now() (expired)

CREATE OR REPLACE FUNCTION public.consume_oauth_state(p_state uuid)
RETURNS TABLE (biz_id uuid, code_verifier text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz_id        uuid;
  v_code_verifier text;
BEGIN
  -- Lock the row for update, validate all conditions atomically
  SELECT s.biz_id, s.code_verifier
    INTO v_biz_id, v_code_verifier
  FROM public.oauth_states s
  WHERE s.id        = p_state
    AND s.user_id   = auth.uid()   -- ownership: only the creating user can consume
    AND s.used_at   IS NULL        -- single-use
    AND s.expires_at > now()       -- not expired
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Return empty set — do NOT raise an exception (avoid leaking info)
    RETURN;
  END IF;

  -- Mark consumed
  UPDATE public.oauth_states SET used_at = now() WHERE id = p_state;

  RETURN QUERY SELECT v_biz_id, v_code_verifier;
END;
$$;

-- Grant: authenticated users only (auth.uid() used internally)
REVOKE ALL  ON FUNCTION public.consume_oauth_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_oauth_state(uuid) TO authenticated;
