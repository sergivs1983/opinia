import crypto from 'crypto';

export const REPLY_STATUSES = ['draft', 'selected', 'published', 'archived'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

export const PUBLISH_JOB_STATUSES = ['queued', 'running', 'success', 'failed', 'queued_retry'] as const;
export type PublishJobStatus = (typeof PUBLISH_JOB_STATUSES)[number];

const ACTIVE_PUBLISH_JOB_STATUSES = new Set<PublishJobStatus>(['queued', 'running', 'queued_retry']);

function parseStatus<T extends readonly string[]>(input: unknown, allowed: T): T[number] | null {
  if (typeof input !== 'string') return null;
  const normalized = input.trim();
  if (!normalized) return null;
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T[number]) : null;
}

export function parseReplyStatus(input: unknown): ReplyStatus | null {
  return parseStatus(input, REPLY_STATUSES);
}

export function parsePublishJobStatus(input: unknown): PublishJobStatus | null {
  return parseStatus(input, PUBLISH_JOB_STATUSES);
}

export function isActivePublishJobStatus(input: unknown): input is PublishJobStatus {
  const parsed = parsePublishJobStatus(input);
  return parsed !== null && ACTIVE_PUBLISH_JOB_STATUSES.has(parsed);
}

export function normalizeReplyContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}

function redactSensitiveErrorTokens(detail: string): string {
  let sanitized = detail;

  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/(\"?(?:access_token|refresh_token)\"?\s*[:=]\s*\")([^\"\s,;]+)(\")/gi, '$1[REDACTED]$3');
  sanitized = sanitized.replace(/(\b(?:access_token|refresh_token)\b\s*[:=]\s*)([^\s,;]+)/gi, '$1[REDACTED]');

  return sanitized;
}

export function sanitizePublishErrorDetail(detail: unknown, maxLength = 300): string | null {
  if (typeof detail !== 'string') return null;
  const normalized = redactSensitiveErrorTokens(detail).replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, Math.max(1, maxLength));
}

export function truncatePublishErrorDetail(detail: unknown, maxLength = 300): string | null {
  return sanitizePublishErrorDetail(detail, maxLength);
}

export function buildReplyPublishIdempotencyKey(input: {
  replyId: string;
  updatedAtIso: string;
}): string {
  return `reply:${input.replyId}:${input.updatedAtIso}`;
}

export function buildDraftExecutionPublishIdempotencyKey(input: {
  draftId: string;
  reviewId: string;
  replyContent: string;
}): string {
  return crypto
    .createHash('sha256')
    .update(`${input.draftId}:${input.reviewId}:${input.replyContent}`)
    .digest('hex');
}
