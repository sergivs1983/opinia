/**
 * sentry.server.config.ts — Bloc 9
 *
 * Sentry Node.js SDK initialisation (Next.js server-side: RSC, Route Handlers).
 * Loaded via instrumentation.ts → register() when NEXT_RUNTIME === 'nodejs'.
 *
 * DSN is read from SENTRY_DSN (server-only env var).
 * If DSN is absent the SDK is initialised in a no-op state and drops all events.
 */

import * as Sentry from '@sentry/nextjs';
import { beforeSendPIISafe } from './src/lib/observability/sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',

  // Scrub PII before any event leaves the server.
  beforeSend: beforeSendPIISafe,

  // Don't include default integrations that could capture PII
  // (e.g. Http breadcrumbs may include auth headers).
  integrations: (integrations) =>
    integrations.filter(
      (i) => !['Http', 'OnUncaughtException', 'OnUnhandledRejection'].includes(i.name),
    ),
});
