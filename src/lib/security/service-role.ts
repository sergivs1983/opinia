import { NextResponse } from 'next/server';

/**
 * assertServiceRoleAllowed — runtime guard for admin-client routes.
 *
 * Call as FIRST LINE in any handler that uses getAdminClient():
 *   const blocked = assertServiceRoleAllowed(req);
 *   if (blocked) return blocked;
 *
 * Allowed path prefixes:
 *   /api/webhooks/
 *   /api/jobs/
 *   /api/_internal/
 */
const ALLOWED_PREFIXES = ['/api/webhooks/', '/api/jobs/', '/api/_internal/'];

export function assertServiceRoleAllowed(req: Request): NextResponse | null {
  const { pathname } = new URL(req.url);
  const allowed = ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!allowed) {
    return NextResponse.json(
      { error: 'Service role forbidden', path: pathname },
      { status: 403 }
    );
  }
  return null;
}
