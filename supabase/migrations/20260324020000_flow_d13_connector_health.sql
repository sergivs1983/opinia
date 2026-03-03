begin;

alter table public.integrations
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_error_detail text,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists needs_reauth boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'integrations_last_sync_status_check'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      add constraint integrations_last_sync_status_check
      check (last_sync_status is null or last_sync_status in ('ok', 'error', 'needs_reauth'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'integrations_last_error_detail_length_check'
      and conrelid = 'public.integrations'::regclass
  ) then
    alter table public.integrations
      add constraint integrations_last_error_detail_length_check
      check (last_error_detail is null or char_length(last_error_detail) <= 300);
  end if;
end $$;

create index if not exists idx_integrations_biz_provider_updated_desc
  on public.integrations (biz_id, provider, updated_at desc);

notify pgrst, 'reload schema';

commit;
