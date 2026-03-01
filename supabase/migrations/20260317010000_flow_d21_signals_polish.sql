begin;

alter table public.biz_signals
  add column if not exists fingerprint text,
  add column if not exists severity_score int not null default 0,
  add column if not exists why text,
  add column if not exists cooldown_until timestamptz;

create index if not exists idx_biz_signals_biz_created_at
  on public.biz_signals (biz_id, created_at desc);

create index if not exists idx_biz_signals_biz_kind_fingerprint
  on public.biz_signals (biz_id, kind, fingerprint);

notify pgrst, 'reload schema';

commit;
