/**
 * csrf.ts — CSRF origin validation for authenticated API Route Handlers.
 *
 * Usage (first line of every browser-session POST/PATCH/DELETE handler):
 *   const blocked = validateCsrf(request); if (blocked) return blocked;
 *
 * Exemptions (returns null — no blocking):
 *   • Requests with `Authorization: Bearer …` are API/server-to-server
 *     calls (not browser sessions) and are already protected by the token.
 *   • Webhooks are excluded at the call-site (never call this from webhook handlers).
 *
 * Origin resolution:
 *   1. `Origin` header  (present in all browser fetches for non-safe methods)
 *   2. `Referer` header (fallback; origin is extracted via new URL(referer).origin)
 *   If neither is present → 403.
 *
 * Allowed origins come from the `ALLOWED_ORIGINS` env variable
 * (comma-separated scheme+host strings, no trailing slashes):
 *   ALLOWED_ORIGINS="http://localhost:3000,https://opinia.cat,https://www.opinia.cat"
 *
 * Matching is EXACT — no startsWith, no substring, no wildcards.
 */

function csrf403(): Response {
  return new Response(
    JSON.stringify({ error: 'CSRF blocked' }),
    {
      status: 403,
      headers: { 'content-type': 'application/json' },
    },
  );
}

/**
 * Validates the CSRF origin for a mutating request.
 *
 * @returns `null`      — request is allowed (caller should proceed)
 * @returns `Response`  — 403 blocked (caller must `return` this immediately)
 */
export function validateCsrf(req: Request): Response | null {
  // ── Bearer-token requests are not browser-session calls → exempt ──────────
  const auth = req.headers.get('authorization') ?? '';
  if (auth.startsWith('Bearer ')) return null;

  // ── Resolve source header ─────────────────────────────────────────────────
  const origin  = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const source  = origin ?? referer;

  if (!source) return csrf403();

  // ── Extract origin (scheme + host) ───────────────────────────────────────
  let requestOrigin: string;
  try {
    requestOrigin = new URL(source).origin;
  } catch {
    // malformed header → block
    return csrf403();
  }

  // ── Exact match against allowlist ─────────────────────────────────────────
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!allowedOrigins.includes(requestOrigin)) return csrf403();

  return null;
}
