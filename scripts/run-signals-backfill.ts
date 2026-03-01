/**
 * scripts/run-signals-backfill.ts
 *
 * Manual runner (MVP scheduler) for D2.1 Signals PRO.
 * Calls POST /api/_internal/signals/run with HMAC for each business that has
 * an active google_business integration.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx/esm scripts/run-signals-backfill.ts
 *   node --env-file=.env.local --import tsx/esm scripts/run-signals-backfill.ts http://localhost:3000
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const INTERNAL_PATH = '/api/_internal/signals/run';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function buildSignature(params: { secret: string; method: string; pathname: string; rawBody: string }) {
  const ts = Date.now().toString();
  const bodyHash = crypto.createHash('sha256').update(params.rawBody).digest('hex');
  const canonical = `${ts}.${params.method.toUpperCase()}.${params.pathname}.${bodyHash}`;
  const signature = crypto.createHmac('sha256', params.secret).update(canonical).digest('hex');
  return { ts, signature };
}

async function main(): Promise<void> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRole = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const hmacSecret = requireEnv('INTERNAL_HMAC_SECRET');
  const baseUrl = (process.argv[2] || DEFAULT_BASE_URL).trim().replace(/\/$/, '');

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from('integrations')
    .select('biz_id, org_id')
    .eq('provider', 'google_business')
    .eq('is_active', true)
    .not('biz_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(2500);

  if (error) {
    throw new Error(`active_integrations_query_failed: ${error.message}`);
  }

  const bizIds = Array.from(new Set(
    (data || [])
      .map((row) => row.biz_id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));

  if (bizIds.length === 0) {
    console.log('[signals-backfill] no active google_business integrations found');
    return;
  }

  console.log(`[signals-backfill] base=${baseUrl} businesses=${bizIds.length}`);

  let success = 0;
  let failed = 0;

  for (const bizId of bizIds) {
    const rawBody = JSON.stringify({
      biz_id: bizId,
      provider: 'google_business',
      range_days: 7,
    });
    const { ts, signature } = buildSignature({
      secret: hmacSecret,
      method: 'POST',
      pathname: INTERNAL_PATH,
      rawBody,
    });

    try {
      const response = await fetch(`${baseUrl}${INTERNAL_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-opin-timestamp': ts,
          'x-opin-signature': signature,
        },
        body: rawBody,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`[signals-backfill] FAIL biz=${bizId} status=${response.status} body=${body.slice(0, 180)}`);
        failed += 1;
        continue;
      }

      const payload = await response.json().catch(() => ({}));
      const processed = typeof payload.processed === 'number' ? payload.processed : 0;
      const active = typeof payload.active === 'number' ? payload.active : 0;
      console.log(`[signals-backfill] OK biz=${bizId} processed=${processed} active=${active}`);
      success += 1;
    } catch (error) {
      console.error(`[signals-backfill] FAIL biz=${bizId} error=${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }

  console.log(`[signals-backfill] done success=${success} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`[signals-backfill] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
