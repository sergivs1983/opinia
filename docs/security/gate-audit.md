# Gate Audit API (Pattern B)

Data d'auditoria: 2026-03-03.

## Resum executiu

- Scope escanejat: **168** endpoints a `src/app/api/**/route.ts`.
- Endpoints amb accés DB/RPC (tractats com a tenant-data candidats): **126**.
- Amb `requireBizAccess/requireBizAccessPatternB` (apareix al fitxer): **14**.
- **ENDPOINTS SENSE GATE** (sense `requireBizAccess*`): **112**.
- Gate **abans de la 1a query DB/RPC** (criteri estricte d'aquesta auditoria): **5 SI** / **121 NO**.
- Risc agregat: **1 Critical**, **96 High**, **29 Medium**.
- **Wave 1 (aquest commit): 10/10 rutes prioritàries FIXED**.
- **Pendents Onada 2**: **116 rutes** (inventari 126 - 10 fixes de Wave 1).
- Pendents Onada 2 classificades: **SI (116/116)**.

> Nota: aquest informe separa "gate estàndard" (`requireBizAccess*`) de controls alternatius (membership/HMAC/cron helpers).

## Top 10 a arreglar

1. `[FIXED] /api/content-studio/render` — gate Pattern B aplicat abans de les queries a `content_suggestions/content_assets/businesses`.
1. `[FIXED] /api/content-intel/generate` — gate Pattern B mogut abans de la query inicial a `businesses`.
1. `[FIXED] /api/reviews/[reviewId]/generate` — Pattern B consistent (404 indistingible) + query principal scoped per `biz_id`.
1. `[FIXED] /api/content-intel/suggestions/[id]` — gate Pattern B abans de mutació; update scoped per `business_id`.
1. `[FIXED] /api/dlq` — gate Pattern B al principi de GET/POST i queries scoped per `biz_id`.
1. `[FIXED] /api/kb` — PATCH/DELETE sense lookup previ cross-tenant; scoped per `biz_id` després de gate.
1. `[FIXED] /api/triggers` — PUT/DELETE sense lookup previ cross-tenant; scoped per `biz_id` després de gate.
1. `[FIXED] /api/ops-actions` — PATCH/DELETE sense lookup previ cross-tenant; scoped per `biz_id` després de gate.
1. `[FIXED] /api/lito/copy/generate` — substitució de guard alternatiu per gate estàndard Pattern B.
1. `[FIXED] /api/lito/copy/refine` — substitució de guard alternatiu per gate estàndard Pattern B.

## Wave 1 Fixes Aplicades

- `/api/content-studio/render`
- `/api/content-intel/generate`
- `/api/reviews/[reviewId]/generate`
- `/api/content-intel/suggestions/[id]`
- `/api/dlq`
- `/api/kb`
- `/api/triggers`
- `/api/ops-actions`
- `/api/lito/copy/generate`
- `/api/lito/copy/refine`

Pendents Onada 2 (scope inventari actual): **116 rutes**.

## Pendents Onada 2 — CLASSIFIED

Comptadors de classificació:

- #USER_FACING_TENANT: **95**
- #INTERNAL: **17**
- #PUBLIC_NON_TENANT: **4**

<!-- WAVE2_CLASSIFIED_START -->
| Route | CLASS | JUSTIFICACIÓ | STATUS |
|---|---|---|---|
| /api/_internal/bootstrap | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/gbp/reviews/sync | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/insights/rollup | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/lito/rebuild-cards | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/rules/run | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/signals/backfill | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/signals/run | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/signals/to-weekly | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/social/reminders/run | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/_internal/voice/purge | INTERNAL | Ruta interna de worker/orquestració; s'ha de blindar amb secret/HMAC. | CLASSIFIED |
| /api/admin/business-memberships | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/admin/businesses | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/admin/org-settings/lito | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/audit | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/auth/google/callback | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/billing | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/billing/staff-ai-paused | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/billing/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/billing/trial | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/business-memory | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/businesses/[id]/brand-image | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/businesses/[id]/brand-image/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/competitors | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/content-studio/assets | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/content-studio/assets/[id]/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/content-studio/x-generate | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/cron/audit-cleanup | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/audit-probe | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/gbp-reviews-sync | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/signals-run | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/worker/google/publish | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/demo-generate | PUBLIC_NON_TENANT | Endpoint demo públic (rate-limit + audit_runs), sense recursos d'un tenant concret. | CLASSIFIED |
| /api/demo-seed | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/enterprise/overview | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/exports | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/exports/[id]/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/exports/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/g/[slug] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/growth-links | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/health | PUBLIC_NON_TENANT | Healthcheck públic; només comprova disponibilitat de DB, sense dades tenant. | CLASSIFIED |
| /api/insights/ops | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/insights/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/connectors | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/connectors/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/businesses | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/connect | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/import-location | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/import-locations | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/list | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/locations | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/jobs | INTERNAL | Runner de jobs/cron amb `x-cron-secret` o context admin. | CLASSIFIED |
| /api/lito/action-cards | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts/[id]/approve | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts/[id]/execute | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts/[id]/reject | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/action-drafts/[id]/submit | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/cards/state | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/copy | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/copy/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/reviews/drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/signals-pro | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/threads | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/threads/[threadId] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/threads/[threadId]/close | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/threads/[threadId]/messages | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/voice/drafts/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/voice/prepare | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/voice/stt | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/voice/transcribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/lito/voice/tts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/locale | PUBLIC_NON_TENANT | Canvi de locale de perfil/cookie; no opera sobre recursos biz/org. | CLASSIFIED |
| /api/memory/events | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/memory/profile | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/memory/voice | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/metrics/rebuild | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/metrics/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/onboarding | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/onboarding/seed | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/orgs/[orgId]/set-plan | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/planner | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/planner/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/planner/[id]/send | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/publish-jobs/[jobId] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/push/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/push/subscribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/push/unsubscribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/recommendations/[id]/feedback | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/recommendations/[id]/howto | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/recommendations/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/replies/[replyId]/approve | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/replies/[replyId]/publish | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/review-audit | PUBLIC_NON_TENANT | Endpoint demo públic (rate-limit + audit_runs), sense recursos d'un tenant concret. | CLASSIFIED |
| /api/seo/capabilities | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/drafts/inbox | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/notifications | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/schedules | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/schedules/[id]/cancel | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/schedules/[id]/publish | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/schedules/[id]/snooze | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/social/stats/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/stripe/webhook | INTERNAL | Webhook Stripe signat (server-to-server), fora de flux UI. | CLASSIFIED |
| /api/team | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/team/invite | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/team/member | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/team/role | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/telemetry/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/triggers/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/webhooks/config | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/webhooks/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/workspace/active-org | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
<!-- WAVE2_CLASSIFIED_END -->


## Taula completa d'endpoints (tenant-data candidats)

| Route | Mètodes | Inputs (query/body/params) | Gate abans 1a query | Risc | Nota |
|---|---|---|---|---|---|
| /api/_internal/bootstrap | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/gbp/reviews/sync | POST | b:business,reviews,bizId \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/insights/rollup | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/lito/rebuild-cards | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/rules/run | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/signals/backfill | POST | b:biz_id,provider \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/signals/run | POST | b:biz_id,provider \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/signals/to-weekly | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/social/reminders/run | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/_internal/voice/purge | POST | biz/resource:NO | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/admin/business-memberships | GET,PATCH | b:org_id,membership_id,business_ids,role_override \| biz/resource:SI | PARTIAL | High | FIXED LOT1-B2 en PATCH amb `requireBizAccessPatternB` + RBAC per `access.role` (GET pendent). |
| /api/admin/businesses | GET,POST,PUT,PATCH | b:org_id,slug,business_id \| biz/resource:SI | PARTIAL | High | FIXED LOT1-B2 en POST/PUT/PATCH amb `requireBizAccessPatternB` + RBAC per `access.role` (GET pendent). |
| /api/admin/org-settings/lito | GET,PATCH | b:userId,orgId,org_id,ai_provider \| biz/resource:SI | PARTIAL | High | FIXED LOT1-B2 en PATCH amb `requireBizAccessPatternB` + RBAC per `access.role` (GET pendent). |
| /api/audit | GET,POST | q:biz_id \| b:org_id,biz_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/auth/google/callback | GET | q:error,code,state \| biz/resource:SI | NO | High | Usa admin/service-role sense `requireBizAccess*`. |
| /api/billing | GET,POST | q:org_id \| b:plan_id,org_id \| biz/resource:SI | PARTIAL | High | FIXED LOT1-B2 en POST amb `requireBizAccessPatternB` + owner-only via `access.role` (GET pendent). |
| /api/billing/staff-ai-paused | POST | b:org_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC owner/manager via `access.role`. |
| /api/billing/status | GET | biz/resource:SI | NO | High | Control alternatiu (getAcceptedOrgMembership) però fora l'estàndard. |
| /api/billing/trial | GET | biz/resource:SI | NO | High | Control alternatiu (getAcceptedOrgMembership) però fora l'estàndard. |
| /api/business-memory | GET,PUT,PATCH | q:biz_id \| b:bizId,userId \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/businesses/[id]/brand-image | POST | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/businesses/[id]/brand-image/signed-url | GET | p:id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/competitors | GET,POST,DELETE | q:biz_id,id \| b:biz_id,org_id,place_id,review_count \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/content-intel/generate | POST | b:businessId,maxReviews \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/content-intel/suggestions/[id] | PATCH | p:id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/content-studio/assets | GET | h:x-biz-id \| b:businessId,templateId \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/content-studio/assets/[id]/signed-url | GET | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/content-studio/render | POST | h:x-biz-id \| b:suggestionId,sourceAssetId,templateId \| biz/resource:SI | NO | Critical | Usa admin/service-role sense `requireBizAccess*`. |
| /api/content-studio/x-generate | POST | h:x-biz-id \| b:suggestionId \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/cron/audit-cleanup | POST | h:authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/audit-probe | POST | h:authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/gbp-reviews-sync | POST,GET | h:x-cron-secret,authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/signals-run | POST,GET | h:x-cron-secret,authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/worker/google/publish | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/demo-generate | POST | biz/resource:SI | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/demo-seed | POST | q:biz_id \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/dlq | GET,POST | q:status,biz_id \| b:failed_job_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/enterprise/overview | GET | q:biz_id,range,channel \| b:total_reviews,neg_reviews,biz_id \| biz/resource:SI | NO | High | Usa admin/service-role sense `requireBizAccess*`. |
| /api/exports | GET | h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/exports/[id]/signed-url | GET | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/exports/weekly | POST | h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/g/[slug] | GET | p:slug \| biz/resource:SI | NO | Medium | Usa admin/service-role sense `requireBizAccess*`. |
| /api/growth-links | GET,POST,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/health | GET | biz/resource:NO | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/insights/ops | GET | q:biz_id,range \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/insights/summary | GET | q:biz_id,range,source,rating \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/integrations/connectors | GET,POST | h:x-biz-id \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/integrations/connectors/[id] | PATCH | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/integrations/google/businesses | GET | biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/integrations/google/connect | POST | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/integrations/google/import-location | POST | b:biz_id,location_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de qualsevol lookup/DB (Pattern B 404). |
| /api/integrations/google/import-locations | POST | b:seed_biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/integrations/google/list | GET | biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/integrations/google/locations | GET | b:seed_biz_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/integrations/google/status | GET | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/integrations/test | POST | h:x-biz-id \| b:connectorId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/jobs | POST | h:x-cron-secret \| b:job,org_id,biz_id \| biz/resource:SI | NO | Medium | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/kb | GET,POST,PATCH,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/lito/action-cards | GET | q:biz_id,refresh \| b:bizId,biz_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/action-drafts | GET | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/action-drafts/[id] | PATCH | p:id \| biz/resource:SI | NO | High | Control alternatiu (loadDraftContext) però fora l'estàndard. |
| /api/lito/action-drafts/[id]/approve | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (loadDraftContext) però fora l'estàndard. |
| /api/lito/action-drafts/[id]/execute | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (loadDraftContext) però fora l'estàndard. |
| /api/lito/action-drafts/[id]/reject | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (loadDraftContext) però fora l'estàndard. |
| /api/lito/action-drafts/[id]/submit | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (loadDraftContext) però fora l'estàndard. |
| /api/lito/cards/state | POST | b:biz_id,card_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/copy | GET | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/copy/generate | POST | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/copy/refine | POST | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/copy/status | GET | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/reviews/drafts | POST | b:bizId,gbpReviewId,biz_id,review_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/signals-pro | GET | q:biz_id,range_days,signal_id \| b:biz_id,signal_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/lito/threads | POST,GET | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/lito/threads/[threadId] | GET,PATCH | p:threadId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/lito/threads/[threadId]/close | POST | p:threadId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/lito/threads/[threadId]/messages | GET,POST | p:threadId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/lito/voice/drafts/[id] | DELETE | p:id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/voice/prepare | POST | b:biz_id,thread_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/voice/stt | POST | biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/voice/transcribe | POST | b:biz_id,thread_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/lito/voice/tts | POST | b:biz_id,message_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/locale | POST | biz/resource:NO | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/memory/events | POST | b:biz_id,evidence_ref,confidence \| biz/resource:SI | NO | High | Control alternatiu (requireMemoryBizAccess) però fora l'estàndard. |
| /api/memory/profile | PUT,PATCH | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (requireMemoryBizAccess) però fora l'estàndard. |
| /api/memory/voice | PUT,PATCH | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (requireMemoryBizAccess) però fora l'estàndard. |
| /api/metrics/rebuild | POST | h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/metrics/summary | GET | h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/onboarding | GET,PATCH | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B2: GET/PATCH amb `requireBizAccessPatternB` abans de DB. |
| /api/onboarding/seed | POST | h:x-biz-id \| b:businessId \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/ops-actions | GET,POST,PATCH,DELETE | q:biz_id,status,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/orgs/[orgId]/set-plan | POST | p:orgId \| h:x-admin-secret \| biz/resource:SI | NO | Medium | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/planner | GET,POST | h:x-biz-id \| b:businessId,suggestionId,assetId,textPostId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/planner/[id] | PATCH | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/planner/[id]/send | POST | p:id \| h:x-biz-id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/publish-jobs/[jobId] | GET | p:jobId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/push/status | GET | q:biz_id \| biz/resource:SI | NO | High | Control alternatiu (requirePushBizAccess) però fora l'estàndard. |
| /api/push/subscribe | POST | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (requirePushBizAccess) però fora l'estàndard. |
| /api/push/unsubscribe | POST | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (requirePushBizAccess) però fora l'estàndard. |
| /api/recommendations/[id]/feedback | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/recommendations/[id]/howto | GET | p:id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/recommendations/weekly | GET | b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/replies/[replyId]/approve | POST | p:replyId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/replies/[replyId]/publish | POST | p:replyId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/review-audit | POST | biz/resource:SI | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/reviews/[reviewId]/generate | POST | p:reviewId \| b:request_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/seo/capabilities | GET | h:x-biz-id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/social/drafts | GET,POST | b:biz_id,recommendation_id,thread_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/social/drafts/inbox | GET | b:org_id,biz_id \| biz/resource:SI | NO | High | Control alternatiu (getLitoBizAccess) però fora l'estàndard. |
| /api/social/notifications | GET | q:biz_id,limit \| b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/social/schedules | GET,POST | q:biz_id,from,to,limit \| b:biz_id,draft_id,assigned_user_id \| biz/resource:SI | NO | High | Control alternatiu (requireUserAndBizAccess) però fora l'estàndard. |
| /api/social/schedules/[id]/cancel | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (requireUserAndBizAccess) però fora l'estàndard. |
| /api/social/schedules/[id]/publish | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (requireUserAndBizAccess) però fora l'estàndard. |
| /api/social/schedules/[id]/snooze | POST | p:id \| biz/resource:SI | NO | High | Control alternatiu (requireUserAndBizAccess) però fora l'estàndard. |
| /api/social/stats/weekly | GET | q:biz_id \| b:biz_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedBusinessMembership) però fora l'estàndard. |
| /api/status | GET | q:org_id,biz_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/stripe/webhook | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/team | GET | q:org_id \| biz/resource:SI | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/team/invite | POST | b:org_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/team/member | DELETE | q:id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/team/role | PATCH | b:membership_id \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/telemetry/summary | GET | biz/resource:SI | NO | High | Control alternatiu (getAcceptedOrgMembership) però fora l'estàndard. |
| /api/triggers | GET,POST,PUT,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/triggers/test | POST | q:biz_id \| b:biz_id \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/webhooks/config | GET,PATCH | h:x-biz-id \| biz/resource:SI | PARTIAL | Medium | FIXED LOT1-B2 en PATCH amb `requireBizAccessPatternB` abans de DB + RBAC via `access.role` (GET pendent). |
| /api/webhooks/test | POST | h:x-biz-id \| biz/resource:SI | SI | Medium | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/workspace/active-org | POST | b:orgId \| biz/resource:SI | NO | High | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |

