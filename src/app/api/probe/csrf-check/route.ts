/**
 * POST /api/probe/csrf-check
 *
 * Used exclusively by scripts/security-csrf-test.sh to verify that the
 * CSRF guard is working correctly at runtime. Not accessible from the UI.
 *
 * Returns:
 *   200  { "ok": true }              — origin is in the allowlist (or Bearer-exempt)
 *   403  { "error": "CSRF blocked" } — origin is blocked
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { validateCsrf } from '@/lib/security/csrf';

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;
  return Response.json({ ok: true });
}
