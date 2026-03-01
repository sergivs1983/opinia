import { log } from '@/lib/logger';

type TrackInput = {
  event: string;
  props: Record<string, unknown>;
  distinctId: string;
};
const POSTHOG_TIMEOUT_MS = 2500;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${resolvePosthogHost()}/capture/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

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
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error('posthog_capture_failed', {
      status: isTimeout ? 'timeout' : 'error',
      event: typeof eventOrInput === 'string' ? eventOrInput : eventOrInput.event,
    });
    log.warn('posthog_server_track_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function trackAsync(event: string, props: Record<string, unknown>, distinctId: string): void;
export function trackAsync(input: TrackInput): void;
export function trackAsync(
  eventOrInput: string | TrackInput,
  propsArg?: Record<string, unknown>,
  distinctIdArg?: string,
): void {
  if (typeof eventOrInput === 'string') {
    void track(eventOrInput, propsArg || {}, distinctIdArg || '');
    return;
  }
  void track(eventOrInput);
}
