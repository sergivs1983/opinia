# Gate Audit API (Pattern B)

Data d'auditoria: 2026-03-03.

## Resum executiu

- Scope escanejat: **168** endpoints a `src/app/api/**/route.ts`.
- Endpoints amb accés DB/RPC (tractats com a tenant-data candidats): **126**.
- Amb gate estàndard o wrapper equivalent (`requireBizAccess*` / `requireImplicitBizAccessPatternB`): **94**.
- **ENDPOINTS SENSE GATE** (gate abans de la 1a query = NO): **32**.
- Gate **abans de la 1a query DB/RPC** (criteri estricte d'aquesta auditoria): **94 SI** / **32 NO**.
- Risc agregat: **1 Critical**, **96 High**, **29 Medium**.
- **Wave 1 (aquest commit): 10/10 rutes prioritàries FIXED**.
- **Pendents Onada 2**: **22 rutes** (1 USER_FACING_TENANT + 17 INTERNAL + 4 PUBLIC_NON_TENANT).
- Pendents Onada 2 classificades: **SI (116/116)**.
- **Wave2 Lot1 Batch2**: **12 rutes WRITES FIXED** (`admin/billing/integrations/webhooks/onboarding`).
- **Wave2 Lot1 Batch3**: **16 rutes WRITES FIXED** (`audit/business-memory/lito/memory/planner/social`).
- **Wave2 Lot1 Batch4 (final)**: **17 rutes WRITES FIXED** (`businesses/competitors/content-studio/exports/growth-links/integrations/lito-action-drafts/metrics/orgs/push/team/workspace`).
- **Wave2 Lot2 Batch1b**: **14 rutes GET A* FIXED** (context implícit de biz + Pattern B 404; `auth/google/callback` queda especial).
- **Wave2 Lot2 Batch2**: **6 rutes GET Tipus B FIXED** (`brand-image signed-url`, `content assets signed-url`, `exports signed-url`, `g/[slug]`, `publish-jobs/[jobId]`, `recommendations/[id]/howto`).
- **Wave2 Lot2 Batch3**: **1 ruta GET Tipus C FIXED** (`/api/social/notifications` amb paginació scoped per `access.bizId`).
- **WRITES USER_FACING_TENANT pendents (estat actual)**: **0 rutes**.
- **GET USER_FACING_TENANT pendents (estat actual)**: **1 ruta**.

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
Pendents WRITES USER_FACING_TENANT (després Batch 4): **0 rutes**.

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
| /api/admin/business-memberships | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES, LOT2-B1b READS A*) |
| /api/admin/businesses | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES, LOT2-B1b READS A*) |
| /api/admin/org-settings/lito | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES, LOT2-B1b READS A*) |
| /api/audit | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES, LOT2-B1a READS) |
| /api/auth/google/callback | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/billing | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES, LOT2-B1b READS A*) |
| /api/billing/staff-ai-paused | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/billing/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A* + RBAC) |
| /api/billing/trial | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A* + RBAC) |
| /api/business-memory | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/businesses/[id]/brand-image | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/businesses/[id]/brand-image/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/competitors | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/content-studio/assets | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/content-studio/assets/[id]/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/content-studio/x-generate | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/cron/audit-cleanup | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/audit-probe | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/gbp-reviews-sync | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/signals-run | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/cron/worker/google/publish | INTERNAL | Ruta cron/worker; autenticació esperada via secret intern abans de DB. | CLASSIFIED |
| /api/demo-generate | PUBLIC_NON_TENANT | Endpoint demo públic (rate-limit + audit_runs), sense recursos d'un tenant concret. | CLASSIFIED |
| /api/demo-seed | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (PRE-WAVE2) |
| /api/enterprise/overview | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS explicit, LOT2-B1b READS A*) |
| /api/exports | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/exports/[id]/signed-url | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/exports/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/g/[slug] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/growth-links | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/health | PUBLIC_NON_TENANT | Healthcheck públic; només comprova disponibilitat de DB, sense dades tenant. | CLASSIFIED |
| /api/insights/ops | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/insights/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/integrations/connectors | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (PRE-WAVE2, LOT2-B1a READS) |
| /api/integrations/connectors/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/integrations/google/businesses | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A*) |
| /api/integrations/google/connect | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/import-location | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/import-locations | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/integrations/google/list | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A*) |
| /api/integrations/google/locations | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/integrations/google/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/integrations/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/jobs | INTERNAL | Runner de jobs/cron amb `x-cron-secret` o context admin. | CLASSIFIED |
| /api/lito/action-cards | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/lito/action-drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/lito/action-drafts/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/lito/action-drafts/[id]/approve | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/lito/action-drafts/[id]/execute | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/lito/action-drafts/[id]/reject | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/lito/action-drafts/[id]/submit | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/lito/cards/state | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/copy | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/lito/copy/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/lito/reviews/drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/signals-pro | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/lito/threads | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/threads/[threadId] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/threads/[threadId]/close | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/lito/threads/[threadId]/messages | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/lito/voice/drafts/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/lito/voice/prepare | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/voice/stt | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/voice/transcribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/lito/voice/tts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/locale | PUBLIC_NON_TENANT | Canvi de locale de perfil/cookie; no opera sobre recursos biz/org. | CLASSIFIED |
| /api/memory/events | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/memory/profile | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/memory/voice | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/metrics/rebuild | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/metrics/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/onboarding | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/onboarding/seed | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/orgs/[orgId]/set-plan | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/planner | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/planner/[id] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/planner/[id]/send | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/publish-jobs/[jobId] | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/push/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/push/subscribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/push/unsubscribe | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/recommendations/[id]/feedback | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/recommendations/[id]/howto | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B2 READS resourceId) |
| /api/recommendations/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/replies/[replyId]/approve | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/replies/[replyId]/publish | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/review-audit | PUBLIC_NON_TENANT | Endpoint demo públic (rate-limit + audit_runs), sense recursos d'un tenant concret. | CLASSIFIED |
| /api/seo/capabilities | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS) |
| /api/social/drafts | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/social/drafts/inbox | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS explicit, LOT2-B1b READS A*) |
| /api/social/notifications | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B3 READS paginació) |
| /api/social/schedules | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B3 WRITES) |
| /api/social/schedules/[id]/cancel | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/social/schedules/[id]/publish | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/social/schedules/[id]/snooze | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/social/stats/weekly | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS explicit, LOT2-B1b READS A*) |
| /api/status | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1a READS explicit, LOT2-B1b READS A*) |
| /api/stripe/webhook | INTERNAL | Webhook Stripe signat (server-to-server), fora de flux UI. | CLASSIFIED |
| /api/team | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A*) |
| /api/team/invite | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
| /api/team/member | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/team/role | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B1 RESOURCE WRITES) |
| /api/telemetry/summary | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT2-B1b READS A* + RBAC) |
| /api/triggers/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (PRE-WAVE2) |
| /api/webhooks/config | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES, LOT2-B1a READS) |
| /api/webhooks/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B2 WRITES) |
| /api/workspace/active-org | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | FIXED (LOT1-B4 WRITES) |
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
| /api/admin/business-memberships | GET,PATCH | b:org_id,membership_id,business_ids,role_override \| biz/resource:SI | SI | High | FIXED LOT1-B2/LOT2-B1b: GET+PATCH amb gate Pattern B abans de DB (`requireImplicitBizAccessPatternB`/`requireBizAccessPatternB`) + RBAC via `access.role` (404). |
| /api/admin/businesses | GET,POST,PUT,PATCH | b:org_id,slug,business_id \| biz/resource:SI | SI | High | FIXED LOT1-B2/LOT2-B1b: GET+POST+PUT+PATCH amb gate Pattern B abans de DB + RBAC via `access.role` (404). |
| /api/admin/org-settings/lito | GET,PATCH | b:userId,orgId,org_id,ai_provider \| biz/resource:SI | SI | High | FIXED LOT1-B2/LOT2-B1b: GET+PATCH amb gate Pattern B abans de DB + RBAC owner/manager (404). |
| /api/audit | GET,POST | q:biz_id \| b:org_id,biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B3/LOT2-B1a: GET+POST amb `requireBizAccessPatternB` abans de DB i scope per `access.bizId`. |
| /api/auth/google/callback | GET | q:error,code,state \| biz/resource:SI | NO | High | Usa admin/service-role sense `requireBizAccess*`. |
| /api/billing | GET,POST | q:org_id \| b:plan_id,org_id \| biz/resource:SI | SI | High | FIXED LOT1-B2/LOT2-B1b: GET+POST amb gate Pattern B abans de DB + RBAC via `access.role` (404). |
| /api/billing/staff-ai-paused | POST | b:org_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC owner/manager via `access.role`. |
| /api/billing/status | GET | biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB + RBAC owner/manager amb 404. |
| /api/billing/trial | GET | biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB + RBAC owner/manager amb 404. |
| /api/business-memory | GET,PUT,PATCH | q:biz_id \| b:bizId,userId \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` + RBAC per `access.role` en GET/PUT/PATCH. |
| /api/businesses/[id]/brand-image | POST | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requireBizAccessPatternB` abans de la 1a query + persistència scoped per `access.bizId`. |
| /api/businesses/[id]/brand-image/signed-url | GET | p:id \| biz/resource:SI | SI | High | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.Businesses)` abans de DB i query scoped per `access.bizId`. |
| /api/competitors | GET,POST,DELETE | q:biz_id,id \| b:biz_id,org_id,place_id,review_count \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` abans de DB; DELETE sense lookup previ i scoped per `biz_id`. |
| /api/content-intel/generate | POST | b:businessId,maxReviews \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/content-intel/suggestions/[id] | PATCH | p:id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/content-studio/assets | GET | h:x-biz-id \| b:businessId,templateId \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate `requireBizAccessPatternB` abans de `content_assets` i llista scoped per `access.bizId`. |
| /api/content-studio/assets/[id]/signed-url | GET | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.ContentAssets)` abans de DB i lookup scoped per `access.bizId`. |
| /api/content-studio/render | POST | h:x-biz-id \| b:suggestionId,sourceAssetId,templateId \| biz/resource:SI | NO | Critical | Usa admin/service-role sense `requireBizAccess*`. |
| /api/content-studio/x-generate | POST | h:x-biz-id \| b:suggestionId \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` abans del lookup de `content_suggestions` + query scoped. |
| /api/cron/audit-cleanup | POST | h:authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/audit-probe | POST | h:authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/gbp-reviews-sync | POST,GET | h:x-cron-secret,authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/signals-run | POST,GET | h:x-cron-secret,authorization \| biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/cron/worker/google/publish | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/demo-generate | POST | biz/resource:SI | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/demo-seed | POST | q:biz_id \| biz/resource:SI | SI | Medium | FIXED pre-Wave2: gate `requireBizAccess*` ja estava abans de la query principal. |
| /api/dlq | GET,POST | q:status,biz_id \| b:failed_job_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/enterprise/overview | GET | q:biz_id,range,channel \| b:total_reviews,neg_reviews,biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a/B1b: gate Pattern B (explícit+implícit) abans de DB; context de biz resolt de forma única amb 404 indistingible. |
| /api/exports | GET | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate `requireBizAccessPatternB` abans de DB i query scoped per `access.bizId`. |
| /api/exports/[id]/signed-url | GET | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.Exports)` abans de DB i lookup scoped per `access.bizId`. |
| /api/exports/weekly | POST | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` ja aplicat abans de la 1a query DB. |
| /api/g/[slug] | GET | p:slug \| biz/resource:SI | SI | Medium | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.GrowthLinks)` abans de DB; lookup de `growth_links` scoped per `gate.bizId`. |
| /api/growth-links | GET,POST,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | SI | High | FIXED LOT1-B4: migrat a `requireBizAccessPatternB`; DELETE sense lookup manual previ de recurs. |
| /api/health | GET | biz/resource:NO | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/insights/ops | GET | q:biz_id,range \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/insights/summary | GET | q:biz_id,range,source,rating \| biz/resource:SI | SI | Medium | `requireBizAccess*` abans de la query principal. |
| /api/integrations/connectors | GET,POST | h:x-biz-id \| biz/resource:SI | SI | Medium | FIXED PRE-WAVE2/LOT2-B1a: GET amb `requireBizAccessPatternB` abans de DB (POST write fix ja aplicat). |
| /api/integrations/connectors/[id] | PATCH | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + RBAC per `gate.role`. |
| /api/integrations/google/businesses | GET | biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB i llista limitada a l'org de `access.membership.orgId`. |
| /api/integrations/google/connect | POST | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/integrations/google/import-location | POST | b:biz_id,location_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de qualsevol lookup/DB (Pattern B 404). |
| /api/integrations/google/import-locations | POST | b:seed_biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/integrations/google/list | GET | biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB i llista limitada a l'org de `access.membership.orgId`. |
| /api/integrations/google/locations | GET | b:seed_biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate `requireBizAccessPatternB` abans de DB + RBAC amb `access.role` (404). |
| /api/integrations/google/status | GET | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate `requireBizAccessPatternB` abans de DB + RBAC amb `access.role` (404). |
| /api/integrations/test | POST | h:x-biz-id \| b:connectorId \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` + RBAC amb `access.role` (denegació 404). |
| /api/jobs | POST | h:x-cron-secret \| b:job,org_id,biz_id \| biz/resource:SI | NO | Medium | Control alternatiu (hasAcceptedOrgMembership) però fora l'estàndard. |
| /api/kb | GET,POST,PATCH,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/lito/action-cards | GET | q:biz_id,refresh \| b:bizId,biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: migrat a `requireBizAccessPatternB` i query scoped per `access.bizId`. |
| /api/lito/action-drafts | GET | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: migrat a `requireBizAccessPatternB` i query scoped per `access.bizId`. |
| /api/lito/action-drafts/[id] | PATCH | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `loadDraftContext` fa `requireResourceAccessPatternB(ResourceTable.Drafts)` abans de DB + denegació RBAC 404. |
| /api/lito/action-drafts/[id]/approve | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requireResourceAccessPatternB` via shared helper + RBAC per rol amb 404. |
| /api/lito/action-drafts/[id]/execute | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requireResourceAccessPatternB` via shared helper + RBAC per rol amb 404. |
| /api/lito/action-drafts/[id]/reject | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requireResourceAccessPatternB` via shared helper + RBAC per rol amb 404. |
| /api/lito/action-drafts/[id]/submit | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requireResourceAccessPatternB` via shared helper + RBAC per rol amb 404. |
| /api/lito/cards/state | POST | b:biz_id,card_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + accions validades per `access.role`. |
| /api/lito/copy | GET | b:biz_id,recommendation_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate estàndard + RBAC amb `gate.role`; lookup a `recommendation_log` scoped per `gate.bizId`. |
| /api/lito/copy/generate | POST | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/copy/refine | POST | b:biz_id,recommendation_id \| biz/resource:SI | NO | High | Control alternatiu (getAcceptedBusinessMembershipContext) però fora l'estàndard. |
| /api/lito/copy/status | GET | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate estàndard + RBAC amb `gate.role`; consultes scoped per `gate.bizId`. |
| /api/lito/reviews/drafts | POST | b:bizId,gbpReviewId,biz_id,review_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC owner/manager via `access.role`. |
| /api/lito/signals-pro | GET | q:biz_id,range_days,signal_id \| b:biz_id,signal_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate estàndard + RBAC amb `gate.role`; llistes/lookup scoped per `gate.bizId`. |
| /api/lito/threads | POST,GET | b:biz_id,recommendation_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` + RBAC per `access.role`, sense segon lookup de membresia. |
| /api/lito/threads/[threadId] | GET,PATCH | p:threadId \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireResourceAccessPatternB` + RBAC per `gate.role`. |
| /api/lito/threads/[threadId]/close | POST | p:threadId \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/lito/threads/[threadId]/messages | GET,POST | p:threadId \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/lito/voice/drafts/[id] | DELETE | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/lito/voice/prepare | POST | b:biz_id,thread_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/lito/voice/stt | POST | biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de qualsevol query (`lito_threads/lito_voice_clips`). |
| /api/lito/voice/transcribe | POST | b:biz_id,thread_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de qualsevol query (`lito_threads/lito_voice_clips`). |
| /api/lito/voice/tts | POST | b:biz_id,message_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de qualsevol query (`lito_messages/lito_threads/lito_voice_clips`). |
| /api/locale | POST | biz/resource:NO | NO | High | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/memory/events | POST | b:biz_id,evidence_ref,confidence \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/memory/profile | PUT,PATCH | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/memory/voice | PUT,PATCH | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/metrics/rebuild | POST | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` abans de DB + owner-check via `access.role` (denegació 404). |
| /api/metrics/summary | GET | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate `requireBizAccessPatternB` abans de DB i queries scoped per `access.bizId`. |
| /api/onboarding | GET,PATCH | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B2: GET/PATCH amb `requireBizAccessPatternB` abans de DB. |
| /api/onboarding/seed | POST | h:x-biz-id \| b:businessId \| biz/resource:SI | SI | High | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/ops-actions | GET,POST,PATCH,DELETE | q:biz_id,status,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/orgs/[orgId]/set-plan | POST | p:orgId \| h:x-admin-secret,x-biz-id \| biz/resource:SI | SI | Medium | FIXED LOT1-B4: via usuari, gate `requireBizAccessPatternB` + role-check `access.role` i scope d'org amb 404; via secret manté flux intern. |
| /api/planner | GET,POST | h:x-biz-id \| b:businessId,suggestionId,assetId,textPostId \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` + RBAC per `access.role` (404 Pattern B en mismatch). |
| /api/planner/[id] | PATCH | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/planner/[id]/send | POST | p:id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/publish-jobs/[jobId] | GET | p:jobId \| biz/resource:SI | SI | High | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.PublishJobs)` abans de DB; query scoped per `gate.bizId`. |
| /api/push/status | GET | q:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: `requirePushBizAccess` consolidat amb `requireBizAccessPatternB`; query scoped per `access.bizId`. |
| /api/push/subscribe | POST | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requirePushBizAccess` consolidat sobre `requireBizAccessPatternB` sense lookup extra de membresia. |
| /api/push/unsubscribe | POST | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT1-B4: `requirePushBizAccess` consolidat sobre `requireBizAccessPatternB` sense lookup extra de membresia. |
| /api/recommendations/[id]/feedback | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + scoped per `gate.bizId`. |
| /api/recommendations/[id]/howto | GET | p:id \| biz/resource:SI | SI | High | FIXED LOT2-B2: `requireResourceAccessPatternB(ResourceTable.RecommendationLog)` abans de DB; query scoped per `gate.bizId`. |
| /api/recommendations/weekly | GET | b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate estàndard + RBAC amb `gate.role`; lookup de negoci scoped per `gate.bizId`. |
| /api/replies/[replyId]/approve | POST | p:replyId \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + scoped per `gate.bizId`. |
| /api/replies/[replyId]/publish | POST | p:replyId \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + scoped per `gate.bizId`. |
| /api/review-audit | POST | biz/resource:SI | NO | Medium | Sense gate estàndard; depèn de RLS/lògica manual. |
| /api/reviews/[reviewId]/generate | POST | p:reviewId \| b:request_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/seo/capabilities | GET | h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT2-B1a: gate estàndard abans dels probes a `businesses` i scope per `access.bizId`. |
| /api/social/drafts | GET,POST | b:biz_id,recommendation_id,thread_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/social/drafts/inbox | GET | b:org_id,biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a/B1b: gate Pattern B (explícit+implícit) abans de DB, mismatch d'`org_id` i rol insuficient retornen 404. |
| /api/social/notifications | GET | q:biz_id,limit,page \| b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B3: gate Pattern B implícit abans de DB + queries llista/count sempre scoped per `access.bizId` (sense cursor leakage). |
| /api/social/schedules | GET,POST | q:biz_id,from,to,limit \| b:biz_id,draft_id,assigned_user_id \| biz/resource:SI | SI | High | FIXED LOT1-B3: gate `requireBizAccessPatternB` abans de DB + RBAC per `access.role`. |
| /api/social/schedules/[id]/cancel | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/social/schedules/[id]/publish | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/social/schedules/[id]/snooze | POST | p:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB, scoped per `gate.bizId`. |
| /api/social/stats/weekly | GET | q:biz_id \| b:biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a/B1b: gate Pattern B abans de DB per camí explícit i implícit; 404 per context absent/cross-tenant. |
| /api/status | GET | q:org_id,biz_id \| biz/resource:SI | SI | High | FIXED LOT2-B1a/B1b: gate Pattern B abans de DB en camí explícit i implícit; org mismatch/cross-tenant => 404. |
| /api/stripe/webhook | POST | biz/resource:SI | NO | Medium | Ruta interna/cron/webhook amb secret/HMAC; sense gate estàndard de tenant. |
| /api/team | GET | q:org_id \| biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB; org mismatch/cross-tenant => 404. |
| /api/team/invite | POST | b:org_id \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role` (404) i scope de `org_id`. |
| /api/team/member | DELETE | q:id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + scoped per `gate.bizId`. |
| /api/team/role | PATCH | b:membership_id \| biz/resource:SI | SI | High | FIXED LOT1-B1: `requireResourceAccessPatternB` abans de DB + scoped per `gate.bizId`. |
| /api/telemetry/summary | GET | biz/resource:SI | SI | High | FIXED LOT2-B1b: gate Pattern B implícit abans de DB + RBAC owner/manager via `access.role` (404). |
| /api/triggers | GET,POST,PUT,DELETE | q:biz_id,id \| b:biz_id,org_id \| biz/resource:SI | NO | High | `requireBizAccess*` existent però arriba tard (ordre/parcial Pattern B). |
| /api/triggers/test | POST | q:biz_id \| b:biz_id \| biz/resource:SI | SI | Medium | FIXED pre-Wave2: gate `requireBizAccess*` abans de la query principal. |
| /api/webhooks/config | GET,PATCH | h:x-biz-id \| biz/resource:SI | SI | Medium | FIXED LOT1-B2/LOT2-B1a: GET+PATCH amb gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/webhooks/test | POST | h:x-biz-id \| biz/resource:SI | SI | Medium | FIXED LOT1-B2: gate `requireBizAccessPatternB` abans de DB + RBAC via `access.role`. |
| /api/workspace/active-org | POST | b:orgId \| h:x-biz-id \| biz/resource:SI | SI | High | FIXED LOT1-B4: gate `requireBizAccessPatternB` abans de DB + scope de `orgId` amb resposta Pattern B 404. |

## ENDPOINTS SENSE GATE

> Només rutes amb `Gate abans 1a query = NO`.

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
- /api/content-intel/generate
- /api/content-intel/suggestions/[id]
- /api/content-studio/render
- /api/cron/audit-cleanup
- /api/cron/audit-probe
- /api/cron/gbp-reviews-sync
- /api/cron/signals-run
- /api/cron/worker/google/publish
- /api/demo-generate
- /api/dlq
- /api/health
- /api/jobs
- /api/kb
- /api/lito/copy/generate
- /api/lito/copy/refine
- /api/locale
- /api/ops-actions
- /api/review-audit
- /api/stripe/webhook
- /api/triggers

## Metodologia (detecció automàtica + revisió manual)

- `rg` sobre `src/app/api/**` per trobar `supabase.from(`, `supabase.rpc(`, `createAdminClient/getAdminClient`, `requireBizAccess*`, i checks de membership/HMAC/cron.
- Classificació de risc per heurística (tipus de client DB, tipus de guard, natura interna/cron/webhook), amb ajust manual en rutes conegudes.
- El camp “Gate abans 1a query” segueix criteri estricte de l'objectiu: compta `requireBizAccess*` i els wrappers equivalents `requireImplicitBizAccessPatternB` / `requireResourceAccessPatternB`; no compta altres guards alternatius.
