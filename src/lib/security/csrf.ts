/**
 * csrf.ts — CSRF origin validation for authenticated API Route Handlers.
 *
 * Usage (first line of every browser-session POST/PATCH/DELETE handler):
 *   const blocked = validateCsrf(request); if (blocked) return blocked;
 *
 * Exemptions (returns null — no blocking):
 *   • Requests that carry `Authorization: Bearer …` are API/server-to-server
 *     calls (not browser sessions) and are already protected by the token.
 *   • Webhooks are excluded at the call-site (never call this from webhook handlers).
 *
 * Origin resolution order:
 *   1. `Origin` header  (present in all same-origin & cross-origin browser fetches)
 *   2. `Referer` header (fallback for older browsers / some redirects)
 *
 * If neither header is present the request is rejected (403) — a legitimate
 * browser fetch always sends at least one of them for non-safe methods.
 *
 * Allowed origins are read from the `ALLOWED_ORIGINS` env variable at
 * request time (comma-separated, no trailing slashes):
 *   ALLOWED_ORIGINS="http://localhost:3000,https://opinia.cat,https://www.opinia.cat"
 */

const CSRF_403 = new Response(
  JSON.stringify({ error: 'CSRF blocked' }),
  {
    status: 403,
    headers: { 'content-type': 'application/json' },
  },
);

function getAllowedOrigins(): Set<string> {
  const raw =
    process.env.ALLOWED_ORIGINS ??
    'http://localhost:3000,https://opinia.cat,https://www.opinia.cat';
  return new Set(
    raw
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
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
  if (/^bearer\s+\S/i.test(auth)) return null;

  // ── Resolve origin ────────────────────────────────────────────────────────
  const origin = req.headers.get('origin');
  let candidate: string | null = null;

  if (origin) {
    candidate = origin.trim().replace(/\/$/, '');
  } else {
    // Fallback: extract origin from Referer
    const referer = req.headers.get('referer');
    if (referer) {
      try {
        const url = new URL(referer);
        candidate = `${url.protocol}//${url.host}`;
      } catch {
        // malformed Referer → treat as missing
      }
    }
  }

  // ── No origin / referer → block ───────────────────────────────────────────
  if (!candidate) return CSRF_403;

  // ── Check against allowlist ───────────────────────────────────────────────
  const allowed = getAllowedOrigins();
  if (!allowed.has(candidate)) return CSRF_403;

  return null;
}
