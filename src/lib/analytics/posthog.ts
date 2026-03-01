import { track } from '@/lib/analytics/posthog-server';

type PosthogCaptureInput = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
};

export async function capturePosthog(input: PosthogCaptureInput): Promise<void> {
  await track({
    event: input.event,
    distinctId: input.distinctId,
    props: {
      ...(input.properties || {}),
      ...(input.timestamp ? { timestamp: input.timestamp } : {}),
    },
  });
}
