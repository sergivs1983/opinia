/**
 * src/lib/security/ratelimit.ts — Bloc 8
 *
 * Edge-compatible rate limiting + AI daily quota.
 *
 * Storage strategy:
 *   - PRODUCTION  : Upstash Redis (persistent, multi-region)
 *   - DEV / TEST  : In-process sliding window (Map-based, single-process)
 *
 * Key derivation (NEVER IP-only):
 *   - Authenticated routes : `${bizId}:${userId}`
 *   - Probe endpoints      : caller-supplied key
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

// ─── Redis client ─────────────────────────────────────────────────────────────

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// ─── In-memory fallback (dev/test, single-process) ───────────────────────────
//
// Stored on `globalThis` so that Next.js HMR (hot module replacement) in dev
// does NOT reset the counters when route files are recompiled.  This makes the
// in-process fallback behave consistently across module reloads during testing.

interface MemBucket {
  timestamps: number[];   // ms timestamps of requests within the window
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g.__opinia_rl_store) g.__opinia_rl_store = new Map<string, MemBucket>();
if (!g.__opinia_quota_store) g.__opinia_quota_store = new Map<string, number>();

const memRateLimitStore: Map<string, MemBucket> = g.__opinia_rl_store;
const memQuotaStore: Map<string, number> = g.__opinia_quota_store;

/** Sliding window rate limiter in memory. Returns { success, remaining, resetMs }. */
function memSlidingWindow(
  key: string,
  maxRequests: number,
  windowMs: number,
): { success: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const bucket = memRateLimitStore.get(key) ?? { timestamps: [] };

  // Drop expired entries
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
  bucket.timestamps.push(now);
  memRateLimitStore.set(key, bucket);

  const count = bucket.timestamps.length;
  const success = count <= maxRequests;
  const remaining = Math.max(0, maxRequests - count);
  const oldest = bucket.timestamps[0] ?? now;
  const resetMs = oldest + windowMs;

  return { success, remaining, resetMs };
}

// ─── Ratelimit instances (lazy, Redis-backed) ─────────────────────────────────

let _standardLimiter: Ratelimit | null = null;
let _aiLimiter: Ratelimit | null = null;

function getStandardLimiter(redis: Redis): Ratelimit {
  if (!_standardLimiter) {
    _standardLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(300, '60 s'),
      prefix: 'opinia:rl:std',
      analytics: false,
    });
  }
  return _standardLimiter;
}

function getAILimiter(redis: Redis): Ratelimit {
  if (!_aiLimiter) {
    _aiLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '60 s'),
      prefix: 'opinia:rl:ai',
      analytics: false,
    });
  }
  return _aiLimiter;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rateLimitResponse(limit: number, remaining: number, resetMs: number): NextResponse {
  const res = NextResponse.json(
    { error: 'Rate limit exceeded' },
    { status: 429 },
  );
  res.headers.set('X-RateLimit-Limit', String(limit));
  res.headers.set('X-RateLimit-Remaining', String(remaining));
  res.headers.set('X-RateLimit-Reset', String(Math.floor(resetMs / 1000)));
  res.headers.set('Retry-After', String(Math.max(1, Math.ceil((resetMs - Date.now()) / 1000))));
  return res;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function secondsUntilEndOfDayUTC(): number {
  const now = new Date();
  const eod = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.ceil((eod.getTime() - now.getTime()) / 1000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * rateLimitStandard — 300 req / 60 s sliding window.
 *
 * Key MUST be `${bizId}:${userId}` for authenticated routes.
 * Returns { ok: true } when allowed, { ok: false, res } when blocked (429).
 */
export async function rateLimitStandard(
  key: string,
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const redis = getRedis();

  if (redis) {
    const limiter = getStandardLimiter(redis);
    const { success, limit, remaining, reset } = await limiter.limit(key);
    if (success) return { ok: true };
    return { ok: false, res: rateLimitResponse(limit, remaining, reset) };
  }

  // In-memory fallback (dev / test)
  const { success, remaining, resetMs } = memSlidingWindow(key, 300, 60_000);
  if (success) return { ok: true };
  return { ok: false, res: rateLimitResponse(300, remaining, resetMs) };
}

/**
 * rateLimitAI — 20 req / 60 s sliding window.
 *
 * Key MUST be `${bizId}:${userId}` for authenticated routes.
 * Returns { ok: true } when allowed, { ok: false, res } when blocked (429).
 */
export async function rateLimitAI(
  key: string,
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const redis = getRedis();

  if (redis) {
    const limiter = getAILimiter(redis);
    const { success, limit, remaining, reset } = await limiter.limit(key);
    if (success) return { ok: true };
    return { ok: false, res: rateLimitResponse(limit, remaining, reset) };
  }

  // In-memory fallback (dev / test)
  const { success, remaining, resetMs } = memSlidingWindow(key, 20, 60_000);
  if (success) return { ok: true };
  return { ok: false, res: rateLimitResponse(20, remaining, resetMs) };
}

/**
 * checkDailyAIQuota — Atomic daily quota via Redis INCR + TTL 86400.
 *
 * Key: `ai_daily:<bizId>:<YYYY-MM-DD>` (UTC)
 * Falls back to in-process Map when Redis is not configured.
 *
 * @param bizId         Business UUID (or test identifier)
 * @param plan          Organisation plan: 'free' | 'pro' | 'enterprise'
 * @param overrideLimit Dev-only override for the quota (used by probe)
 */
export async function checkDailyAIQuota(
  bizId: string,
  plan: 'free' | 'pro' | 'enterprise',
  overrideLimit?: number,
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const quotaMap: Record<string, number> = {
    free: parseInt(process.env.AI_DAILY_QUOTA_CALLS_FREE ?? '50', 10),
    pro: parseInt(process.env.AI_DAILY_QUOTA_CALLS_PRO ?? '1000', 10),
    enterprise: parseInt(process.env.AI_DAILY_QUOTA_CALLS_ENTERPRISE ?? '10000', 10),
  };
  const limit = overrideLimit ?? quotaMap[plan] ?? 50;
  const key = `ai_daily:${bizId}:${todayUTC()}`;
  const ttl = 86400; // 1 day

  const redis = getRedis();
  let count: number;

  if (redis) {
    // Atomic: INCR then set TTL on first call
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttl);
    }
  } else {
    // In-memory fallback (dev / test)
    count = (memQuotaStore.get(key) ?? 0) + 1;
    memQuotaStore.set(key, count);
  }

  if (count > limit) {
    const retryAfter = secondsUntilEndOfDayUTC();
    const res = NextResponse.json(
      { error: 'Daily quota exceeded' },
      { status: 429 },
    );
    res.headers.set('Retry-After', String(retryAfter));
    res.headers.set('X-RateLimit-Limit', String(limit));
    res.headers.set('X-RateLimit-Remaining', '0');
    return { ok: false, res };
  }

  return { ok: true };
}

/**
 * resolvePlan — Maps an org plan string to the canonical quota plan key.
 * Defaults to 'free' for unknown/null values.
 */
export function resolvePlan(rawPlan: string | null | undefined): 'free' | 'pro' | 'enterprise' {
  if (!rawPlan) return 'free';
  const lc = rawPlan.toLowerCase();
  if (lc.includes('enterprise')) return 'enterprise';
  if (lc.includes('pro')) return 'pro';
  return 'free';
}
