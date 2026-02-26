-- supabase/migrations/20260227000000_publish_jobs.sql
--
-- Async publish pipeline: publish_jobs table with state machine.
--
-- publish_job_status: queued → running → success
--                                      → failed
--                                      → queued_retry → running → …
--
-- Two RPCs:
--   pop_publish_jobs(p_limit)   — atomic claim, FOR UPDATE SKIP LOCKED
--   requeue_stuck_publish_jobs()— heartbeat recovery for locked > 5 min

-- ─── Enum ─────────────────────────────────────────────────────────────────────

CREATE TYPE public.publish_job_status AS ENUM (
  'queued',
  'running',
  'success',
  'failed',
  'queued_retry'
);

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.publish_jobs (
  id               uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
  reply_id         uuid         NOT NULL REFERENCES public.replies(id)     ON DELETE CASCADE,
  biz_id           uuid         NOT NULL REFERENCES public.businesses(id)  ON DELETE CASCADE,
  org_id           uuid         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status           public.publish_job_status NOT NULL DEFAULT 'queued',
  attempts         integer      NOT NULL DEFAULT 0,
  max_attempts     integer      NOT NULL DEFAULT 5,
  next_attempt_at  timestamptz  NOT NULL DEFAULT now(),
  locked_until     timestamptz,
  error_message    text,
  idempotency_key  text         NOT NULL,
  published_at     timestamptz,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Partial index for the worker poll loop (only rows ready to be claimed)
CREATE INDEX idx_publish_jobs_poll
  ON public.publish_jobs (next_attempt_at)
  WHERE status IN ('queued', 'queued_retry');

-- Index for per-reply lookups (idempotency check in user API)
CREATE INDEX idx_publish_jobs_reply_id
  ON public.publish_jobs (reply_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.publish_jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT their own org's jobs (Pattern B 404 handled in app layer)
CREATE POLICY "users_select_own_biz_publish_jobs"
  ON public.publish_jobs FOR SELECT
  TO authenticated
  USING (biz_id = ANY(user_biz_ids()));

-- Only service_role (worker via createAdminClient) can INSERT/UPDATE/DELETE
CREATE POLICY "service_role_full_access_publish_jobs"
  ON public.publish_jobs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── State machine trigger ────────────────────────────────────────────────────
--
-- Allowed transitions:
--   INSERT:             status IN ('queued', 'queued_retry')
--   queued       → running
--   queued_retry → running
--   running      → success | failed | queued_retry
--   running      → running  (heartbeat / locked_until extension)

CREATE OR REPLACE FUNCTION publish_jobs_state_machine()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('queued', 'queued_retry') THEN
      RAISE EXCEPTION
        'publish_jobs: INSERT must use queued or queued_retry, got %', NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- queued → running
    IF OLD.status = 'queued'       AND NEW.status = 'running'       THEN RETURN NEW; END IF;
    -- queued_retry → running
    IF OLD.status = 'queued_retry' AND NEW.status = 'running'       THEN RETURN NEW; END IF;
    -- running → terminal or retry
    IF OLD.status = 'running'      AND NEW.status = 'success'       THEN RETURN NEW; END IF;
    IF OLD.status = 'running'      AND NEW.status = 'failed'        THEN RETURN NEW; END IF;
    IF OLD.status = 'running'      AND NEW.status = 'queued_retry'  THEN RETURN NEW; END IF;
    -- running → running (heartbeat / lock extension)
    IF OLD.status = 'running'      AND NEW.status = 'running'       THEN RETURN NEW; END IF;

    RAISE EXCEPTION
      'publish_jobs: invalid transition % → %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER publish_jobs_state_machine_tg
  BEFORE INSERT OR UPDATE ON public.publish_jobs
  FOR EACH ROW EXECUTE FUNCTION publish_jobs_state_machine();

-- ─── RPC: pop_publish_jobs ────────────────────────────────────────────────────
--
-- Atomically claims up to p_limit ready jobs and marks them running.
-- Uses FOR UPDATE SKIP LOCKED for safe concurrent workers.
-- Called by the internal worker endpoint using createAdminClient().

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
    ORDER  BY next_attempt_at
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

-- ─── RPC: requeue_stuck_publish_jobs ─────────────────────────────────────────
--
-- Recovers jobs that are still 'running' but whose locked_until has expired
-- (worker crashed or was killed). Returns the number of rows requeued.
-- Called by a periodic cron (or the worker itself at start).

CREATE OR REPLACE FUNCTION requeue_stuck_publish_jobs()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.publish_jobs
    SET
      status       = 'queued_retry',
      locked_until = NULL,
      updated_at   = now()
    WHERE status       = 'running'
      AND locked_until < now() - interval '5 minutes'
    RETURNING id
  )
  SELECT count(*)::integer FROM updated;
$$;
