begin;

create table if not exists public.stripe_webhook_events (
  id text primary key,
  event_type text not null,
  payload jsonb null,
  processed_at timestamptz not null default now()
);

create index if not exists stripe_webhook_events_processed_at_idx
  on public.stripe_webhook_events (processed_at desc);

alter table public.stripe_webhook_events enable row level security;

drop policy if exists stripe_webhook_events_select_deny on public.stripe_webhook_events;
create policy stripe_webhook_events_select_deny
  on public.stripe_webhook_events
  for select
  to authenticated
  using (false);

drop policy if exists stripe_webhook_events_insert_deny on public.stripe_webhook_events;
create policy stripe_webhook_events_insert_deny
  on public.stripe_webhook_events
  for insert
  to authenticated
  with check (false);

drop policy if exists stripe_webhook_events_update_deny on public.stripe_webhook_events;
create policy stripe_webhook_events_update_deny
  on public.stripe_webhook_events
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists stripe_webhook_events_delete_deny on public.stripe_webhook_events;
create policy stripe_webhook_events_delete_deny
  on public.stripe_webhook_events
  for delete
  to authenticated
  using (false);

drop policy if exists stripe_webhook_events_service_role_all on public.stripe_webhook_events;
create policy stripe_webhook_events_service_role_all
  on public.stripe_webhook_events
  for all
  to service_role
  using (true)
  with check (true);

notify pgrst, 'reload schema';

commit;
