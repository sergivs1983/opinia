begin;

create table if not exists public.biz_settings (
  biz_id uuid primary key references public.businesses(id) on delete cascade,
  signature text,
  ai_instructions text,
  keywords_use text[] not null default '{}'::text[],
  keywords_avoid text[] not null default '{}'::text[],
  ai_engine text not null default 'opinia_ai',
  seo_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'biz_settings_ai_instructions_len_check'
      and conrelid = 'public.biz_settings'::regclass
  ) then
    alter table public.biz_settings
      add constraint biz_settings_ai_instructions_len_check
      check (ai_instructions is null or char_length(ai_instructions) <= 500);
  end if;
end $$;

alter table public.biz_settings enable row level security;

drop policy if exists "biz_settings_select_authenticated_scope" on public.biz_settings;
create policy "biz_settings_select_authenticated_scope"
  on public.biz_settings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = biz_settings.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role::text in (
          'owner',
          'manager',
          'staff',
          'admin',
          'responder'
        )
    )
  );

drop policy if exists "biz_settings_insert_owner_manager" on public.biz_settings;
create policy "biz_settings_insert_owner_manager"
  on public.biz_settings
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = biz_settings.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in (
          'owner'::public.member_role,
          'manager'::public.member_role
        )
    )
  );

drop policy if exists "biz_settings_update_owner_manager" on public.biz_settings;
create policy "biz_settings_update_owner_manager"
  on public.biz_settings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = biz_settings.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in (
          'owner'::public.member_role,
          'manager'::public.member_role
        )
    )
  )
  with check (
    exists (
      select 1
      from public.businesses b
      join public.memberships m
        on m.org_id = b.org_id
      where b.id = biz_settings.biz_id
        and m.user_id = auth.uid()
        and m.accepted_at is not null
        and m.role in (
          'owner'::public.member_role,
          'manager'::public.member_role
        )
    )
  );

drop policy if exists "biz_settings_service_role_all" on public.biz_settings;
create policy "biz_settings_service_role_all"
  on public.biz_settings
  for all
  to service_role
  using (true)
  with check (true);

commit;

notify pgrst, 'reload schema';
