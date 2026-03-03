begin;

-- 1) Align integrations with runtime-consumed fields (additive-only)
alter table public.integrations
  add column if not exists is_active boolean not null default true,
  add column if not exists account_id text,
  add column if not exists access_token text,
  add column if not exists refresh_token text,
  add column if not exists scopes text[];

-- 2) Align replies with editorial/publish workflow fields
alter table public.replies
  add column if not exists tone text,
  add column if not exists status text not null default 'draft',
  add column if not exists is_edited boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id);

-- Normalize empty/null status values without assuming a specific underlying type
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'replies'
      and column_name = 'status'
  ) then
    execute $sql$
      update public.replies
      set status = 'draft'
      where status is null
         or status::text = ''
    $sql$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'replies_status_check'
      and conrelid = 'public.replies'::regclass
  ) then
    alter table public.replies
      add constraint replies_status_check
      check (status in ('draft','selected','published','archived'));
  end if;
end $$;

create index if not exists idx_replies_review_status
  on public.replies (review_id, status);

-- 3) Align publish_jobs with worker/runtime fields
alter table public.publish_jobs
  add column if not exists integration_id uuid references public.integrations(id) on delete set null,
  add column if not exists finished_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_detail text,
  add column if not exists result_gbp_reply_id text,
  add column if not exists processing_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'publish_jobs_last_error_detail_len_check'
      and conrelid = 'public.publish_jobs'::regclass
  ) then
    alter table public.publish_jobs
      add constraint publish_jobs_last_error_detail_len_check
      check (last_error_detail is null or char_length(last_error_detail) <= 300);
  end if;
end $$;

-- 4) Backfill best-effort integration_id per biz/provider
update public.publish_jobs pj
set integration_id = (
  select i.id
  from public.integrations i
  where i.biz_id = pj.biz_id
    and i.provider = 'google_business'
  order by i.updated_at desc nulls last, i.created_at desc nulls last, i.id desc
  limit 1
)
where pj.integration_id is null;

-- 5) Operational/recovery indexes
create index if not exists idx_publish_jobs_biz_status_next_attempt
  on public.publish_jobs (biz_id, status, next_attempt_at);

create index if not exists idx_publish_jobs_running_locked
  on public.publish_jobs (locked_until)
  where status = 'running';

create unique index if not exists uq_publish_jobs_active_reply
  on public.publish_jobs (reply_id)
  where status in ('queued','running','queued_retry');

notify pgrst, 'reload schema';

commit;
