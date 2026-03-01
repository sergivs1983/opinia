begin;

create table if not exists public.social_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  draft_id uuid not null references public.social_drafts(id) on delete cascade,
  assigned_user_id uuid not null references auth.users(id) on delete restrict,
  platform text not null,
  scheduled_at timestamptz not null,
  status text not null,
  notified_at timestamptz null,
  published_at timestamptz null,
  snoozed_from timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_schedules_platform_check'
      and conrelid = 'public.social_schedules'::regclass
  ) then
    alter table public.social_schedules
      add constraint social_schedules_platform_check
      check (platform in ('instagram', 'tiktok'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_schedules_status_check'
      and conrelid = 'public.social_schedules'::regclass
  ) then
    alter table public.social_schedules
      add constraint social_schedules_status_check
      check (status in ('scheduled', 'notified', 'published', 'missed', 'snoozed', 'canceled'));
  end if;
end $$;

create index if not exists idx_social_schedules_biz_scheduled_desc
  on public.social_schedules (biz_id, scheduled_at desc);

create index if not exists idx_social_schedules_org_status_scheduled_asc
  on public.social_schedules (org_id, status, scheduled_at asc);

create unique index if not exists ux_social_schedules_draft_active
  on public.social_schedules (draft_id)
  where status in ('scheduled', 'notified', 'snoozed');

create table if not exists public.social_reminders_queue (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.social_schedules(id) on delete cascade,
  trigger_at timestamptz not null,
  kind text not null,
  status text not null,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_reminders_queue_kind_check'
      and conrelid = 'public.social_reminders_queue'::regclass
  ) then
    alter table public.social_reminders_queue
      add constraint social_reminders_queue_kind_check
      check (kind in ('t_minus_24h', 't_minus_1h', 't_plus_15m'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_reminders_queue_status_check'
      and conrelid = 'public.social_reminders_queue'::regclass
  ) then
    alter table public.social_reminders_queue
      add constraint social_reminders_queue_status_check
      check (status in ('pending', 'sent', 'canceled'));
  end if;
end $$;

create index if not exists idx_social_reminders_queue_status_trigger
  on public.social_reminders_queue (status, trigger_at asc);

create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_in_app_notifications_user_created
  on public.in_app_notifications (user_id, created_at desc);

alter table public.social_schedules enable row level security;
alter table public.social_reminders_queue enable row level security;
alter table public.in_app_notifications enable row level security;

-- social_schedules: staff can view only assigned rows, owner/manager can view org rows.
drop policy if exists "social_schedules_select_authenticated" on public.social_schedules;
create policy "social_schedules_select_authenticated"
  on public.social_schedules
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and (
      social_schedules.assigned_user_id = auth.uid()
      or exists (
        select 1
        from public.memberships m
        where m.org_id = social_schedules.org_id
          and m.user_id = auth.uid()
          and m.accepted_at is not null
          and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
      )
    )
  );

-- owner/manager can create schedules.
drop policy if exists "social_schedules_insert_owner_manager" on public.social_schedules;
create policy "social_schedules_insert_owner_manager"
  on public.social_schedules
  for insert
  to authenticated
  with check (
    status = 'scheduled'
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_schedules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
    and exists (
      select 1
      from public.business_memberships bm_assigned
      join public.memberships m_assigned
        on m_assigned.org_id = social_schedules.org_id
       and m_assigned.user_id = bm_assigned.user_id
       and m_assigned.accepted_at is not null
      where bm_assigned.org_id = social_schedules.org_id
        and bm_assigned.business_id = social_schedules.biz_id
        and bm_assigned.user_id = social_schedules.assigned_user_id
        and bm_assigned.is_active = true
        and m_assigned.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

-- owner/manager can update schedules.
drop policy if exists "social_schedules_update_owner_manager" on public.social_schedules;
create policy "social_schedules_update_owner_manager"
  on public.social_schedules
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_schedules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  )
  with check (
    status in ('scheduled', 'notified', 'published', 'missed', 'snoozed', 'canceled')
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_schedules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role)
    )
  );

-- staff can only publish/snooze their own assigned schedules.
drop policy if exists "social_schedules_update_staff_assigned" on public.social_schedules;
create policy "social_schedules_update_staff_assigned"
  on public.social_schedules
  for update
  to authenticated
  using (
    social_schedules.assigned_user_id = auth.uid()
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_schedules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
    and social_schedules.status in ('scheduled', 'notified', 'snoozed')
  )
  with check (
    social_schedules.assigned_user_id = auth.uid()
    and social_schedules.status in ('published', 'snoozed')
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = social_schedules.biz_id
        and bm.org_id = social_schedules.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = social_schedules.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role = 'staff'::public.member_role
    )
  );

drop policy if exists "social_schedules_delete_authenticated" on public.social_schedules;
create policy "social_schedules_delete_authenticated"
  on public.social_schedules
  for delete
  to authenticated
  using (false);

drop policy if exists "social_schedules_service_role_all" on public.social_schedules;
create policy "social_schedules_service_role_all"
  on public.social_schedules
  for all
  to service_role
  using (true)
  with check (true);

-- social_reminders_queue: authenticated denied, service role full.
drop policy if exists "social_reminders_queue_authenticated_deny" on public.social_reminders_queue;
create policy "social_reminders_queue_authenticated_deny"
  on public.social_reminders_queue
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "social_reminders_queue_service_role_all" on public.social_reminders_queue;
create policy "social_reminders_queue_service_role_all"
  on public.social_reminders_queue
  for all
  to service_role
  using (true)
  with check (true);

-- in_app_notifications: users can only read own notifications.
drop policy if exists "in_app_notifications_select_own" on public.in_app_notifications;
create policy "in_app_notifications_select_own"
  on public.in_app_notifications
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "in_app_notifications_authenticated_deny_writes" on public.in_app_notifications;
create policy "in_app_notifications_authenticated_deny_writes"
  on public.in_app_notifications
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "in_app_notifications_service_role_all" on public.in_app_notifications;
create policy "in_app_notifications_service_role_all"
  on public.in_app_notifications
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
