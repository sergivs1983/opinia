/**
 * sentry.edge.config.ts — Bloc 9
 *
 * Sentry Edge SDK initialisation (Next.js Middleware + Edge Route Handlers).
 * Loaded via instrumentation.ts → register() when NEXT_RUNTIME === 'edge'.
 *
 * DSN is read from SENTRY_DSN (available in Vercel Edge Functions env).
 */

import * as Sentry from '@sentry/nextjs';
import { beforeSendPIISafe } from './src/lib/observability/sentry';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

  // Only send errors in production.
  enabled: process.env.NODE_ENV === 'production',

  // Scrub PII before any event leaves the edge runtime.
  beforeSend: beforeSendPIISafe,
});
