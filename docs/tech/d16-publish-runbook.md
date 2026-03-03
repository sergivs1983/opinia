# D1.6 Publish Runbook

Data: 2026-03-03

## Scope

Aquest runbook cobreix el loop D1.6:

- `lito_action_drafts(kind='gbp_update')` execute
- upsert a `replies`
- enqueue `publish_jobs`
- worker `/api/_internal/google/publish`
- DLQ observability via `failed_jobs`

## Pre-requisits

1. Migracions aplicades:
   - `supabase/migrations/20260324050000_flow_d16_publish_schema_alignment.sql`
2. Variables:
   - `INTERNAL_HMAC_SECRET`
   - credencials Supabase + Google OAuth vigents
3. Session vàlida owner/manager per al tenant test.

## Smoke plan (8 casos)

1. Execute crea/enllaça `reply` i encola `publish_job`.
2. Execute repetit és idempotent (no duplica job actiu).
3. Worker success path: `publish_jobs -> success`, `replies -> published`, `reviews.is_replied=true`.
4. Permanent error path: job acaba `failed` (sense retry).
5. Transient error path: job passa a `queued_retry`.
6. Cross-tenant endpoints user-facing retornen 404.
7. Internal guard: sense HMAC 401/403, amb HMAC 200/500.
8. Recovery: job `running` amb lock expirat torna a `queued_retry`.

## Execució ràpida

### Script principal

```bash
./scripts/smoke-flow-d1-6-publish.sh http://localhost:3000
```

Notes:

- Sense `SMOKE_AUTH_COOKIE` i `SMOKE_DRAFT_ID`, els casos que requereixen sessió i dades seed quedaran en `SKIP`.
- El script executa automàticament el test unitari de l’adapter Google per validar casos 4/5.

### Execució completa (amb sessió)

```bash
export SMOKE_AUTH_COOKIE='sb-access-token=...; sb-refresh-token=...'
export SMOKE_DRAFT_ID='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
./scripts/smoke-flow-d1-6-publish.sh http://localhost:3000
```

## Troubleshooting

- `integration_not_found` a execute:
  - verifica `integrations.provider='google_business'` i `is_active=true` per `biz_id`.
- `connector_auth_failed` al worker:
  - revisa `integrations_secrets` i estat `needs_reauth`.
- jobs encallats a `running`:
  - comprova `locked_until`; l'RPC `requeue_stuck_publish_jobs` els ha de reencolar.
- DLQ buit tot i failures:
  - valida existència de taula `public.failed_jobs` (legacy script `supabase/phase-a-dlq.sql`).
