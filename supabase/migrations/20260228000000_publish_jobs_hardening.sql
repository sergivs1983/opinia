-- supabase/migrations/20260228000000_publish_jobs_hardening.sql
--
-- Pro Hardening for publish_jobs:
--
-- 1. Idempotency key scope: per-tenant (biz_id, idempotency_key) instead of global.
--    Reason: keys like "draft:UUID:timestamp" could theoretically collide across
--    tenants in the global unique index. Scoping to biz_id is semantically correct
--    and avoids false-positive idempotency hits across tenants.
--
-- 2. pop_publish_jobs: add locked_until guard to prevent reclaiming a job that
--    another worker instance is still holding (belt-and-suspenders on top of SKIP LOCKED).
--
-- 3. requeue_stuck_publish_jobs: set next_attempt_at = now() + 30s on requeue
--    to prevent an immediate re-claim loop if the stuck detection runs very frequently.
--
-- 4. State machine trigger: already allows queued_retry → running (no change needed).

-- ─── 1. Idempotency constraint: global → per-tenant ───────────────────────────

-- Drop the global unique constraint added in 20260227000000_publish_jobs.sql
ALTER TABLE public.publish_jobs
  DROP CONSTRAINT IF EXISTS publish_jobs_idempotency_key_key;

-- Add per-tenant unique constraint
ALTER TABLE public.publish_jobs
  ADD CONSTRAINT publish_jobs_biz_idempotency_key UNIQUE (biz_id, idempotency_key);

-- ─── 2. Fix pop_publish_jobs: honour locked_until ─────────────────────────────

CREATE OR REPLACE FUNCTION pop_publish_jobs(p_limit integer DEFAULT 5)
RETURNS SETOF public.publish_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.publish_jobs
  SET
    status       = 'running',
    attempts     = attempts + 1,
    locked_until = now() + interval '5 minutes',
    updated_at   = now()
  WHERE id IN (
    SELECT id
    FROM   public.publish_jobs
    WHERE  status IN ('queued', 'queued_retry')
      AND  next_attempt_at <= now()
      AND  (locked_until IS NULL OR locked_until < now())
    ORDER  BY next_attempt_at
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ─── 3. Fix requeue_stuck_publish_jobs: always schedule in the future ─────────

CREATE OR REPLACE FUNCTION requeue_stuck_publish_jobs()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.publish_jobs
    SET
      status          = 'queued_retry',
      locked_until    = NULL,
      -- Schedule 30 s in the future so the worker doesn't re-claim immediately
      next_attempt_at = now() + interval '30 seconds',
      updated_at      = now()
    WHERE status       = 'running'
      AND locked_until < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*)::integer FROM updated;
$$;
