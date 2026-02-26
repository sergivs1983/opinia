/**
 * sentry.client.config.ts — Bloc 9
 *
 * Sentry browser SDK initialisation.
 * Loaded automatically by @sentry/nextjs webpack plugin on the client bundle.
 *
 * DSN is read from NEXT_PUBLIC_SENTRY_DSN (public var, safe to expose in JS).
 * If DSN is absent the SDK is initialised in a no-op state and drops all events.
 */

import * as Sentry from '@sentry/nextjs';
import { beforeSendPIISafe } from '@/lib/observability/sentry';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN,

  // Capture 10 % of sessions in prod; override via SENTRY_TRACES_SAMPLE_RATE.
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),

  // Only send errors in production; drop silently in dev/staging.
  enabled: process.env.NODE_ENV === 'production',

  // Scrub PII before any event leaves the browser.
  beforeSend: beforeSendPIISafe,

  // Suppress Sentry's own telemetry.
  sendClientReports: false,
});
