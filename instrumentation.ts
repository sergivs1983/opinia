/**
 * instrumentation.ts — Bloc 9
 *
 * Next.js Instrumentation hook — runs once at server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Loads the correct Sentry config for the current runtime:
 *   - 'nodejs' → sentry.server.config.ts (Route Handlers, RSC)
 *   - 'edge'   → sentry.edge.config.ts   (Middleware, Edge Routes)
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  // Hotfix: avoid loading Edge Sentry bundle from instrumentation because
  // it pulls Node-oriented code paths that crash middleware on Vercel Edge
  // with "__dirname is not defined". Keep middleware runtime stable.
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }
}
