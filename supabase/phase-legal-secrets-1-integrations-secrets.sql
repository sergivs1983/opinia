-- ═══════════════════════════════════════════════════════════════════════════════
-- GATE 1.4 — FASE 1: integrations_secrets
-- Tokens OAuth xifrats (AES-256-GCM) en taula separada, service-role-only.
-- Idempotent: segur re-executar en qualsevol ordre.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. TAULA DE SECRETS ─────────────────────────────────────────────────────────
--    Cada fila correspon a una integració (1:1 via PK = integration_id).
--    ON DELETE CASCADE: si s'elimina la integració, s'eliminen els secrets.
CREATE TABLE IF NOT EXISTS public.integrations_secrets (
  integration_id    uuid        NOT NULL
                    PRIMARY KEY
                    REFERENCES  public.integrations(id) ON DELETE CASCADE,
  access_token_enc  text        NOT NULL,      -- base64url(IV[12]||AuthTag[16]||Ciphertext)
  refresh_token_enc text,                      -- NULL si el provider no en retorna
  key_version       int         NOT NULL DEFAULT 1,  -- apunta a OAUTH_ENCRYPTION_KEY_V{n}
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS: activat sense cap policy → deny-all per anon i auth ─────────────────
--    Únicament service_role (server-side, mai al client) pot llegir/escriure.
ALTER TABLE public.integrations_secrets ENABLE ROW LEVEL SECURITY;

-- Cap CREATE POLICY intencionat. Service_role bypassa RLS per disseny.
-- Si cal verificar-ho: SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'integrations_secrets';

-- 3. COMENTARIS INLINE ────────────────────────────────────────────────────────
COMMENT ON TABLE public.integrations_secrets IS
  'AES-256-GCM encrypted OAuth tokens. '
  'Accessible exclusivament via service_role (RLS deny-all per anon/auth). '
  'key_version apunta a OAUTH_ENCRYPTION_KEY_V{n} env var. '
  'AAD = integration_id (evita reutilització de ciphertext entre integracions).';

COMMENT ON COLUMN public.integrations_secrets.access_token_enc IS
  'base64url(IV[12 bytes] || AuthTag[16 bytes] || Ciphertext). AAD = integration_id.';

COMMENT ON COLUMN public.integrations_secrets.refresh_token_enc IS
  'Igual que access_token_enc. NULL si el provider no retorna refresh_token.';

COMMENT ON COLUMN public.integrations_secrets.key_version IS
  'Versió de la clau usada al xifrat. '
  'Per rotació: re-xifrar tots els tokens i actualitzar key_version. '
  'Verificació pre-retirada clau V1: SELECT COUNT(*) FROM integrations_secrets WHERE key_version = 1;';

-- 4. ÍNDEXOS ──────────────────────────────────────────────────────────────────
--    El PK (integration_id) ja cobreix lookups individuals.
--    Índex addicional per monitoritzar rotació de claus:
CREATE INDEX IF NOT EXISTS idx_integrations_secrets_key_version
  ON public.integrations_secrets(key_version);
