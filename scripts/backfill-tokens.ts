/**
 * scripts/backfill-tokens.ts — Idempotent OAuth token backfill.
 *
 * Reads legacy plaintext tokens from public.integrations and writes
 * AES-256-GCM encrypted copies to public.integrations_secrets.
 *
 * IDEMPOTENT: rows already at CURRENT_KEY_VERSION are skipped.
 * SAFE TO RE-RUN: uses keyset pagination + upsert with onConflict.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   OAUTH_ENCRYPTION_KEY_V1=<64-hex-chars> \
 *   npx tsx scripts/backfill-tokens.ts
 *
 *   Or with .env.local loaded:
 *   node --env-file=.env.local --import tsx/esm scripts/backfill-tokens.ts
 *
 * OUTPUT:
 *   [backfill] Starting batch=100 key_version=1
 *   [backfill] Batch id>null: 100 rows
 *   [backfill]   ✓ <uuid>
 *   [backfill]   ⊘ <uuid> (already v1, skipped)
 *   [backfill]   ✗ <uuid> error: ...
 *   [backfill] Done. processed=97 skipped=3 errors=0
 *
 * Exit codes:
 *   0 — all rows processed or skipped, zero errors
 *   1 — one or more errors (check output for details)
 */

import { createClient } from '@supabase/supabase-js';
import { encryptToken, CURRENT_KEY_VERSION } from '../src/lib/server/crypto';

const BATCH_SIZE = 100;

// ── Env validation ─────────────────────────────────────────────────────────
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`[backfill] Missing required env var: ${name}`);
  }
  return v.trim();
}

async function main(): Promise<void> {
  const supabaseUrl    = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  // Validate encryption key exists before starting (fail-fast)
  requireEnv(`OAUTH_ENCRYPTION_KEY_V${CURRENT_KEY_VERSION}`);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let processed = 0;
  let skipped   = 0;
  let errors    = 0;
  let lastId: string | null = null;

  console.log(`[backfill] Starting batch=${BATCH_SIZE} key_version=${CURRENT_KEY_VERSION}`);

  // ── Keyset pagination loop ────────────────────────────────────────────────
  while (true) {
    // Fetch next batch of integrations that have a legacy access_token
    let query = admin
      .from('integrations')
      .select('id, access_token, refresh_token')
      .not('access_token', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (lastId !== null) {
      query = query.gt('id', lastId);
    }

    const { data: rows, error: fetchError } = await query;

    if (fetchError) {
      console.error(`[backfill] Fetch error (last_id=${lastId}): ${fetchError.message}`);
      errors++;
      break;
    }

    if (!rows || rows.length === 0) {
      break; // No more rows
    }

    console.log(`[backfill] Batch id>${lastId ?? 'null'}: ${rows.length} rows`);

    for (const row of rows) {
      lastId = row.id;

      try {
        // ── Skip if already at current key version (idempotent) ─────────
        const { data: existing } = await admin
          .from('integrations_secrets')
          .select('key_version')
          .eq('integration_id', row.id)
          .maybeSingle();

        if (existing && existing.key_version === CURRENT_KEY_VERSION) {
          console.log(`[backfill]   ⊘ ${row.id} (already v${CURRENT_KEY_VERSION}, skipped)`);
          skipped++;
          continue;
        }

        // ── Encrypt tokens ───────────────────────────────────────────────
        const aad = row.id;
        const { enc: accessEnc, key_version } = encryptToken(
          row.access_token as string,
          aad,
        );
        const refreshEnc = row.refresh_token
          ? encryptToken(row.refresh_token as string, aad).enc
          : null;

        // ── Upsert to secrets table ──────────────────────────────────────
        const { error: upsertError } = await admin
          .from('integrations_secrets')
          .upsert(
            {
              integration_id:    row.id,
              access_token_enc:  accessEnc,
              refresh_token_enc: refreshEnc,
              key_version,
              updated_at:        new Date().toISOString(),
            },
            { onConflict: 'integration_id' },
          );

        if (upsertError) {
          console.error(`[backfill]   ✗ ${row.id} upsert error: ${upsertError.message}`);
          errors++;
        } else {
          console.log(`[backfill]   ✓ ${row.id}`);
          processed++;
        }
      } catch (e: unknown) {
        // NEVER print row.access_token or row.refresh_token here
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[backfill]   ✗ ${row.id} error: ${msg}`);
        errors++;
      }
    }

    if (rows.length < BATCH_SIZE) {
      break; // Last batch (partial)
    }
  }

  console.log(
    `[backfill] Done. processed=${processed} skipped=${skipped} errors=${errors}`,
  );

  if (errors > 0) {
    console.error('[backfill] Completed with errors. Check output above.');
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[backfill] Fatal: ${msg}`);
  process.exit(1);
});
