import type { CanonicalPlanCode } from '@/lib/billing/entitlements';

export type GuardrailErrorCode = 'rate_limited' | 'orchestrator_cap_reached';

export type GuardrailErrorMeta = {
  retryAfter?: number;
  resetsAt?: string;
  limit?: number;
  count?: number;
  scope?: 'org' | 'user';
  key?: string;
  planCode?: CanonicalPlanCode;
};

export class GuardrailError extends Error {
  readonly code: GuardrailErrorCode;
  readonly meta: GuardrailErrorMeta;

  constructor(code: GuardrailErrorCode, message: string, meta: GuardrailErrorMeta = {}) {
    super(message);
    this.name = 'GuardrailError';
    this.code = code;
    this.meta = meta;
  }
}

export function isGuardrailError(error: unknown): error is GuardrailError {
  return error instanceof GuardrailError;
}
