'use client';

type CaptureClientEventInput = {
  bizId: string;
  event: string;
  mode?: 'basic' | 'advanced';
  properties?: Record<string, unknown>;
};

export async function captureClientEvent(input: CaptureClientEventInput): Promise<void> {
  try {
    if (!input.bizId || !input.event) return;

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
        properties: input.properties || {},
      }),
    });
  } catch {
    // Analytics should never break UX.
  }
}
