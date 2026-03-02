begin;

create table if not exists public.lito_card_states (
  biz_id uuid not null references public.businesses(id) on delete cascade,
  card_id text not null,
  state text not null,
  snoozed_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (biz_id, card_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_card_states_state_check'
      and conrelid = 'public.lito_card_states'::regclass
  ) then
    alter table public.lito_card_states
      add constraint lito_card_states_state_check
      check (state in ('dismissed', 'snoozed', 'done'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lito_card_states_snooze_check'
      and conrelid = 'public.lito_card_states'::regclass
  ) then
    alter table public.lito_card_states
      add constraint lito_card_states_snooze_check
      check (
        (state = 'snoozed' and snoozed_until is not null)
        or (state <> 'snoozed')
      );
  end if;
end $$;

create index if not exists idx_lito_card_states_biz_state_snoozed
  on public.lito_card_states (biz_id, state, snoozed_until);

alter table public.lito_card_states enable row level security;

drop policy if exists "lito_card_states_select_authenticated_scope" on public.lito_card_states;
create policy "lito_card_states_select_authenticated_scope"
  on public.lito_card_states
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_card_states.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = lito_card_states.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_card_states_insert_authenticated_scope" on public.lito_card_states;
create policy "lito_card_states_insert_authenticated_scope"
  on public.lito_card_states
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_card_states.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = lito_card_states.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_card_states_update_authenticated_scope" on public.lito_card_states;
create policy "lito_card_states_update_authenticated_scope"
  on public.lito_card_states
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_card_states.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = lito_card_states.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = lito_card_states.biz_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = lito_card_states.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
    )
  );

drop policy if exists "lito_card_states_service_role_all" on public.lito_card_states;
create policy "lito_card_states_service_role_all"
  on public.lito_card_states
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
