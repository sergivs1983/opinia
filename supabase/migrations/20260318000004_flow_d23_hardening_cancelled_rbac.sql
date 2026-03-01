begin;

update public.social_schedules
set status = 'cancelled'
where status = 'canceled';

update public.social_reminders_queue
set status = 'cancelled'
where status = 'canceled';

alter table public.social_schedules
  drop constraint if exists social_schedules_status_check;

alter table public.social_schedules
  add constraint social_schedules_status_check
  check (status in ('scheduled', 'notified', 'published', 'missed', 'snoozed', 'cancelled'));

alter table public.social_reminders_queue
  drop constraint if exists social_reminders_queue_status_check;

alter table public.social_reminders_queue
  add constraint social_reminders_queue_status_check
  check (status in ('pending', 'sent', 'cancelled'));

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
    status in ('scheduled', 'notified', 'published', 'missed', 'snoozed', 'cancelled')
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

drop policy if exists "social_schedules_update_staff_assigned" on public.social_schedules;
create policy "social_schedules_update_staff_assigned"
  on public.social_schedules
  for update
  to authenticated
  using (
    social_schedules.assigned_user_id = auth.uid()
    and social_schedules.status in ('scheduled', 'notified', 'snoozed')
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
  )
  with check (
    social_schedules.assigned_user_id = auth.uid()
    and social_schedules.status = 'published'
    and social_schedules.published_at is not null
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

notify pgrst, 'reload schema';

commit;
