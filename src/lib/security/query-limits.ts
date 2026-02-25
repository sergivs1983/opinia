/**
 * query-limits.ts — Zod-based validation for pagination query params.
 *
 * Prevents DoS via overfetch (limit=999999, page=99999, etc.).
 *
 * Usage (GET handler):
 *   const limitResult = parseLimitParam(new URL(request.url).searchParams);
 *   if (!limitResult.ok) return limitResult.error;
 *   const { limit } = limitResult;  // safe, 1–100
 *
 * Rules:
 *   limit / perPage / size / take : int, 1 ≤ n ≤ 100  (default 20)
 *   page                          : int, 1 ≤ n ≤ 1000 (default 1)
 *
 * On failure: 400 JSON { "error": "Invalid query" }  (no further details
 * exposed to the client, following the principle of minimal disclosure).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

// ── Shared error response ─────────────────────────────────────────────────────

function invalidQuery(): NextResponse {
  return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
}

// ── Schemas ───────────────────────────────────────────────────────────────────

/** int, 1 ≤ n ≤ 100 */
const limitSchema = z.coerce.number().int().min(1).max(100);

/** int, 1 ≤ n ≤ 1000 */
const pageSchema = z.coerce.number().int().min(1).max(1000);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse and validate a `limit` (or similar) query param.
 *
 * @param searchParams - URLSearchParams from the request URL
 * @param key         - query param name (default: "limit")
 * @param defaultVal  - value to use when param is absent (default: 20)
 */
export function parseLimitParam(
  searchParams: URLSearchParams,
  key = 'limit',
  defaultVal = 20,
): { ok: true; limit: number } | { ok: false; error: NextResponse } {
  const raw = searchParams.get(key);
  if (raw === null) return { ok: true, limit: defaultVal };

  const result = limitSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: invalidQuery() };

  return { ok: true, limit: result.data };
}

/**
 * Parse and validate a `page` query param.
 *
 * @param searchParams - URLSearchParams from the request URL
 * @param defaultVal  - value to use when param is absent (default: 1)
 */
export function parsePageParam(
  searchParams: URLSearchParams,
  defaultVal = 1,
): { ok: true; page: number } | { ok: false; error: NextResponse } {
  const raw = searchParams.get('page');
  if (raw === null) return { ok: true, page: defaultVal };

  const result = pageSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: invalidQuery() };

  return { ok: true, page: result.data };
}
