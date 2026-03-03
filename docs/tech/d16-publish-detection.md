# D1.6 Pas 0 — Publish Loop Detection (detection-only)

Data: 2026-03-03

Abast: anàlisi de `supabase/migrations/**` + codi runtime (`src/app/api/**`, `src/lib/**`) sense implementar canvis.

## Resum executiu

Hi ha drift real entre migracions i runtime del loop de publish:

- `replies` a migracions no té `status`, `is_edited`, `published_at`, `published_by`.
- `publish_jobs` a migracions no té `integration_id`, `finished_at`, `last_error_code`, `last_error_detail`, `result_gbp_reply_id`.
- El worker `/api/cron/worker/google/publish` espera aquests camps i per tant està desalineat amb schema migrat.
- El connector de publish Google (`src/lib/integrations/google/publish.ts`) és stub i llença `gbp_not_implemented` sempre.
- El flux editorial actual (`/api/lito/action-drafts/[id]/execute`) marca draft com `executed` però no crea `replies` ni encola `publish_jobs`.

Conclusió: **Drift = SÍ** i el loop D1.6 necessita una capa d’alineació de schema abans de connectar execució real.

## A) Taules/FKs reals per `integration_id`

### Source of truth OAuth Google (real)

1. `public.integrations`
   - PK: `id`
   - Clau funcional: `unique (biz_id, provider)`
   - Base a migracions: `20260224000000_core_baseline_bootstrap.sql`
   - Extensions: lock/status (`20260302000000_flow_b_integrations_lock.sql`) + health (`20260324020000_flow_d13_connector_health.sql`)

2. `public.integrations_secrets`
   - PK/FK: `integration_id references public.integrations(id) on delete cascade`
   - Guarda tokens xifrats (`access_token_enc`, `refresh_token_enc`, `key_version`)

3. Runtime que ho confirma
   - OAuth callback: `src/app/api/auth/google/callback/route.ts` (upsert `integrations` + `saveOAuthTokens`)
   - Token read/write: `src/lib/server/tokens.ts` (SoT a `integrations_secrets`, fallback legacy)
   - Sync reviews provider: `src/lib/providers/google/google-reviews-provider.ts`

### FK correcte per `publish_jobs.integration_id`

**FK objectiu:** `public.publish_jobs.integration_id -> public.integrations(id)`.

Nota de consistència tenant: a nivell app/worker s’ha de validar `publish_jobs.biz_id = integrations.biz_id` (defense-in-depth).

## B) Columnes reals de `replies` i `publish_jobs`

## `public.replies` (migracions reals)

Definició base (`20260224000000_core_baseline_bootstrap.sql`):

- `id uuid pk`
- `review_id uuid references public.reviews(id)`
- `org_id uuid not null`
- `biz_id uuid not null`
- `content text not null default ''`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

No hi ha (a migracions): `tone`, `status`, `is_edited`, `published_at`, `published_by`.

## `public.publish_jobs` (migracions reals)

Base (`20260227000000_publish_jobs.sql`):

