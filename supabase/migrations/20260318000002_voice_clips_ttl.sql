-- ============================================================
-- Voice clips: add TTL columns (GDPR art. 5.1.e — data minimisation)
--
-- expires_at: hard TTL, defaults to 90 days after row creation.
--   The purge endpoint (POST /api/_internal/voice/purge) uses this
--   column to soft-delete clips whose retention period has elapsed.
--
-- deleted_at: soft-delete flag.  The purge job sets this to now()
--   so that it appears in audit logs before a hard-delete sweep.
--
-- SAFE / IDEMPOTENT: ADD COLUMN IF NOT EXISTS — safe to re-run.
-- ============================================================

ALTER TABLE public.lito_voice_clips
  ADD COLUMN IF NOT EXISTS expires_at  timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days'),
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

-- Index used by the nightly purge endpoint.
-- Partial index: only rows not yet soft-deleted, keeps it small.
CREATE INDEX IF NOT EXISTS idx_lito_voice_clips_expires_at
  ON public.lito_voice_clips (expires_at)
  WHERE deleted_at IS NULL;

-- ── Verification ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'lito_voice_clips'
      AND column_name  = 'expires_at'
  ) THEN
    RAISE EXCEPTION
      'Migration check failed: expires_at column missing from lito_voice_clips';
  END IF;

  RAISE NOTICE 'lito_voice_clips: TTL columns migration OK';
END
$$;
