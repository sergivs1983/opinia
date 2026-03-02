begin;

create or replace function public.cleanup_lito_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued integer := 0;
begin
  update public.lito_jobs lj
  set
    status = 'queued',
    run_at = now(),
    locked_at = null,
    updated_at = now()
  where lj.job_type = 'rebuild_cards'
    and lj.status = 'running'
    and coalesce(lj.locked_at, lj.updated_at) < now() - interval '10 minutes';

  get diagnostics v_requeued = row_count;
  return coalesce(v_requeued, 0);
end;
$$;

revoke all on function public.cleanup_lito_jobs() from public;
revoke all on function public.cleanup_lito_jobs() from anon;
revoke all on function public.cleanup_lito_jobs() from authenticated;
grant execute on function public.cleanup_lito_jobs() to service_role;

create or replace function public.lito_enqueue_rebuild_cards_from_schedules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status
      and old.scheduled_at is not distinct from new.scheduled_at
    then
      return new;
    end if;
  end if;

  v_biz_id := coalesce(new.biz_id, old.biz_id);
  perform public.enqueue_rebuild_cards(v_biz_id);
  return new;
end;
$$;

create or replace function public.lito_enqueue_rebuild_cards_from_signals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_id uuid;
  v_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(old)->>'status') is distinct from (to_jsonb(new)->>'status')
      or old.is_active is distinct from new.is_active
      or old.severity is distinct from new.severity
      or old.severity_score is distinct from new.severity_score
      or old.title is distinct from new.title
      or old.reason is distinct from new.reason
      or old.why is distinct from new.why
      or old.data is distinct from new.data
      or old.signal_day is distinct from new.signal_day
    then
      v_changed := true;
    end if;

    if not v_changed then
      return new;
    end if;
  end if;

  v_biz_id := coalesce(new.biz_id, old.biz_id);
  perform public.enqueue_rebuild_cards(v_biz_id);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.social_schedules') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_social_schedules on public.social_schedules;
    create trigger trg_lito_enqueue_rebuild_cards_social_schedules
      after insert or update of status, scheduled_at
      on public.social_schedules
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_schedules();
  end if;
end $$;

do $$
begin
  if to_regclass('public.biz_signals') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_biz_signals on public.biz_signals;
    create trigger trg_lito_enqueue_rebuild_cards_biz_signals
      after insert or update
      on public.biz_signals
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_signals();
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
