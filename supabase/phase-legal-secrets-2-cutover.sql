-- ═══════════════════════════════════════════════════════════════════════════════
-- GATE 1.4 — FASE 2 + 3: CUTOVER (executar NOMÉS quan el backfill és 100% verificat)
-- ═══════════════════════════════════════════════════════════════════════════════
-- PREREQUISITS:
--   1. phase-legal-secrets-1-integrations-secrets.sql ja executat.
--   2. scripts/backfill-tokens.ts ha sortit amb exit_code=0.
--   3. TOKEN_MIGRATION_PHASE=new_only desplegat.
--   4. Les queries de verificació sota han retornat 0 files pendents.
--
-- QUERIES DE VERIFICACIÓ (executar ABANS d'aquest fitxer):
--
--   -- Quantes integracions amb access_token NON NULL encara no estan a secrets?
--   SELECT COUNT(*) AS pending_migration
--   FROM public.integrations i
--   LEFT JOIN public.integrations_secrets s ON s.integration_id = i.id
--   WHERE i.access_token IS NOT NULL
--     AND s.integration_id IS NULL;
--   -- Ha de retornar 0.
--
--   -- Quantes files a integrations_secrets?
--   SELECT COUNT(*), key_version
--   FROM public.integrations_secrets
--   GROUP BY key_version;
--   -- Ha de coincidir amb el total d'integracions amb access_token.
--
--   -- Quantes files de secrets manquen?
--   SELECT COUNT(*) AS not_yet_migrated
--   FROM public.integrations
--   WHERE access_token IS NOT NULL;
--   -- Ha de retornar 0 (o coincidir exactament amb COUNT de integrations_secrets).
-- ═══════════════════════════════════════════════════════════════════════════════

-- FASE 2: NULL-OUT legacy columns (reversible — columnes continuen existint)
UPDATE public.integrations
SET
  access_token  = NULL,
  refresh_token = NULL
WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL;

-- Verificació post-update:
-- SELECT COUNT(*) FROM public.integrations WHERE access_token IS NOT NULL;
-- Ha de retornar 0.

-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 3: DROP COLUMNS (irrecuperable — executar ÚNICAMENT quan fase 2 és 100% confirmada)
-- Uncomment the block below only when:
--   a) All integrations_secrets rows verified
--   b) No code paths reference integrations.access_token / integrations.refresh_token
--   c) TOKEN_MIGRATION_PHASE=new_only running stable in prod for >= 48h
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE public.integrations
--   DROP COLUMN IF EXISTS access_token,
--   DROP COLUMN IF EXISTS refresh_token;

-- COMMENT ON TABLE public.integrations IS
--   'OAuth integration metadata per business. '
--   'Tokens are stored encrypted in public.integrations_secrets (service-role-only).';
