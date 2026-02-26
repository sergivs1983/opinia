-- Tune publish_jobs lock duration and stuck requeue semantics

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
    locked_until = now() + interval '10 minutes',
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
      next_attempt_at = now() + interval '30 seconds',
      updated_at      = now()
    WHERE status = 'running'
      AND locked_until < now()
    RETURNING id
  )
  SELECT count(*)::integer FROM updated;
$$;
