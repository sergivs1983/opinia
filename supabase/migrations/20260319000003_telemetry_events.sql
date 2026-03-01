-- Minimal telemetry events (server-side only)
create table if not exists public.telemetry_events (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  org_id uuid null references public.organizations(id) on delete set null,
  user_id uuid null references auth.users(id) on delete set null,
  event_name text not null,
  props jsonb not null default '{}'::jsonb
);

create index if not exists telemetry_events_org_id_created_at_idx
  on public.telemetry_events (org_id, created_at desc);

create index if not exists telemetry_events_event_name_created_at_idx
  on public.telemetry_events (event_name, created_at desc);

alter table public.telemetry_events enable row level security;

drop policy if exists "deny all" on public.telemetry_events;
create policy "deny all" on public.telemetry_events
  for all
  using (false)
  with check (false);

create or replace function public.insert_telemetry_event(
  p_org_id uuid,
  p_user_id uuid,
  p_event_name text,
  p_props jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_name is null or btrim(p_event_name) = '' then
    return;
  end if;

  insert into public.telemetry_events(org_id, user_id, event_name, props)
  values (p_org_id, p_user_id, p_event_name, coalesce(p_props, '{}'::jsonb));
end;
$$;

revoke all on function public.insert_telemetry_event(uuid, uuid, text, jsonb) from public;
grant execute on function public.insert_telemetry_event(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.insert_telemetry_event(uuid, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
