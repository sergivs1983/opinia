# Wave 2 Gate Plan (Classificació)

Data: 2026-03-03.

## Comptadors

- Pendents classificats: **116**
- #USER_FACING_TENANT: **95**
- #INTERNAL: **17**
- #PUBLIC_NON_TENANT: **4**

## Taula de classificació

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
| /api/admin/business-memberships | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/admin/businesses | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/admin/org-settings/lito | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/audit | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/auth/google/callback | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/billing | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/billing/staff-ai-paused | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
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
| /api/integrations/google/connect | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/import-location | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/integrations/google/import-locations | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
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
| /api/onboarding | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/onboarding/seed | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
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
| /api/webhooks/config | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/webhooks/test | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
| /api/workspace/active-org | USER_FACING_TENANT | Crida de producte/UI amb dades tenant (biz/org/resource) via DB/RPC. | CLASSIFIED |
