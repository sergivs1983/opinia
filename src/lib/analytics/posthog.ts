import { log } from '@/lib/logger';

type PosthogCaptureInput = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

function posthogEnabled(): boolean {
  const value = (process.env.POSTHOG_ENABLED || 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}

function resolvePosthogHost(): string {
  const host = (process.env.POSTHOG_HOST || 'https://eu.i.posthog.com').trim();
  return host.endsWith('/') ? host.slice(0, -1) : host;
}

export async function capturePosthog(input: PosthogCaptureInput): Promise<void> {
  try {
    if (!posthogEnabled()) return;

    const apiKey = process.env.POSTHOG_PROJECT_API_KEY;
    if (!apiKey) return;

    const event = input.event.trim();
    if (!event) return;

    const distinctId = input.distinctId.trim();
    if (!distinctId) return;

    const payload = {
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: {
        ...(input.properties || {}),
      },
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    };

    const response = await fetch(`${resolvePosthogHost()}/capture/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (!response.ok) {
      log.warn('posthog_capture_failed', {
        event,
        http_status: response.status,
      });
    }
  } catch (error) {
    log.warn('posthog_capture_unhandled', {
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
