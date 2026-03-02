import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizePlanCode, type CanonicalPlanCode } from '@/lib/billing/entitlements';
import { GuardrailError } from '@/lib/guards/errors';

type CapRpcRow = {
  allowed?: unknown;
  resets_at?: unknown;
  limit?: unknown;
  count?: unknown;
};

function toBool(value: unknown): boolean {
  return value === true;
}

function toInt(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseCapRow(data: unknown): {
  allowed: boolean;
  resetsAt: string;
  limit: number;
  count: number;
} {
  const row = Array.isArray(data) ? data[0] : data;
  const defaultResetsAt = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate() + 1,
    0,
    0,
    0,
    0,
  )).toISOString();

  if (!row || typeof row !== 'object') {
    return {
      allowed: false,
      resetsAt: defaultResetsAt,
      limit: 0,
      count: 0,
    };
  }

  const typed = row as CapRpcRow;
  const parsedResetsAt = typeof typed.resets_at === 'string' && typed.resets_at.trim().length > 0
    ? Date.parse(typed.resets_at)
    : Number.NaN;
  const resetsAt = Number.isFinite(parsedResetsAt)
    ? new Date(parsedResetsAt).toISOString()
    : defaultResetsAt;

  return {
    allowed: toBool(typed.allowed),
    resetsAt,
    limit: Math.max(0, toInt(typed.limit, 0)),
    count: Math.max(0, toInt(typed.count, 0)),
  };
}

async function emitCapEvent(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  bizId?: string | null;
  planCode: CanonicalPlanCode;
  limit: number;
  count: number;
  requestId: string;
}): Promise<void> {
  try {
    await params.supabase.rpc('insert_telemetry_event', {
      p_org_id: params.orgId,
      p_user_id: params.userId,
      p_event_name: 'orchestrator_cap_reached',
      p_props: {
        org_id: params.orgId,
        biz_id: params.bizId ?? null,
        plan_code: params.planCode,
        limit: params.limit,
        count: params.count,
        cap_key: 'orchestrator_safe',
        request_id: params.requestId,
      },
    });
  } catch {
    // Telemetry should never break guardrails.
  }
}

export async function enforceOrchestratorDailyCap(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string;
  bizId?: string | null;
  planCode: string | null | undefined;
  requestId: string;
}): Promise<void> {
  const canonicalPlan = normalizePlanCode(params.planCode);

  const result = await params.supabase.rpc('consume_orchestrator_daily_cap', {
    p_org_id: params.orgId,
    p_plan_code: canonicalPlan,
    p_cap_key: 'orchestrator_safe',
  });

  if (result.error) {
    throw new Error(result.error.message || 'consume_orchestrator_daily_cap_failed');
  }

  const parsed = parseCapRow(result.data);
  if (parsed.allowed) return;

  await emitCapEvent({
    supabase: params.supabase,
    orgId: params.orgId,
    userId: params.userId,
    bizId: params.bizId,
    planCode: canonicalPlan,
    limit: parsed.limit,
    count: parsed.count,
    requestId: params.requestId,
  });

  throw new GuardrailError('orchestrator_cap_reached', 'orchestrator_cap_reached', {
    resetsAt: parsed.resetsAt,
    limit: parsed.limit,
    count: parsed.count,
    planCode: canonicalPlan,
  });
}
