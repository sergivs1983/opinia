/**
 * Circuit Breaker — DB-persisted, serverless-safe, race-condition-safe.
 *
 * Key: (provider, model, org_id?).
 * States: closed → open (after N failures) → half_open (after TTL) → closed/open.
 *
 * Uses:
 * - cb_upsert() SQL function with pg_advisory_xact_lock for atomic writes.
 * - admin client (service_role) to bypass RLS.
 */

import type { LLMProvider } from '@/lib/llm/provider';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// TYPES
// ============================================================
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitConfig {
  failureThreshold: number;
  openTtlSeconds: number;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  openTtlSeconds: 120,
};

export interface CircuitStatus {
  state: CircuitState;
  failureCount: number;
  openUntil: string | null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// READ
// ============================================================
/**
 * Get circuit state. Auto-transitions open → half_open when TTL expires.
 */
export async function getCircuitState(
  provider: LLMProvider,
  model: string,
  orgId?: string | null,
  admin?: SupabaseClient,
): Promise<CircuitStatus> {
  if (!admin) return { state: 'closed', failureCount: 0, openUntil: null };
  const now = new Date();

  // Build query for nullable org_id
  let query = admin
    .from('circuit_breakers')
    .select('state, failure_count, open_until');

  if (orgId) {
    query = query.eq('provider', provider).eq('model', model).eq('org_id', orgId);
  } else {
    query = query.eq('provider', provider).eq('model', model).is('org_id', null);
  }

  const { data: row } = await query.maybeSingle();

  if (!row) {
    return { state: 'closed', failureCount: 0, openUntil: null };
  }

  // Auto-transition: open → half_open when TTL expired
  if (row.state === 'open' && row.open_until && new Date(row.open_until) <= now) {
    // Transition via cb_upsert (atomic)
    await admin.rpc('cb_upsert', {
      p_org_id: orgId || null,
      p_provider: provider,
      p_model: model,
      p_state: 'half_open',
      p_failure_count: row.failure_count,
      p_last_failure_at: null,
      p_open_until: row.open_until,
    });

    return { state: 'half_open', failureCount: row.failure_count, openUntil: row.open_until };
  }

  return {
    state: row.state as CircuitState,
    failureCount: row.failure_count,
    openUntil: row.open_until,
  };
}

// ============================================================
// WRITE — SUCCESS
// ============================================================
/**
 * Record success — reset circuit to closed.
 */
export async function recordSuccess(
  provider: LLMProvider,
  model: string,
  orgId?: string | null,
  admin?: SupabaseClient,
): Promise<void> {
  if (!admin) return;
  await admin.rpc('cb_upsert', {
    p_org_id: orgId || null,
    p_provider: provider,
    p_model: model,
    p_state: 'closed',
    p_failure_count: 0,
    p_last_failure_at: null,
    p_open_until: null,
  });
}

// ============================================================
// WRITE — FAILURE
// ============================================================
/**
 * Record failure — increment count, open circuit if threshold reached.
 * Returns the new state.
 */
export async function recordFailure(
  provider: LLMProvider,
  model: string,
  orgId?: string | null,
  config: CircuitConfig = DEFAULT_CONFIG,
  admin?: SupabaseClient,
): Promise<CircuitState> {
  if (!admin) return 'closed';
  const now = new Date();

  // Read current state (to compute new failure_count)
  let query = admin
    .from('circuit_breakers')
    .select('failure_count, state');

  if (orgId) {
    query = query.eq('provider', provider).eq('model', model).eq('org_id', orgId);
  } else {
    query = query.eq('provider', provider).eq('model', model).is('org_id', null);
  }

  const { data: existing } = await query.maybeSingle();

  const newCount = (existing?.failure_count || 0) + 1;
  const shouldOpen = newCount >= config.failureThreshold;
  const newState: CircuitState = shouldOpen ? 'open' : 'closed';
  const openUntil = shouldOpen
    ? new Date(now.getTime() + config.openTtlSeconds * 1000).toISOString()
    : null;

  await admin.rpc('cb_upsert', {
    p_org_id: orgId || null,
    p_provider: provider,
    p_model: model,
    p_state: newState,
    p_failure_count: newCount,
    p_last_failure_at: now.toISOString(),
    p_open_until: openUntil,
  });

  return newState;
}

// ============================================================
// ERROR CLASSIFICATION
// ============================================================
/**
 * Should this error count as a circuit breaker failure?
 * YES: timeouts, 429 rate limit, 5xx server errors, network errors.
 * NO: 4xx client errors (except 429).
 */
export function isCircuitBreakerError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  if (msg.includes('abort') || msg.includes('timeout') || msg.includes('TIMEOUT')) return true;
  if (msg.includes(' 429')) return true;
  if (/\b5\d{2}\b/.test(msg)) return true;
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) return true;
  if (/\b4\d{2}\b/.test(msg) && !msg.includes(' 429')) return false;
  return true;
}

/**
 * Classify error into error_code string for DLQ/logs.
 */
export function classifyError(error: unknown): string {
  const msg = getErrorMessage(error);
  if (msg.includes('abort') || msg.includes('timeout')) return 'timeout';
  if (msg.includes(' 429')) return 'rate_limited';
  if (/\b5\d{2}\b/.test(msg)) return 'provider_error';
  if (msg.includes('not configured')) return 'no_api_key';
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) return 'network_error';
  return 'unknown';
}
