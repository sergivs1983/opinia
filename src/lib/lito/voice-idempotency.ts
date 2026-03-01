import crypto from 'node:crypto';

import type { LitoVoiceActionKind } from '@/lib/lito/voice';

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeFingerprintValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return compactText(value).toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => normalizeFingerprintValue(item));
  if (typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, normalizeFingerprintValue(nested)] as const);
    return Object.fromEntries(sortedEntries);
  }
  return String(value);
}

export function getVoiceDayBucket(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function buildVoiceIdempotencyKey(params: {
  userId: string;
  bizId: string;
  threadId?: string | null;
  transcriptText: string;
  dayBucket?: string;
}): string {
  const source = [
    params.userId,
    params.bizId,
    params.threadId || 'no-thread',
    compactText(params.transcriptText).toLowerCase(),
    params.dayBucket || getVoiceDayBucket(),
  ].join('|');
  return crypto.createHash('sha256').update(source).digest('hex');
}

export function buildVoiceDraftIdempotencyKey(params: {
  clipIdempotencyKey: string;
  kind: LitoVoiceActionKind;
}): string {
  return crypto.createHash('sha256').update(`${params.clipIdempotencyKey}|${params.kind}`).digest('hex');
}

export function buildVoiceDraftFingerprint(params: {
  bizId: string;
  kind: LitoVoiceActionKind;
  payload: Record<string, unknown>;
}): string {
  const normalizedPayload = normalizeFingerprintValue(params.payload);
  const payloadJson = JSON.stringify(normalizedPayload);
  const source = `${params.bizId}|${params.kind}|${payloadJson}`;
  return crypto.createHash('sha256').update(source).digest('hex');
}
