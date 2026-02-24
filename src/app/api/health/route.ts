import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/health
 * PUBLIC — no auth required. Returns service health status.
 */
export async function GET() {
  const start = Date.now();
  const checks: Record<string, 'ok' | 'error'> = {};

  // 1. DB connectivity
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('organizations').select('id').limit(1);
    checks.database = error ? 'error' : 'ok';
  } catch {
    checks.database = 'error';
  }

  // 2. Auth config
  checks.auth = (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) ? 'ok' : 'error';

  // 3. LLM config (at least one provider)
  checks.llm = (
    process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY
  ) ? 'ok' : 'error';

  const allOk = Object.values(checks).every(v => v === 'ok');
  const durationMs = Date.now() - start;

  return NextResponse.json({
    ok: allOk,
    status: allOk ? 'healthy' : 'degraded',
    checks,
    version: process.env.NEXT_PUBLIC_APP_VERSION || '2.0.0-h',
    ts: new Date().toISOString(),
    duration_ms: durationMs,
  }, { status: allOk ? 200 : 503 });
}
