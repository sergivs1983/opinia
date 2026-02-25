/**
 * GET /api/limits-probe?limit=<n>
 *
 * Used exclusively by scripts/security-limits-test.sh to verify that
 * query-param limit validation is working at runtime.
 *
 * Returns:
 *   200  { "ok": true, "limit": <n> }  — limit is valid (1–100)
 *   400  { "error": "Invalid query" }  — limit out of range or not an integer
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { parseLimitParam } from '@/lib/security/query-limits';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitResult = parseLimitParam(searchParams, 'limit', 20);
  if (!limitResult.ok) return limitResult.error;
  return NextResponse.json({ ok: true, limit: limitResult.limit });
}
