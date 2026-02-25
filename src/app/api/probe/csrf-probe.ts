/**
 * POST /api/_security/csrf-probe
 *
 * Used exclusively by scripts/security-csrf-test.sh to verify that the
 * CSRF guard is working. Not accessible from the browser UI.
 *
 * Returns:
 *   200  { "ok": true }          — origin allowed (or Bearer-exempt)
 *   403  { "error": "CSRF blocked" } — origin blocked
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { validateCsrf } from '@/lib/security/csrf';

export async function POST(request: Request) {
  const blocked = validateCsrf(request); if (blocked) return blocked;
  return Response.json({ ok: true });
}
