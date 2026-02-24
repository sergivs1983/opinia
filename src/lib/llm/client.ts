/**
 * LLM Client — the SINGLE entry point for all LLM calls in OpinIA.
 *
 * Flow:
 * 1) Check circuit breaker for primary (provider, model)
 * 2) If OPEN → fallback to other provider (if not also OPEN)
 * 3) Execute with 1 retry + 2s backoff
 * 4) On success → recordSuccess, write llm_usage_events, structured log
 * 5) On failure → recordFailure, write llm_usage_events (error), optionally DLQ
 * 6) If both providers OPEN → throw CircuitOpenError → caller returns 503
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { LLMProvider, LLMRequest, LLMResponse } from '@/lib/llm/provider';
import { getDefaultModel } from '@/lib/llm/provider';
import { callOpenAI } from '@/lib/llm/providers/openai';
import { callAnthropic } from '@/lib/llm/providers/anthropic';
import type { JsonObject } from '@/types/json';
import { createRequestId } from '@/lib/logger';
import {
  getCircuitState, recordSuccess, recordFailure,
  isCircuitBreakerError, classifyError,
} from '@/lib/llm/circuitBreaker';

// ============================================================
// COST TABLE — USD per 1M tokens (update as pricing changes)
// ============================================================
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o':                   { input: 2.50, output: 10.00 },
  'gpt-4o-mini':              { input: 0.15, output: 0.60 },
  'gpt-4-turbo':              { input: 10.00, output: 30.00 },
  'gpt-4.1':                  { input: 2.00, output: 8.00 },
  'gpt-4.1-mini':             { input: 0.40, output: 1.60 },
  'gpt-4.1-nano':             { input: 0.10, output: 0.40 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-3-20240307':  { input: 0.25, output: 1.25 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_PER_MILLION[model];
  if (!pricing) return 0;
  return Number(((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000).toFixed(6));
}

// ============================================================
// PUBLIC TYPES
// ============================================================
export interface LLMCallOptions {
  provider: LLMProvider;
  model?: string;
  messages: LLMRequest['messages'];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  // Tracking context (required)
  orgId: string;
  bizId: string;
  requestId: string;
  feature: string;  // 'classify' | 'generate_reply' | 'guardrail' | 'insights'
  userId?: string;
  // DLQ
  critical?: boolean;
  dlqPayload?: JsonObject;
}

export class CircuitOpenError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'CircuitOpenError';
  }
}

// ============================================================
// CONSTANTS
// ============================================================
const RETRY_DELAY_MS = 2_000;
const FALLBACK_MAP: Record<LLMProvider, LLMProvider> = {
  openai: 'anthropic',
  anthropic: 'openai',
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
export async function callLLMClient(opts: LLMCallOptions): Promise<LLMResponse> {
  const primary = opts.provider;
  const primaryModel = opts.model || getDefaultModel(primary, 'main');
  const fallback = FALLBACK_MAP[primary];
  const fallbackModel = getDefaultModel(fallback, 'main');

  // 1) Check primary circuit
  const pCircuit = await getCircuitState(primary, primaryModel).catch(() =>
    ({ state: 'closed' as const, failureCount: 0, openUntil: null })
  );

  if (pCircuit.state === 'open') {
    // Primary OPEN — try fallback
    const fCircuit = await getCircuitState(fallback, fallbackModel).catch(() =>
      ({ state: 'closed' as const, failureCount: 0, openUntil: null })
    );

    if (fCircuit.state === 'open') {
      // Both OPEN
      if (opts.critical) {
        await enqueueDLQ(opts, 'provider_down', `Both ${primary} and ${fallback} circuits open`);
      }
      throw new CircuitOpenError(
        `Both providers unavailable (${primary}/${primaryModel} + ${fallback}/${fallbackModel})`
      );
    }

    // Fallback available
    logInfo(opts, `Primary ${primary} circuit OPEN → falling back to ${fallback}`);
    return await executeWithTracking(opts, fallback, fallbackModel);
  }

  // 2) Primary CLOSED or HALF_OPEN — try primary
  try {
    return await executeWithTracking(opts, primary, primaryModel);
  } catch (primaryErr: unknown) {
    if (!isCircuitBreakerError(primaryErr)) {
      throw primaryErr; // 4xx client error — don't fallback
    }

    // Primary failed with circuit-worthy error — try fallback
    const fCircuit = await getCircuitState(fallback, fallbackModel).catch(() =>
      ({ state: 'closed' as const, failureCount: 0, openUntil: null })
    );

    if (fCircuit.state === 'open') {
      if (opts.critical) {
        await enqueueDLQ(opts, classifyError(primaryErr), getErrorMessage(primaryErr));
      }
      throw primaryErr;
    }

    logInfo(opts, `Primary ${primary} failed → falling back to ${fallback}: ${getErrorMessage(primaryErr).slice(0, 100)}`);

    try {
      return await executeWithTracking(opts, fallback, fallbackModel);
    } catch (fallbackErr: unknown) {
      if (opts.critical) {
        await enqueueDLQ(opts, classifyError(fallbackErr), getErrorMessage(fallbackErr));
      }
      throw fallbackErr;
    }
  }
}

// ============================================================
// EXECUTE — attempt + 1 retry + tracking
// ============================================================
async function executeWithTracking(
  opts: LLMCallOptions,
  provider: LLMProvider,
  model: string,
): Promise<LLMResponse> {
  const startMs = Date.now();
  const callFn = provider === 'anthropic' ? callAnthropic : callOpenAI;
  const req: LLMRequest = {
    provider, model,
    messages: opts.messages,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    json: opts.json,
  };

  try {
    // Attempt 1
    const result = await callFn(req);
    const durationMs = Date.now() - startMs;

    await recordSuccess(provider, model).catch(() => {});
    await trackUsage(opts, provider, model, result, durationMs, 'success');
    logInfo(opts, `LLM success`, { provider, model, durationMs, tokens: result.usage });

    return result;
  } catch (firstErr: unknown) {
    logInfo(opts, `LLM attempt 1 failed (${provider}/${model}): ${getErrorMessage(firstErr).slice(0, 80)}. Retrying...`);

    // Retry once after backoff
    await sleep(RETRY_DELAY_MS);

    try {
      const result = await callFn(req);
      const durationMs = Date.now() - startMs;

      await recordSuccess(provider, model).catch(() => {});
      await trackUsage(opts, provider, model, result, durationMs, 'success');
      logInfo(opts, `LLM retry success`, { provider, model, durationMs, tokens: result.usage });

      return result;
    } catch (retryErr: unknown) {
      const durationMs = Date.now() - startMs;
      const errorCode = classifyError(retryErr);

      if (isCircuitBreakerError(retryErr)) {
        await recordFailure(provider, model).catch(() => {});
      }

      await trackUsage(opts, provider, model, null, durationMs, 'error', errorCode);
      logError(opts, `LLM failed after retry`, {
        provider,
        model,
        durationMs,
        errorCode,
        error: getErrorMessage(retryErr).slice(0, 200),
      });

      throw retryErr;
    }
  }
}

// ============================================================
// COST TRACKING — writes to llm_usage_events
// ============================================================
async function trackUsage(
  opts: LLMCallOptions,
  provider: LLMProvider,
  model: string,
  result: LLMResponse | null,
  durationMs: number,
  status: 'success' | 'error',
  errorCode?: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const inTok = result?.usage?.input_tokens || 0;
    const outTok = result?.usage?.output_tokens || 0;

    await admin.from('llm_usage_events').insert({
      org_id: opts.orgId,
      biz_id: opts.bizId,
      user_id: opts.userId || null,
      request_id: opts.requestId,
      feature: opts.feature,
      provider,
      model,
      prompt_tokens: inTok,
      completion_tokens: outTok,
      total_tokens: inTok + outTok,
      cost_usd: calculateCost(model, inTok, outTok),
      duration_ms: durationMs,
      status,
      error_code: errorCode || null,
    });
  } catch (e: unknown) {
    // Non-blocking — must never break the pipeline
    console.error(JSON.stringify({
      ts: new Date().toISOString(), level: 'error',
      msg: 'Failed to track LLM usage', request_id: opts.requestId, error: getErrorMessage(e),
    }));
  }
}

// ============================================================
// DLQ — enqueue failed critical jobs
// ============================================================
async function enqueueDLQ(
  opts: LLMCallOptions,
  errorCode: string,
  errorMessage?: string,
): Promise<void> {
  const requestId = opts.requestId?.trim() || createRequestId();

  try {
    const admin = createAdminClient();

    await admin.from('failed_jobs').insert({
      org_id: opts.orgId,
      biz_id: opts.bizId,
      job_type: opts.feature,
      payload: {
        ...(opts.dlqPayload || {}),
        messages_length: opts.messages.length,
        provider_attempted: opts.provider,
        model_attempted: opts.model,
        request_id: requestId,
        // NO secrets, NO tokens, NO API keys
      },
      error_code: errorCode,
      error_message: (errorMessage || '').slice(0, 500),
      provider: opts.provider,
      model: opts.model || null,
      status: 'queued',
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    });

    // Audit (non-blocking)
    await admin.from('activity_log').insert({
      org_id: opts.orgId,
      biz_id: opts.bizId,
      user_id: opts.userId || null,
      action: 'dlq_enqueued',
      target_type: opts.feature,
      metadata: { request_id: requestId, error_code: errorCode },
    });
  } catch (e: unknown) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(), level: 'error',
      msg: 'Failed to enqueue DLQ', request_id: requestId, error: getErrorMessage(e),
    }));
  }
}

// ============================================================
// STRUCTURED LOGGING HELPERS
// ============================================================
function logInfo(opts: LLMCallOptions, msg: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level: 'info',
    msg, request_id: opts.requestId, org_id: opts.orgId, biz_id: opts.bizId,
    feature: opts.feature, ...(data || {}),
  }));
}

function logError(opts: LLMCallOptions, msg: string, data?: Record<string, unknown>) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(), level: 'error',
    msg, request_id: opts.requestId, org_id: opts.orgId, biz_id: opts.bizId,
    feature: opts.feature, ...(data || {}),
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
