begin;

alter table public.lito_voice_clips
  add column if not exists idempotency_key text null;

create unique index if not exists ux_lito_voice_clips_org_idempotency
  on public.lito_voice_clips (org_id, idempotency_key)
  where idempotency_key is not null;

alter table public.lito_action_drafts
  add column if not exists idempotency_key text null;

create unique index if not exists ux_lito_action_drafts_org_idempotency_kind
  on public.lito_action_drafts (org_id, idempotency_key, kind)
  where idempotency_key is not null;

notify pgrst, 'reload schema';

commit;
