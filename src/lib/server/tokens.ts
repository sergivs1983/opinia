/**
 * src/lib/server/tokens.ts — Secure OAuth token persistence layer.
 *
 * SECURITY CONTRACT:
 *   • Server-only. Requires service_role Supabase client (bypasses RLS).
 *   • All tokens encrypted with AES-256-GCM via crypto.ts before DB write.
 *   • Never logs plaintext tokens. Errors use generic messages.
 *
 * MIGRATION PHASES (TOKEN_MIGRATION_PHASE env var):
 *
 *   "dual_write"  (default during cutover)
 *     Write to integrations_secrets (encrypted) AND integrations legacy columns (plaintext).
 *     Read from integrations_secrets; fall back to legacy if secret row missing.
 *     Safe during backfill period — old code paths still work via legacy columns.
 *
 *   "new_only"  (after backfill + verification)
 *     Write to integrations_secrets only. Clears legacy columns on write (defense-in-depth).
 *     Read from integrations_secrets only; no fallback.
 *
 * CUTOVER ORDER:
 *   1. Deploy TOKEN_MIGRATION_PHASE=dual_write + new code
 *   2. Run backfill script
 *   3. Verify: SELECT COUNT(*) FROM integrations_secrets;
 *   4. Switch TOKEN_MIGRATION_PHASE=new_only
 *   5. SQL cleanup: UPDATE integrations SET access_token=NULL, refresh_token=NULL;
 *   6. DROP COLUMN (only after confirming integrations_secrets has all rows)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, decryptToken, CURRENT_KEY_VERSION } from '@/lib/server/crypto';

type MigrationPhase = 'dual_write' | 'new_only';

function getMigrationPhase(): MigrationPhase {
  const phase = process.env.TOKEN_MIGRATION_PHASE;
  if (phase === 'new_only') return 'new_only';
  // Default to dual_write — safe during transition; requires explicit opt-in to new_only
  return 'dual_write';
}

// ============================================================
// SAVE
// ============================================================

/**
 * saveOAuthTokens — Persist OAuth tokens securely.
 *
 * Always upserts to integrations_secrets (encrypted).
 * Dual-write phase: also writes plaintext to legacy integrations columns.
 * New-only phase: clears legacy columns (defense-in-depth).
 *
 * @param adminClient   Supabase service_role client (required — bypasses RLS on secrets).
 * @param integrationId UUID of the integration row (used as AAD for GCM).
 * @param accessToken   Plaintext access token.
 * @param refreshToken  Plaintext refresh token (omit or pass null if not available).
 */
export async function saveOAuthTokens(
  adminClient: SupabaseClient,
  integrationId: string,
  accessToken: string,
  refreshToken?: string | null,
): Promise<void> {
  const aad = integrationId; // AAD binds ciphertext to this specific integration

  const { enc: accessEnc, key_version } = encryptToken(accessToken, aad);
  const refreshEnc = refreshToken
    ? encryptToken(refreshToken, aad).enc
    : null;

  // ── 1. Upsert to secrets table ────────────────────────────────────────────
  const { error: secretsError } = await adminClient
    .from('integrations_secrets')
    .upsert(
      {
        integration_id:    integrationId,
        access_token_enc:  accessEnc,
        refresh_token_enc: refreshEnc,
        key_version,
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'integration_id' },
    );

  if (secretsError) {
    throw new Error(`[tokens] Failed to persist secrets for integration: ${secretsError.message}`);
  }

  // ── 2. Phase-aware legacy column handling ─────────────────────────────────
  const phase = getMigrationPhase();

  if (phase === 'dual_write') {
    // Write plaintext to legacy columns so old code paths still work during cutover
    const { error: legacyError } = await adminClient
      .from('integrations')
      .update({
        access_token:  accessToken,
        refresh_token: refreshToken ?? null,
      })
      .eq('id', integrationId);

    if (legacyError) {
      // Non-fatal: encrypted secret is already safely persisted above.
      // Log without any token value — just the integration ID and error code.
      console.error(
        `[tokens] dual_write: failed to update legacy columns for ${integrationId}: ${legacyError.message}`,
      );
    }
  } else {
    // new_only: clear legacy columns to eliminate plaintext at rest
    const { error: clearError } = await adminClient
      .from('integrations')
      .update({ access_token: null, refresh_token: null })
      .eq('id', integrationId);

    if (clearError) {
      // Non-fatal: encrypted secret is persisted; log for monitoring
      console.error(
        `[tokens] new_only: failed to clear legacy columns for ${integrationId}: ${clearError.message}`,
      );
    }
  }
}

