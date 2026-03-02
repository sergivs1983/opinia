/**
 * Guardrails DEV hooks contract tests.
 * Run: npx tsx src/__tests__/guardrails-dev-hooks.test.ts
 */

import { resolveGuardrailDevHooks } from '../lib/guards/dev-hooks';
import { isGuardrailError } from '../lib/guards/errors';
import { enforceOrchestratorDailyCap } from '../lib/guards/orchestrator-cap';
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

function statusFromGuardrailError(error: unknown): number {
  if (!isGuardrailError(error)) return 500;
  if (error.code === 'rate_limited') return 429;
  if (error.code === 'orchestrator_cap_reached') return 429;
  return 500;
}

async function run() {
  const previousNodeEnv = process.env.NODE_ENV;

  console.log('\n=== DEV HOOK FLAG PARSING ===');
  {
    const request = new Request('http://localhost:3000/api/lito/chat?__force_rate_limit=1', {
      headers: { 'x-opinia-force-orchestrator-cap': '1' },
    });
    const hooks = resolveGuardrailDevHooks(request, 'test');
    assert('test env reads query force rate limit', hooks.forceRateLimit === true);
    assert('test env reads header force orchestrator cap', hooks.forceOrchestratorCap === true);
  }

  {
    const request = new Request('http://localhost:3000/api/lito/chat?__force_rate_limit=1&__force_orchestrator_cap=1', {
      headers: {
        'x-opinia-force-rate-limit': '1',
        'x-opinia-force-orchestrator-cap': '1',
      },
    });
    const hooks = resolveGuardrailDevHooks(request, 'production');
    assert('production ignores force rate limit', hooks.forceRateLimit === false);
    assert('production ignores force orchestrator cap', hooks.forceOrchestratorCap === false);
  }

  console.log('\n=== RATE LIMIT FORCE (NODE_ENV=test) ===');
  {
    process.env.NODE_ENV = 'test';
    const supabase = new FakeSupabase();
    const hooks = resolveGuardrailDevHooks(
      new Request('http://localhost:3000/api/lito/chat?__force_rate_limit=1'),
      process.env.NODE_ENV,
    );

    let status = 0;
    try {
      await enforceOrgUserRateLimit({
        supabase: supabase as never,
        orgId: 'org-1',
        userId: 'user-1',
        bizId: 'biz-1',
        key: 'lito_chat',
        orgLimitPerMin: 30,
        userLimitPerMin: 15,
        requestId: 'req-force-rate',
        forceRateLimit: hooks.forceRateLimit,
      });
    } catch (error) {
      status = statusFromGuardrailError(error);
    }

    assert('force rate limit maps to 429 equivalent', status === 429);
    assert('force rate limit telemetry emitted', supabase.hasEvent('rate_limited_org'));
  }

  console.log('\n=== NO FORCE (NODE_ENV=test) ===');
  {
    process.env.NODE_ENV = 'test';
    const supabase = new FakeSupabase();
    const hooks = resolveGuardrailDevHooks(
      new Request('http://localhost:3000/api/lito/chat'),
      process.env.NODE_ENV,
    );

    let threw = false;
    try {
      await enforceOrgUserRateLimit({
        supabase: supabase as never,
        orgId: 'org-2',
        userId: 'user-2',
        bizId: 'biz-2',
        key: 'lito_chat',
        orgLimitPerMin: 30,
        userLimitPerMin: 15,
        requestId: 'req-no-force',
        forceRateLimit: hooks.forceRateLimit,
      });
    } catch {
      threw = true;
    }

    assert('without force flag does not block', threw === false);
  }

  console.log('\n=== PRODUCTION IGNORE ===');
  {
    process.env.NODE_ENV = 'production';
    const supabase = new FakeSupabase();
    const hooks = resolveGuardrailDevHooks(
      new Request('http://localhost:3000/api/lito/chat?__force_rate_limit=1&__force_orchestrator_cap=1', {
        headers: {
          'x-opinia-force-rate-limit': '1',
          'x-opinia-force-orchestrator-cap': '1',
        },
      }),
      process.env.NODE_ENV,
    );

    let rateThrew = false;
    try {
      await enforceOrgUserRateLimit({
        supabase: supabase as never,
        orgId: 'org-3',
        userId: 'user-3',
        bizId: 'biz-3',
        key: 'lito_chat',
        orgLimitPerMin: 30,
        userLimitPerMin: 15,
        requestId: 'req-prod-rate',
        forceRateLimit: hooks.forceRateLimit,
      });
    } catch {
      rateThrew = true;
    }

    let capThrew = false;
    try {
      await enforceOrchestratorDailyCap({
        supabase: supabase as never,
        orgId: 'org-3',
        userId: 'user-3',
        bizId: 'biz-3',
        planCode: 'starter',
        requestId: 'req-prod-cap',
        forceOrchestratorCap: hooks.forceOrchestratorCap,
      });
    } catch {
      capThrew = true;
    }

    assert('production ignores forced rate limit', rateThrew === false);
    assert('production ignores forced orchestrator cap', capThrew === false);
  }

  if (typeof previousNodeEnv === 'string') process.env.NODE_ENV = previousNodeEnv;
  else delete process.env.NODE_ENV;

  console.log(`\n=== RESULTS: ${pass}/${pass + fail} passed ===`);
  if (fail > 0) process.exit(1);
}

void run();
