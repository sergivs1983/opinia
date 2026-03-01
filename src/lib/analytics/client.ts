'use client';

type CaptureClientEventInput = {
  bizId: string;
  event: string;
  mode?: 'basic' | 'advanced';
  properties?: Record<string, unknown>;
};

const SESSION_ID_STORAGE_KEY = 'opinia.analytics.session_id';

function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing) return existing;
    const created = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(SESSION_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export async function captureClientEvent(input: CaptureClientEventInput): Promise<void> {
  try {
    if (!input.bizId || !input.event) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const sessionId = getSessionId();

    await fetch('/api/analytics/capture', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify({
        biz_id: input.bizId,
        event: input.event,
        mode: input.mode || 'basic',
        properties: {
          ...(input.properties || {}),
          timezone,
          session_id: sessionId,
        },
      }),
    });
  } catch {
    // Analytics should never break UX.
  }
}