## ENDPOINTS SENSE GATE

> Només rutes (sense `requireBizAccess/requireBizAccessPatternB`).

- /api/_internal/bootstrap
- /api/_internal/gbp/reviews/sync
- /api/_internal/insights/rollup
- /api/_internal/lito/rebuild-cards
- /api/_internal/rules/run
- /api/_internal/signals/backfill
- /api/_internal/signals/run
- /api/_internal/signals/to-weekly
- /api/_internal/social/reminders/run
- /api/_internal/voice/purge
- /api/auth/google/callback
- /api/billing/status
- /api/billing/trial
- /api/business-memory
- /api/businesses/[id]/brand-image
- /api/businesses/[id]/brand-image/signed-url
- /api/competitors
- /api/content-studio/assets
- /api/content-studio/assets/[id]/signed-url
- /api/content-studio/render
- /api/content-studio/x-generate
- /api/cron/audit-cleanup
- /api/cron/audit-probe
- /api/cron/gbp-reviews-sync
- /api/cron/signals-run
- /api/cron/worker/google/publish
- /api/demo-generate
- /api/enterprise/overview
- /api/exports
- /api/exports/[id]/signed-url
- /api/exports/weekly
- /api/g/[slug]
- /api/health
- /api/integrations/connectors/[id]
- /api/integrations/google/businesses
- /api/integrations/google/list
- /api/integrations/google/locations
- /api/integrations/google/status
- /api/integrations/test
- /api/jobs
- /api/lito/action-cards
- /api/lito/action-drafts
- /api/lito/action-drafts/[id]
- /api/lito/action-drafts/[id]/approve
- /api/lito/action-drafts/[id]/execute
- /api/lito/action-drafts/[id]/reject
- /api/lito/action-drafts/[id]/submit
- /api/lito/cards/state
- /api/lito/copy
- /api/lito/copy/generate
- /api/lito/copy/refine
- /api/lito/copy/status
- /api/lito/reviews/drafts
- /api/lito/signals-pro
- /api/lito/threads
- /api/lito/threads/[threadId]
- /api/lito/threads/[threadId]/close
- /api/lito/threads/[threadId]/messages
- /api/lito/voice/drafts/[id]
- /api/lito/voice/prepare
- /api/lito/voice/stt
- /api/lito/voice/transcribe
- /api/lito/voice/tts
- /api/locale
- /api/memory/events
- /api/memory/profile
- /api/memory/voice
- /api/metrics/rebuild
- /api/metrics/summary
- /api/orgs/[orgId]/set-plan
- /api/planner
- /api/planner/[id]
- /api/planner/[id]/send
- /api/publish-jobs/[jobId]
- /api/push/status
- /api/push/subscribe
- /api/push/unsubscribe
- /api/recommendations/[id]/feedback
- /api/recommendations/[id]/howto
- /api/recommendations/weekly
- /api/replies/[replyId]/approve
- /api/replies/[replyId]/publish
- /api/review-audit
- /api/seo/capabilities
- /api/social/drafts
- /api/social/drafts/inbox
- /api/social/notifications
- /api/social/schedules
- /api/social/schedules/[id]/cancel
- /api/social/schedules/[id]/publish
- /api/social/schedules/[id]/snooze
- /api/social/stats/weekly
- /api/status
- /api/stripe/webhook
- /api/team
- /api/team/invite
- /api/team/member
- /api/team/role
- /api/telemetry/summary
- /api/workspace/active-org

## Metodologia (detecció automàtica + revisió manual)

- `rg` sobre `src/app/api/**` per trobar `supabase.from(`, `supabase.rpc(`, `createAdminClient/getAdminClient`, `requireBizAccess*`, i checks de membership/HMAC/cron.
- Classificació de risc per heurística (tipus de client DB, tipus de guard, natura interna/cron/webhook), amb ajust manual en rutes conegudes.
- El camp “Gate abans 1a query” segueix criteri estricte de l'objectiu: només compta `requireBizAccess*` i no altres guards.
