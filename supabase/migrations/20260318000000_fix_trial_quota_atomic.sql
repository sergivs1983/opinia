-- ============================================================
-- Trial Quota: atomic consume via DB function (NO-GO-3 fix)
--
-- Replaces the non-atomic read+check in enforceTrialQuota (trial.ts)
-- with a single DB-level UPSERT that guarantees no TOCTOU race.
--
-- SAFE / IDEMPOTENT:
--   CREATE OR REPLACE FUNCTION … can be re-run without side effects.
-- ============================================================

-- ------------------------------------------------------------
-- 1) consume_trial_quota — atomic UPSERT + cap guard
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_trial_quota(
  p_org_id     uuid,
  p_month_start date,
  p_limit       integer,
  p_increment   integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used    integer;
  v_updated integer;
BEGIN
  -- Validate inputs
  IF p_limit    IS NULL OR p_limit    < 0 THEN RAISE EXCEPTION 'p_limit must be >= 0';    END IF;
  IF p_increment IS NULL OR p_increment < 1 THEN RAISE EXCEPTION 'p_increment must be >= 1'; END IF;
  IF p_org_id   IS NULL THEN RAISE EXCEPTION 'p_org_id is required'; END IF;

  -- Ensure the row exists for this org + month before the UPDATE
  INSERT INTO public.ai_quotas_monthly (org_id, month_start, drafts_used, drafts_limit)
  VALUES (p_org_id, p_month_start, 0, p_limit)
  ON CONFLICT (org_id, month_start) DO NOTHING;

  -- Atomic increment — only succeeds when we are below the cap
  UPDATE public.ai_quotas_monthly
  SET
    drafts_used  = drafts_used + p_increment,
    drafts_limit = GREATEST(drafts_limit, p_limit),
    updated_at   = now()
  WHERE org_id     = p_org_id
    AND month_start = p_month_start
    AND drafts_used + p_increment <= p_limit   -- cap guard
  RETURNING drafts_used INTO v_used;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- Cap was hit — read the current usage for telemetry
    SELECT drafts_used INTO v_used
    FROM public.ai_quotas_monthly
    WHERE org_id = p_org_id AND month_start = p_month_start;

    RETURN jsonb_build_object(
      'ok',        false,
      'reason',    'trial_cap_reached',
      'used',      COALESCE(v_used, 0),
      'limit',     p_limit,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',        true,
    'reason',    null,
    'used',      v_used,
    'limit',     p_limit,
    'remaining', GREATEST(p_limit - v_used, 0)
  );
END;
$$;

-- Revoke from public, grant to roles that need it
REVOKE ALL ON FUNCTION public.consume_trial_quota(uuid, date, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_trial_quota(uuid, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_trial_quota(uuid, date, integer, integer) TO service_role;

-- ------------------------------------------------------------
-- 2) Safety: ensure updated_at column exists on ai_quotas_monthly
--    (added idempotently — NOOP if already present)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'ai_quotas_monthly'
      AND column_name  = 'updated_at'
  ) THEN
    ALTER TABLE public.ai_quotas_monthly
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END
$$;
