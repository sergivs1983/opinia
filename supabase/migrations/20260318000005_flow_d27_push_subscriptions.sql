begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create unique index if not exists ux_push_subscriptions_user_biz_endpoint
  on public.push_subscriptions (user_id, biz_id, endpoint);

create index if not exists idx_push_subscriptions_biz_active
  on public.push_subscriptions (biz_id, revoked_at, created_at desc);

create index if not exists idx_push_subscriptions_user_active
  on public.push_subscriptions (user_id, revoked_at, created_at desc);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions
  for select
  to authenticated
  using (
    push_subscriptions.user_id = auth.uid()
    and exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = push_subscriptions.biz_id
        and bm.org_id = push_subscriptions.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    and exists (
      select 1
      from public.memberships m
      where m.org_id = push_subscriptions.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in (
          'owner'::public.member_role,
          'manager'::public.member_role,
          'staff'::public.member_role
        )
    )
  );

drop policy if exists "push_subscriptions_authenticated_deny_writes" on public.push_subscriptions;
create policy "push_subscriptions_authenticated_deny_writes"
  on public.push_subscriptions
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "push_subscriptions_service_role_all" on public.push_subscriptions;
create policy "push_subscriptions_service_role_all"
  on public.push_subscriptions
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
