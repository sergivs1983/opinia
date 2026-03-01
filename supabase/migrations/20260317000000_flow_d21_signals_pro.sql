begin;

create table if not exists public.biz_signals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  biz_id uuid not null references public.businesses(id) on delete cascade,
  provider public.integration_provider not null,
  code text not null,
  kind text not null check (kind in ('alert', 'opportunity')),
  severity text not null check (severity in ('low', 'med', 'high')),
  title text not null,
  reason text not null,
  data jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  signal_day date not null default (timezone('utc', now()))::date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_biz_signals_biz_code_day
  on public.biz_signals (biz_id, code, signal_day);

create index if not exists idx_biz_signals_biz_day
  on public.biz_signals (biz_id, signal_day desc);

create index if not exists idx_biz_signals_org_day
  on public.biz_signals (org_id, signal_day desc);

alter table public.biz_signals enable row level security;

drop policy if exists "biz_signals_select_member_scope" on public.biz_signals;
create policy "biz_signals_select_member_scope"
  on public.biz_signals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.business_memberships bm
      where bm.business_id = biz_signals.biz_id
        and bm.org_id = biz_signals.org_id
        and bm.user_id = auth.uid()
        and bm.is_active = true
    )
    or exists (
      select 1
      from public.memberships m
      where m.org_id = biz_signals.org_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in ('owner'::public.member_role, 'manager'::public.member_role, 'staff'::public.member_role)
    )
  );

drop policy if exists "biz_signals_write_deny_authenticated" on public.biz_signals;
create policy "biz_signals_write_deny_authenticated"
  on public.biz_signals
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists "biz_signals_service_role_all" on public.biz_signals;
create policy "biz_signals_service_role_all"
  on public.biz_signals
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