// ============================================================
// GET
// ============================================================

/**
 * getOAuthTokens — Read and decrypt OAuth tokens.
 *
 * Primary: reads from integrations_secrets, decrypts with correct key version.
 * Fallback (dual_write phase only): reads plaintext from legacy integrations columns.
 *
 * @param adminClient   Supabase service_role client.
 * @param integrationId UUID of the integration row.
 * @returns             { accessToken, refreshToken } — decrypted plaintext strings.
 * @throws              If no tokens found in either source.
 */
export async function getOAuthTokens(
  adminClient: SupabaseClient,
  integrationId: string,
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const aad = integrationId;

  // ── Primary: encrypted secrets table ─────────────────────────────────────
  const { data: secret, error: secretError } = await adminClient
    .from('integrations_secrets')
    .select('access_token_enc, refresh_token_enc, key_version')
    .eq('integration_id', integrationId)
    .single();

  if (!secretError && secret) {
    const accessToken = decryptToken(secret.access_token_enc, aad, secret.key_version);
    const refreshToken = secret.refresh_token_enc
      ? decryptToken(secret.refresh_token_enc, aad, secret.key_version)
      : null;

    return { accessToken, refreshToken };
  }

  // ── Fallback: legacy columns (dual_write compat only) ────────────────────
  const phase = getMigrationPhase();
  if (phase === 'new_only') {
    // In new_only mode, absence from secrets table is always an error
    throw new Error(
      `[tokens] No secret found for integration ${integrationId} `
      + `(secret lookup: ${secretError?.message ?? 'row not found'}).`,
    );
  }

  // dual_write: tolerate missing secrets row — use legacy columns as bridge
  const { data: legacy, error: legacyError } = await adminClient
    .from('integrations')
    .select('access_token, refresh_token')
    .eq('id', integrationId)
    .single();

  if (legacyError || !legacy?.access_token) {
    throw new Error(
      `[tokens] No tokens found for integration ${integrationId}. `
      + 'Run the backfill script to migrate plaintext tokens to integrations_secrets.',
    );
  }

  return {
    accessToken:  legacy.access_token,
    refreshToken: legacy.refresh_token ?? null,
  };
}

// ============================================================
// KEY ROTATION HELPERS
// ============================================================

/**
 * reencryptToken — Re-encrypt a single integration's tokens under a new key version.
 * Used during key rotation — call once per row in integrations_secrets.
 *
 * @param adminClient     service_role client
 * @param integrationId   row to re-encrypt
 * @param targetVersion   new key version (must exist in env as OAUTH_ENCRYPTION_KEY_V{n})
 */
export async function reencryptToken(
  adminClient: SupabaseClient,
  integrationId: string,
  targetVersion: number,
): Promise<void> {
  // Read current ciphertext
  const { data, error } = await adminClient
    .from('integrations_secrets')
    .select('access_token_enc, refresh_token_enc, key_version')
    .eq('integration_id', integrationId)
    .single();

  if (error || !data) {
    throw new Error(`[tokens] re-encrypt: no secrets row for ${integrationId}`);
  }

  if (data.key_version === targetVersion) {
    return; // Already at target version — idempotent
  }

  // Decrypt with current version
  const aad         = integrationId;
  const accessPlain = decryptToken(data.access_token_enc, aad, data.key_version);
  const refreshPlain = data.refresh_token_enc
    ? decryptToken(data.refresh_token_enc, aad, data.key_version)
    : null;

  // Re-encrypt with target version
  const { enc: newAccessEnc }  = encryptToken(accessPlain, aad, targetVersion);
  const newRefreshEnc = refreshPlain
    ? encryptToken(refreshPlain, aad, targetVersion).enc
    : null;

  const { error: upsertError } = await adminClient
    .from('integrations_secrets')
    .update({
      access_token_enc:  newAccessEnc,
      refresh_token_enc: newRefreshEnc,
      key_version:       targetVersion,
      updated_at:        new Date().toISOString(),
    })
    .eq('integration_id', integrationId);

  if (upsertError) {
    throw new Error(`[tokens] re-encrypt update failed for ${integrationId}: ${upsertError.message}`);
  }
}
