# Supabase Health Audit (2026-03-03)

Scope: full audit of migrations, schema coherence, functions/triggers, RLS/policies, and local+remote push safety.

## Commands Executed

- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase migration list --linked`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --local` (x2)
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --linked`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --linked --include-all`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db reset --local`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db lint --local`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db lint --linked`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db dump --local --schema public --file /tmp/opinia_local_schema.sql`
- `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db dump --linked --schema public --file /tmp/opinia_remote_schema.sql`

## A) Migracions / Historial

Status: **OK**

- `migration list --linked` now fully aligned (local == remote for every version).
- Added missing baseline migration version and applied remote with `--include-all`:
  - `20260224000000_core_baseline_bootstrap.sql`
- Idempotency check:
  - Local `db push --local` twice => `Remote database is up to date.`
  - Remote `db push --linked` after include-all => `Remote database is up to date.`

## B) Schema base (taules i enums)

Status: **OK**

Verified in local and remote schema dumps:

- Core tables present: `organizations`, `businesses`, `memberships`, `business_memberships`, `integrations`, `integrations_secrets`, `reviews`, `replies`, `recommendation_log`, `lito_threads`, `publish_jobs`, `oauth_states`, `rules`, `social_drafts`, `social_schedules`, `gbp_reviews`, `business_memory`, `push_subscriptions`.
- Enums present: `member_role`, `integration_provider`, `publish_job_status`.
- No `ANY(user_biz_ids())` SRF usage remained in dumped policy definitions.

## C) Functions / Triggers

Status: **OK (with warnings only)**

- `public.user_biz_ids()` is resilient (guard + dynamic SQL):
  - checks `to_regclass('public.business_memberships')`
  - uses `return query execute ...`
- Flow B refresh RPCs exist and are resilient:
  - `claim_google_refresh_lock`, `confirm_google_refresh`, `fail_google_refresh`
- Lint results:
  - `db lint --local`: no errors, only 2 warnings about parameter name `limit` (reserved keyword)
  - `db lint --linked`: same warnings only
- Public trigger DDL in current dump: none (`CREATE TRIGGER` count = 0).

## D) RLS / Policies

Status: **OK**

- RLS enabled on sensitive tables (local dump confirms `ENABLE ROW LEVEL SECURITY` statements; 43 entries local, 59 remote).
- Previously fragile policy/function migrations now guarded on partial schema (to avoid `42P01`/ordering issues).
- Pattern B DB coherence verified:
  - tables: `oauth_states`, `integrations`, `integrations_secrets`
  - RPCs: `consume_oauth_state`, `claim_google_refresh_lock`, `confirm_google_refresh`, `fail_google_refresh`
  - this supports endpoint-side 404 behavior when tokens/rows are missing.

## E) Smoke DB

Status: **OK (DB), with local env note**

- Local:
  - Full migration replay succeeded (via `supabase start` with excluded non-DB services).
  - `db push --local` idempotent.
- Remote:
  - `db push --linked --include-all` applied baseline version safely.
  - Follow-up `db push --linked` reports up-to-date.

Env note:
- In this machine, full `supabase start` with all services hits Docker mount constraints under Desktop paths; DB-only start works and is sufficient for migration/push/lint verification.

## Problems Found

1. `42P01` on org-dependent migrations (`public.organizations` absent during replay).
2. Flow B refresh lint errors due baseline gaps (`token_expires_at`, `integrations_secrets`).
3. Linked push initially blocked by out-of-order pending migration (required `--include-all`).

## Fixes Applied

- Added baseline bootstrap migration:
  - [`supabase/migrations/20260224000000_core_baseline_bootstrap.sql`](../supabase/migrations/20260224000000_core_baseline_bootstrap.sql)
- Guarded org-dependent feature migrations for partial schema replay:
  - [`supabase/migrations/20260313000000_flow_d12_plus_guardrails.sql`](../supabase/migrations/20260313000000_flow_d12_plus_guardrails.sql)
  - [`supabase/migrations/20260314020000_packaging_entitlements.sql`](../supabase/migrations/20260314020000_packaging_entitlements.sql)
  - [`supabase/migrations/20260314030000_phase_t_plan_business_limits_social_posts.sql`](../supabase/migrations/20260314030000_phase_t_plan_business_limits_social_posts.sql)
  - [`supabase/migrations/20260316000000_flow_d19_reverse_trial_soft_lock.sql`](../supabase/migrations/20260316000000_flow_d19_reverse_trial_soft_lock.sql)

## How to Verify (5 commands)

1. `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase migration list --linked`
2. `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase start -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
3. `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --local && ~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --local`
4. `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db push --linked`
5. `~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db lint --local && ~/.npm/_npx/aa8e5c70f9d8d161/node_modules/supabase/bin/supabase db lint --linked`
