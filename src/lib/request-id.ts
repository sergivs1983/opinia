/**
 * Extract or generate a request-id from request/response headers.
 * Use in Server Components and Route Handlers to correlate logs.
 */
export function getRequestIdFromHeaders(h: Headers): string {
  return h.get('x-request-id') ?? crypto.randomUUID();
}
