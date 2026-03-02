begin;

create or replace function public.enqueue_rebuild_cards(p_biz_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_allowed boolean;
begin
  if p_biz_id is null then
    return;
  end if;

  v_uid := auth.uid();

  -- User-scoped calls must prove membership on the target business.
  -- Internal contexts (trigger/service_role) run without auth.uid() and are allowed.
  if v_uid is not null then
    select exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = p_biz_id
        and bm.user_id = v_uid
        and bm.is_active = true
    ) into v_allowed;

    if not coalesce(v_allowed, false) then
      raise exception 'forbidden'
        using errcode = '42501';
    end if;
  end if;

  insert into public.lito_cards_cache (biz_id, stale, updated_at)
  values (p_biz_id, true, now())
  on conflict (biz_id)
  do update
  set stale = true,
      updated_at = now();

  insert into public.lito_jobs (biz_id, job_type, status, run_at, updated_at)
  values (p_biz_id, 'rebuild_cards', 'queued', now(), now())
  on conflict (biz_id, job_type) where status in ('queued', 'running')
  do nothing;
end;
$$;

revoke all on function public.enqueue_rebuild_cards(uuid) from public;
revoke all on function public.enqueue_rebuild_cards(uuid) from anon;
grant execute on function public.enqueue_rebuild_cards(uuid) to authenticated;
grant execute on function public.enqueue_rebuild_cards(uuid) to service_role;

create or replace function public.lito_enqueue_rebuild_cards_from_drafts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_id uuid;
  v_schedule_id uuid;
  v_schedule_id_text text;
begin
  -- Preferred path: drafts should carry biz_id directly.
  if new.biz_id is not null then
    perform public.enqueue_rebuild_cards(new.biz_id);
    return new;
  end if;

  -- Fallback path for legacy rows that might only reference schedule_id.
  v_schedule_id_text := nullif(trim(coalesce(to_jsonb(new)->>'schedule_id', '')), '');
  if v_schedule_id_text is null then
    return new;
  end if;

  begin
    v_schedule_id := v_schedule_id_text::uuid;
  exception
    when others then
      return new;
  end;

  select s.biz_id
  into v_biz_id
  from public.social_schedules s
  where s.id = v_schedule_id
  limit 1;

  if v_biz_id is not null then
    perform public.enqueue_rebuild_cards(v_biz_id);
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.social_drafts') is not null then
    drop trigger if exists trg_lito_enqueue_rebuild_cards_social_drafts on public.social_drafts;
    create trigger trg_lito_enqueue_rebuild_cards_social_drafts
      after insert or update of status
      on public.social_drafts
      for each row
      execute function public.lito_enqueue_rebuild_cards_from_drafts();
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