- `id uuid pk`
- `reply_id uuid not null references public.replies(id)`
- `biz_id uuid not null`
- `org_id uuid not null`
- `status publish_job_status not null default 'queued'`
- `attempts int not null default 0`
- `max_attempts int not null default 5`
- `next_attempt_at timestamptz not null default now()`
- `locked_until timestamptz`
- `error_message text`
- `idempotency_key text not null`
- `published_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Hardening:

- `20260228000000_publish_jobs_hardening.sql`
  - canvia unicitat a `unique (biz_id, idempotency_key)`
  - `pop_publish_jobs` respecta `locked_until`
  - `requeue_stuck_publish_jobs` amb `next_attempt_at = now() + 30s`
- `20260229000000_publish_jobs_lock_tuning.sql`
  - lock de 10 min

## Relació `replies <-> publish_jobs`

- Relació actual: només `publish_jobs.reply_id -> replies.id`.
- No existeix encara `publish_jobs.integration_id` a migracions.

## Constraints/indexes que impacten el loop

- Enum `publish_job_status`: `queued | running | success | failed | queued_retry`.
- Trigger estat (`publish_jobs_state_machine`) limita transicions.
- Índex poll: `idx_publish_jobs_poll (next_attempt_at) where status in ('queued','queued_retry')`.
- Índex lookup reply: `idx_publish_jobs_reply_id (reply_id)`.
- Unicitat idempotència vigent: `publish_jobs_biz_idempotency_key`.

## Recovery fields

- `updated_at`: **sí**.
- `processing_started_at`: **no**.
- Recovery actual es basa en `locked_until` + RPC `requeue_stuck_publish_jobs`.

## Runtime publish actual (detecció)

## Worker

- Handler real: `src/app/api/cron/worker/google/publish/route.ts`
- URL canònica via rewrite: `/api/_internal/google/publish` (`next.config.js`)
- Accés directe a `/api/cron/worker/*` bloquejat a middleware (404)
- Guard intern: `requireInternalGuard(..., mode: 'hmac')`

## Drift del worker vs schema migrat

El worker llegeix/escriu camps que no surten a migracions de `replies/publish_jobs`:

- `replies`: `is_edited`, `status`, `published_at`
- `publish_jobs`: `integration_id`, `finished_at`, `last_error_code`, `last_error_detail`, `result_gbp_reply_id`
- `integrations`: usa `is_active` (no apareix a la cadena de migracions revisada)

## Publish adapter Google

- `src/lib/integrations/google/publish.ts` és stub i fa `throw new GbpPermanentError('gbp_not_implemented', ...)`.
- Implicació: jobs acaben en `failed` immediat si s’arriba a la crida.

## DLQ actual

- Endpoint: `src/app/api/dlq/route.ts`.
- Opera sobre `public.failed_jobs` (retry/resolve).
- `failed_jobs` existeix a `supabase/phase-a-dlq.sql` (script legacy fora `supabase/migrations/**`).
- No és la mateixa cua que `publish_jobs`; és DLQ genèric.

## C) Proposta de migracions additives mínimes (SQL, no aplicades)

```sql
-- 1) Alinear integrations amb camps consumits per runtime (si falten)
alter table public.integrations
  add column if not exists is_active boolean not null default true,
  add column if not exists account_id text,
  add column if not exists access_token text,
  add column if not exists refresh_token text,
  add column if not exists scopes text[];

-- 2) Alinear replies amb workflow editorial/publicació
alter table public.replies
  add column if not exists tone text,
  add column if not exists status text not null default 'draft',
  add column if not exists is_edited boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id);

-- normalitza valors inicials
update public.replies
set status = coalesce(nullif(status, ''), 'draft')
where status is null or status = '';

-- check consistent (text+check per migració no disruptiva)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'replies_status_check'
      and conrelid = 'public.replies'::regclass
  ) then
    alter table public.replies
      add constraint replies_status_check
      check (status in ('draft','selected','published','archived'));
  end if;
end $$;

create index if not exists idx_replies_review_status
  on public.replies (review_id, status);

-- 3) Alinear publish_jobs amb worker
alter table public.publish_jobs
  add column if not exists integration_id uuid references public.integrations(id) on delete set null,
  add column if not exists finished_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_detail text,
  add column if not exists result_gbp_reply_id text,
  add column if not exists processing_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'publish_jobs_last_error_detail_len_check'
      and conrelid = 'public.publish_jobs'::regclass
  ) then
    alter table public.publish_jobs
      add constraint publish_jobs_last_error_detail_len_check
      check (last_error_detail is null or char_length(last_error_detail) <= 300);
  end if;
end $$;

-- 4) Backfill best-effort integration_id per biz (Google)
update public.publish_jobs pj
set integration_id = i.id
from lateral (
  select id
  from public.integrations
  where biz_id = pj.biz_id
    and provider = 'google_business'
  order by updated_at desc nulls last, created_at desc nulls last, id desc
  limit 1
) i
where pj.integration_id is null;

-- 5) Índexos operatius/recovery
create index if not exists idx_publish_jobs_biz_status_next_attempt
  on public.publish_jobs (biz_id, status, next_attempt_at);

create index if not exists idx_publish_jobs_running_locked
  on public.publish_jobs (locked_until)
  where status = 'running';

-- evita duplicats actius per reply
create unique index if not exists uq_publish_jobs_active_reply
  on public.publish_jobs (reply_id)
  where status in ('queued','running','queued_retry');
```

## D) Proposta ordre commits D1.6 (8-10 màxim)

1. **schema alignment (additive only)**
   - migració `integrations/replies/publish_jobs` per cobrir camps consumits pel runtime.
2. **publish domain types/helpers**
   - tipus forts per `ReplyStatus`, `PublishJobStatus`, mapping d’errors GBP.
3. **execute bridge (draft -> reply)**
   - `/api/lito/action-drafts/[id]/execute`: de `kind='gbp_update'` a upsert `replies` idempotent.
4. **enqueue from execute**
   - des d’`execute`: enqueue `publish_jobs` idempotent (`biz_id + idempotency_key`).
5. **worker schema-safe refactor**
   - fer servir només camps existents/alineats + recovery coherent (`processing_started_at` opcional).
6. **real Google publish adapter**
   - implementar `publishReplyToGoogle` (retirar stub `gbp_not_implemented`).
7. **job status/read endpoints sync**
   - validar `/api/publish-jobs/[jobId]` amb schema final + Pattern B.
8. **DLQ interoperability**
   - mapping clar de fallades terminals de publish cap a `failed_jobs` (si aplica) sense trencar `/api/dlq`.
9. **docs + runbook + smoke scripts**
   - actualitzar docs operatives i checklists.

## E) Endpoints nous o reutilitzats (proposta)

Prioritat: **reutilitzar**.

- Reutilitzar: `POST /api/lito/action-drafts/[id]/execute`
  - serà el trigger principal de publish chain (draft executed -> reply upsert -> publish_jobs enqueue).
- Reutilitzar: `POST /api/_internal/google/publish`
  - worker intern HMAC existent.
- Reutilitzar: `GET /api/publish-jobs/[jobId]`
  - tracking d’estat del job.
- Mantenir (compat): `POST /api/replies/[replyId]/publish`
  - pot conviure com entrada directa while transition.

Nous endpoints: **no necessaris** per D1.6 MVP si es reaprofiten els anteriors.

## F) Pla smoke tests (mínim 6)

1. `execute` owner/manager crea/enllaça `reply` i encola 1 `publish_job`.
2. `execute` repetit (mateix draft/review) no duplica job actiu (idempotència).
3. worker success path: `publish_jobs.status -> success`, `replies.status -> published`, `reviews.is_replied -> true`.
4. worker permanent error path: error GBP permanent -> `publish_jobs.status = failed`, sense retry.
5. worker transient error path: error 5xx/429 -> `queued_retry`, `attempts` incrementa, `next_attempt_at` futur.
6. cross-tenant safety: endpoints user-facing (`execute`, `publish-jobs/[id]`) retornen 404 en tenant aliè.
7. internal guard: `/api/_internal/google/publish` sense HMAC => 401/403; amb HMAC vàlid => 200.
8. recovery: job `running` amb `locked_until` expirat es requeueja correctament.

## Notes finals de drift

- El document de context indicat (`docs/tech/drift-replies-publish.md`) no apareix en aquest worktree; s’ha pres com a referència l’estat real de migracions+codi.
- Aquest pas és exclusivament de detecció i pla. No s’han fet canvis runtime.
