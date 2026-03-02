/**
 * Cost guardrails contract tests (mock RPC).
 * Run: npx tsx src/__tests__/cost-guardrails-contract.test.ts
 */

import { enforceOrchestratorDailyCap } from '../lib/guards/orchestrator-cap';
import { isGuardrailError } from '../lib/guards/errors';
import { enforceOrgUserRateLimit } from '../lib/guards/rate-limit';

let pass = 0;
let fail = 0;

function assert(label: string, condition: boolean) {
  console.log(condition ? '✅' : '❌', label);
  if (condition) pass += 1;
  else fail += 1;
}

type RpcResult = {
  data: unknown;
  error: null | { message: string };
};

function nextUtcMidnightIso(): string {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )).toISOString();
}

class FakeSupabase {
  private orgRateCounts = new Map<string, number>();
  private userRateCounts = new Map<string, number>();
  private capCounts = new Map<string, number>();
  private events: Array<{ name: string; props: Record<string, unknown> }> = [];

  async rpc(name: string, params: Record<string, unknown>): Promise<RpcResult> {
    if (name === 'consume_rate_limit_org') {
      const key = `${params.p_org_id}:${params.p_bucket_key}`;
      const current = this.orgRateCounts.get(key) || 0;
      const next = current + 1;
      this.orgRateCounts.set(key, next);
      const limit = Number(params.p_limit || 0);
      return {
        data: [{ allowed: next <= limit, retry_after_seconds: Math.max(1, Math.min(60, 60 - next)) }],
        error: null,
      };
    }

    if (name === 'consume_rate_limit_user') {
      const key = `${params.p_user_id}:${params.p_bucket_key}`;
      const current = this.userRateCounts.get(key) || 0;
      const next = current + 1;
      this.userRateCounts.set(key, next);
      const limit = Number(params.p_limit || 0);
      return {
        data: [{ allowed: next <= limit, retry_after_seconds: Math.max(1, Math.min(60, 60 - next)) }],
        error: null,
      };
    }

    if (name === 'consume_orchestrator_daily_cap') {
      const key = `${params.p_org_id}:${params.p_cap_key || 'orchestrator_safe'}`;
      const current = this.capCounts.get(key) || 0;
      const next = current + 1;
      this.capCounts.set(key, next);
      const plan = String(params.p_plan_code || 'starter');
      const limit = plan === 'scale' ? 50 : plan === 'business' ? 15 : 5;
      return {
        data: [{ allowed: next <= limit, resets_at: nextUtcMidnightIso(), limit, count: next }],
        error: null,
      };
    }

    if (name === 'insert_telemetry_event') {
      this.events.push({
        name: String(params.p_event_name || ''),
        props: ((params.p_props || {}) as Record<string, unknown>),
      });
      return { data: null, error: null };
    }

    return { data: null, error: { message: `unexpected_rpc_${name}` } };
  }

  hasEvent(name: string): boolean {
    return this.events.some((event) => event.name === name);
  }
}

async function run() {
  console.log('\n=== RATE LIMIT ORG CONTRACT ===');
  {
    const supabase = new FakeSupabase();
    const input = {
      supabase: supabase as never,
      orgId: 'org-1',
      userId: 'user-1',
      key: 'lito_chat',
      orgLimitPerMin: 2,
      userLimitPerMin: 99,
      requestId: 'req-test-org',
    };

    await enforceOrgUserRateLimit(input);
    await enforceOrgUserRateLimit(input);

    let blocked = false;
    let retryAfter = 0;
    try {
      await enforceOrgUserRateLimit(input);
    } catch (error) {
      blocked = isGuardrailError(error) && error.code === 'rate_limited' && error.meta.scope === 'org';
      retryAfter = Number((isGuardrailError(error) ? error.meta.retryAfter : 0) || 0);
    }

    assert('consume_rate_limit_org blocks at limit+1', blocked);
    assert('retry_after in range 1..60', retryAfter >= 1 && retryAfter <= 60);
    assert('rate_limited_org telemetry emitted', supabase.hasEvent('rate_limited_org'));
  }

  console.log('\n=== RATE LIMIT USER CONTRACT ===');
  {
    const supabase = new FakeSupabase();
    const input = {
      supabase: supabase as never,
      orgId: 'org-2',
      userId: 'user-2',
      key: 'copy_refine',
      orgLimitPerMin: 99,
      userLimitPerMin: 2,
      requestId: 'req-test-user',
    };

    await enforceOrgUserRateLimit(input);
    await enforceOrgUserRateLimit(input);

    let blocked = false;
    try {
      await enforceOrgUserRateLimit(input);
    } catch (error) {
      blocked = isGuardrailError(error) && error.code === 'rate_limited' && error.meta.scope === 'user';
    }

    assert('consume_rate_limit_user blocks at limit+1', blocked);
    assert('rate_limited_user telemetry emitted', supabase.hasEvent('rate_limited_user'));
  }

  console.log('\n=== ORCHESTRATOR DAILY CAP CONTRACT ===');
  {
    const supabase = new FakeSupabase();
    const input = {
      supabase: supabase as never,
      orgId: 'org-3',
      userId: 'user-3',
      planCode: 'starter',
      requestId: 'req-test-cap',
    };

    for (let i = 0; i < 5; i += 1) {
      await enforceOrchestratorDailyCap(input);
    }

    let blocked = false;
    let limit = 0;
    let count = 0;
    try {
      await enforceOrchestratorDailyCap(input);
    } catch (error) {
      if (isGuardrailError(error) && error.code === 'orchestrator_cap_reached') {
        blocked = true;
        limit = Number(error.meta.limit || 0);
        count = Number(error.meta.count || 0);
      }
    }

    assert('consume_orchestrator_daily_cap blocks after plan limit', blocked);
    assert('orchestrator limit is starter=5', limit === 5);
    assert('orchestrator cap count reports limit+1', count === 6);
    assert('orchestrator_cap_reached telemetry emitted', supabase.hasEvent('orchestrator_cap_reached'));
  }

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

void run();
