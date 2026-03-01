import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/logger';
import { trackAsync as trackPosthogAsync } from '@/lib/analytics/posthog-server';

type TelemetryProps = Record<string, unknown>;

export async function trackEvent(params: {
  supabase: SupabaseClient;
  orgId?: string | null;
  userId?: string | null;
  name: string;
  props?: TelemetryProps;
  requestId?: string;
  sendPosthog?: boolean;
}): Promise<void> {
  try {
    if (!params.name || !params.name.trim()) return;

    const eventProps = {
      ...(params.props || {}),
      ...(params.requestId ? { request_id: params.requestId } : {}),
    };

    const { error } = await params.supabase.rpc('insert_telemetry_event', {
      p_org_id: params.orgId || null,
      p_user_id: params.userId || null,
      p_event_name: params.name.trim(),
      p_props: eventProps,
    });

    if (error) {
      log.warn('telemetry_track_failed', {
        event_name: params.name,
        org_id: params.orgId || null,
        user_id: params.userId || null,
        error_code: error.code || null,
      });
    }

    if (params.sendPosthog) {
      trackPosthogAsync({
        event: params.name.trim(),
        distinctId: params.userId || params.orgId || 'unknown',
        props: eventProps,
      });
    }
  } catch (error) {
    log.warn('telemetry_track_unhandled', {
      event_name: params.name,
      org_id: params.orgId || null,
      user_id: params.userId || null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
