begin;

create table if not exists public.biz_memory_profile (
  biz_id uuid primary key references public.businesses(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  profile_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_biz_memory_profile_org
  on public.biz_memory_profile (org_id, updated_at desc);

create table if not exists public.biz_memory_voice (
  biz_id uuid primary key references public.businesses(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  voice_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_biz_memory_voice_org
  on public.biz_memory_voice (org_id, updated_at desc);

create table if not exists public.biz_memory_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  rules_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  priority integer not null default 100,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'biz_memory_policies_priority_check'
      and conrelid = 'public.biz_memory_policies'::regclass
  ) then
    alter table public.biz_memory_policies
      add constraint biz_memory_policies_priority_check
      check (priority >= 0);
  end if;
end $$;

create index if not exists idx_biz_memory_policies_biz_priority
  on public.biz_memory_policies (biz_id, enabled desc, priority asc, updated_at desc);

create table if not exists public.biz_memory_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  type text not null,
  source text not null,
  summary text not null,
  evidence_ref jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  confidence numeric(4,3) null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'biz_memory_events_confidence_check'
      and conrelid = 'public.biz_memory_events'::regclass
  ) then
    alter table public.biz_memory_events
      add constraint biz_memory_events_confidence_check
      check (confidence is null or (confidence >= 0 and confidence <= 1));
  end if;
end $$;

create index if not exists idx_biz_memory_events_biz_occurred
  on public.biz_memory_events (biz_id, occurred_at desc);

create index if not exists idx_biz_memory_events_org_created
  on public.biz_memory_events (org_id, created_at desc);

alter table public.biz_memory_profile enable row level security;
alter table public.biz_memory_voice enable row level security;
alter table public.biz_memory_policies enable row level security;
alter table public.biz_memory_events enable row level security;

drop policy if exists "biz_memory_profile_select_member_scope" on public.biz_memory_profile;
create policy "biz_memory_profile_select_member_scope"
  on public.biz_memory_profile
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_profile.biz_id
        and bm.org_id = biz_memory_profile.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_profile.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_profile_insert_member_scope" on public.biz_memory_profile;
create policy "biz_memory_profile_insert_member_scope"
  on public.biz_memory_profile
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_profile.biz_id
        and bm.org_id = biz_memory_profile.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_profile.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_profile_update_member_scope" on public.biz_memory_profile;
create policy "biz_memory_profile_update_member_scope"
  on public.biz_memory_profile
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_profile.biz_id
        and bm.org_id = biz_memory_profile.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_profile.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_profile.biz_id
        and bm.org_id = biz_memory_profile.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_profile.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_profile_service_role_all" on public.biz_memory_profile;
create policy "biz_memory_profile_service_role_all"
  on public.biz_memory_profile
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "biz_memory_voice_select_member_scope" on public.biz_memory_voice;
create policy "biz_memory_voice_select_member_scope"
  on public.biz_memory_voice
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_voice.biz_id
        and bm.org_id = biz_memory_voice.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_voice.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_voice_insert_member_scope" on public.biz_memory_voice;
create policy "biz_memory_voice_insert_member_scope"
  on public.biz_memory_voice
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_voice.biz_id
        and bm.org_id = biz_memory_voice.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_voice.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_voice_update_member_scope" on public.biz_memory_voice;
create policy "biz_memory_voice_update_member_scope"
  on public.biz_memory_voice
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_voice.biz_id
        and bm.org_id = biz_memory_voice.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_voice.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_voice.biz_id
        and bm.org_id = biz_memory_voice.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_voice.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_voice_service_role_all" on public.biz_memory_voice;
create policy "biz_memory_voice_service_role_all"
  on public.biz_memory_voice
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "biz_memory_policies_select_member_scope" on public.biz_memory_policies;
create policy "biz_memory_policies_select_member_scope"
  on public.biz_memory_policies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_policies.biz_id
        and bm.org_id = biz_memory_policies.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_policies.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_policies_insert_member_scope" on public.biz_memory_policies;
create policy "biz_memory_policies_insert_member_scope"
  on public.biz_memory_policies
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_policies.biz_id
        and bm.org_id = biz_memory_policies.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_policies.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_policies_update_member_scope" on public.biz_memory_policies;
create policy "biz_memory_policies_update_member_scope"
  on public.biz_memory_policies
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_policies.biz_id
        and bm.org_id = biz_memory_policies.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_policies.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  )
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_policies.biz_id
        and bm.org_id = biz_memory_policies.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_policies.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_policies_service_role_all" on public.biz_memory_policies;
create policy "biz_memory_policies_service_role_all"
  on public.biz_memory_policies
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "biz_memory_events_select_member_scope" on public.biz_memory_events;
create policy "biz_memory_events_select_member_scope"
  on public.biz_memory_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_events.biz_id
        and bm.org_id = biz_memory_events.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_events.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_events_insert_member_scope" on public.biz_memory_events;
create policy "biz_memory_events_insert_member_scope"
  on public.biz_memory_events
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_memory_events.biz_id
        and bm.org_id = biz_memory_events.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_memory_events.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_memory_events_service_role_all" on public.biz_memory_events;
create policy "biz_memory_events_service_role_all"
  on public.biz_memory_events
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
