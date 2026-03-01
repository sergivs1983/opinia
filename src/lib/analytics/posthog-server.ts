import { log } from '@/lib/logger';

type TrackInput = {
  event: string;
  props: Record<string, unknown>;
  distinctId: string;
};

function isPosthogEnabled(): boolean {
  const value = (process.env.POSTHOG_ENABLED || 'true').trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'off';
}

function resolvePosthogHost(): string {
  const host = (
    process.env.POSTHOG_HOST
    || process.env.NEXT_PUBLIC_POSTHOG_HOST
    || 'https://eu.i.posthog.com'
  ).trim();
  return host.endsWith('/') ? host.slice(0, -1) : host;
}

function resolvePosthogKey(): string {
  return (
    process.env.POSTHOG_PROJECT_API_KEY
    || process.env.NEXT_PUBLIC_POSTHOG_KEY
    || ''
  ).trim();
}

export async function track(event: string, props: Record<string, unknown>, distinctId: string): Promise<void>;
export async function track(input: TrackInput): Promise<void>;
export async function track(
  eventOrInput: string | TrackInput,
  propsArg?: Record<string, unknown>,
  distinctIdArg?: string,
): Promise<void> {
  try {
    if (!isPosthogEnabled()) return;

    const apiKey = resolvePosthogKey();
    if (!apiKey) return;

    const normalized = typeof eventOrInput === 'string'
      ? {
        event: eventOrInput,
        props: propsArg || {},
        distinctId: distinctIdArg || '',
      }
      : eventOrInput;

    const event = normalized.event.trim();
    const distinctId = normalized.distinctId.trim();
    if (!event || !distinctId) return;

    const payload = {
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: {
        $lib: 'opinia',
        $lib_version: 'd2.8',
        ...(normalized.props || {}),
      },
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
      console.error('posthog_capture_failed', {
        status: response.status,
        event,
      });
      log.warn('posthog_server_track_failed', {
        event,
        http_status: response.status,
      });
    }
  } catch (error) {
    log.warn('posthog_server_track_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
