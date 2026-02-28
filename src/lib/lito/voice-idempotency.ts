import crypto from 'node:crypto';

import type { LitoVoiceActionKind } from '@/lib/lito/voice';

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
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
