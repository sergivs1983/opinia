export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireInternalGuard } from '@/lib/internal-guard';
import { createLogger } from '@/lib/logger';
import { sendWebPush } from '@/lib/push/webpush';
import { getRequestIdFromHeaders } from '@/lib/request-id';
import { createAdminClient } from '@/lib/supabase/admin';

const BodySchema = z.object({
  now: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

type ReminderRow = {
  id: string;
  schedule_id: string;
  trigger_at: string;
  kind: 't_minus_24h' | 't_minus_1h' | 't_plus_15m';
  status: 'pending' | 'sent' | 'cancelled';
};

type ScheduleRow = {
  id: string;
  org_id: string;
  biz_id: string;
  draft_id: string;
  assigned_user_id: string;
  platform: 'instagram' | 'tiktok';
  scheduled_at: string;
  status: 'scheduled' | 'notified' | 'published' | 'missed' | 'snoozed' | 'cancelled';
  notified_at: string | null;
};

type DraftRow = {
  id: string;
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  format: 'post' | 'story' | 'reel';
  channel: 'instagram' | 'tiktok' | 'facebook';
};

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  revoked_at: string | null;
};

function isMissingPushSubscriptionsTable(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const message = ((error as { message?: string })?.message || '').toLowerCase();
  return code === '42P01' || message.includes('push_subscriptions') || message.includes('relation');
}

function withNoStore(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('x-request-id', requestId);
  return response;
}

function nowMinus24hIso(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = getRequestIdFromHeaders(request.headers);
  const log = createLogger({ request_id: requestId, route: 'POST /api/_internal/social/reminders/run' });

  const rawBody = await request.text();
  const blocked = requireInternalGuard(request, {
    requestId,
    mode: 'hmac',
    rawBody,
    pathname: '/api/_internal/social/reminders/run',
  });
  if (blocked) {
    return withNoStore(blocked, requestId);
  }

  let parsedBodyRaw: unknown = {};
  if (rawBody.trim().length > 0) {
    try {
      parsedBodyRaw = JSON.parse(rawBody);
    } catch {
      return withNoStore(
        NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body', request_id: requestId }, { status: 400 }),
        requestId,
      );
    }
  }

  const parsed = BodySchema.safeParse(parsedBodyRaw);
  if (!parsed.success) {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: parsed.error.issues[0]?.message || 'Invalid request', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const payload = parsed.data;
  const now = payload.now ? new Date(payload.now) : new Date();
  if (Number.isNaN(now.getTime())) {
    return withNoStore(
      NextResponse.json({ error: 'bad_request', message: 'Invalid now timestamp', request_id: requestId }, { status: 400 }),
      requestId,
    );
  }

  const nowIso = now.toISOString();
  const admin = createAdminClient();

  try {
    let missed = 0;
    let sent = 0;
    let cancelled = 0;
    let notified = 0;
    let pushSent = 0;
    let pushFailed = 0;
    let pushSkipped = 0;
    let pushFeatureUnavailableLogged = false;
    let pushTableMissingLogged = false;

    const missedBeforeIso = nowMinus24hIso(now);
    const { data: missedSchedules } = await admin
      .from('social_schedules')
      .update({ status: 'missed', updated_at: nowIso })
      .in('status', ['scheduled', 'notified', 'snoozed'])
      .lt('scheduled_at', missedBeforeIso)
      .select('id');

    if (missedSchedules && missedSchedules.length > 0) {
      missed = missedSchedules.length;
      const missedIds = missedSchedules.map((item) => item.id);
      await admin
        .from('social_reminders_queue')
        .update({ status: 'cancelled' })
        .in('schedule_id', missedIds)
        .eq('status', 'pending');
    }

    const { data: remindersData, error: remindersError } = await admin
      .from('social_reminders_queue')
      .select('id, schedule_id, trigger_at, kind, status')
      .eq('status', 'pending')
      .lte('trigger_at', nowIso)
      .order('trigger_at', { ascending: true })
      .limit(payload.limit ?? 250);

    if (remindersError) {
      log.error('social_reminders_fetch_failed', {
        error_code: remindersError.code || null,
        error: remindersError.message || null,
      });
      return withNoStore(
        NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
        requestId,
      );
    }

    const reminders = (remindersData || []) as ReminderRow[];
    if (reminders.length === 0) {
      return withNoStore(
        NextResponse.json({ ok: true, processed: 0, sent: 0, cancelled: 0, missed, notified: 0, request_id: requestId }),
        requestId,
      );
    }

    const scheduleIds = Array.from(new Set(reminders.map((item) => item.schedule_id)));
    const { data: schedulesData } = await admin
      .from('social_schedules')
      .select('id, org_id, biz_id, draft_id, assigned_user_id, platform, scheduled_at, status, notified_at')
      .in('id', scheduleIds);

    const schedules = (schedulesData || []) as ScheduleRow[];
    const schedulesMap = new Map<string, ScheduleRow>();
    for (const schedule of schedules) schedulesMap.set(schedule.id, schedule);

    const draftIds = Array.from(new Set(schedules.map((item) => item.draft_id)));
    const { data: draftsData } = await admin
      .from('social_drafts')
      .select('id, title, copy_short, copy_long, format, channel')
      .in('id', draftIds);

    const draftsMap = new Map<string, DraftRow>();
    for (const draft of (draftsData || []) as DraftRow[]) draftsMap.set(draft.id, draft);
    const subscriptionsCache = new Map<string, PushSubscriptionRow[]>();

    for (const reminder of reminders) {
      const schedule = schedulesMap.get(reminder.schedule_id);
      if (!schedule || schedule.status === 'cancelled' || schedule.status === 'published' || schedule.status === 'missed') {
        await admin
          .from('social_reminders_queue')
          .update({ status: 'cancelled' })
          .eq('id', reminder.id)
          .eq('status', 'pending');
        cancelled += 1;
        continue;
      }

      const { data: claimedReminder } = await admin
        .from('social_reminders_queue')
        .update({ status: 'sent', sent_at: nowIso })
        .eq('id', reminder.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!claimedReminder) {
        continue;
      }

      const draft = draftsMap.get(schedule.draft_id);
      const draftTitle = draft?.title || 'Publicació programada';
      const platformLabel = schedule.platform === 'instagram' ? 'Instagram' : 'TikTok';
      const ctaUrl = `/dashboard/planner?biz_id=${schedule.biz_id}&schedule_id=${schedule.id}`;
      await admin.from('in_app_notifications').insert({
        org_id: schedule.org_id,
        biz_id: schedule.biz_id,
        user_id: schedule.assigned_user_id,
        type: 'social_reminder',
        payload: {
          title: 'Recordatori de publicació',
          body: `${draftTitle} · ${platformLabel}`,
          cta_url: ctaUrl,
          schedule_id: schedule.id,
          biz_id: schedule.biz_id,
          platform: schedule.platform,
          draft_id: schedule.draft_id,
          kind: reminder.kind,
          scheduled_at: schedule.scheduled_at,
          draft_title: draft?.title || null,
          draft_format: draft?.format || null,
        },
      });

      const subscriptionsKey = `${schedule.biz_id}:${schedule.assigned_user_id}`;
      let subscriptions = subscriptionsCache.get(subscriptionsKey);
      if (!subscriptions) {
        const { data: subscriptionsData, error: subscriptionsError } = await admin
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth, revoked_at')
          .eq('org_id', schedule.org_id)
          .eq('biz_id', schedule.biz_id)
          .eq('user_id', schedule.assigned_user_id)
          .is('revoked_at', null);

        if (subscriptionsError) {
          if (isMissingPushSubscriptionsTable(subscriptionsError)) {
            if (!pushTableMissingLogged) {
              log.warn('social_reminders_push_table_missing', {
                error_code: subscriptionsError.code || null,
                error: subscriptionsError.message || null,
              });
              pushTableMissingLogged = true;
            }
          } else {
            log.warn('social_reminders_push_subscriptions_fetch_failed', {
              error_code: subscriptionsError.code || null,
              error: subscriptionsError.message || null,
              schedule_id: schedule.id,
            });
          }
          subscriptions = [];
        } else {
          subscriptions = (subscriptionsData || []) as PushSubscriptionRow[];
        }

        subscriptionsCache.set(subscriptionsKey, subscriptions);
      }

      if (subscriptions.length > 0) {
        const pushPayload = {
          title: 'Recordatori de publicació',
          body: `${draftTitle} · ${platformLabel}`,
          url: ctaUrl,
          schedule_id: schedule.id,
          biz_id: schedule.biz_id,
          platform: schedule.platform,
        } as const;

        for (const subscription of subscriptions) {
          const pushResult = await sendWebPush({
            subscription: {
              id: subscription.id,
              endpoint: subscription.endpoint,
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
            payload: pushPayload,
          });

          if (pushResult.ok) {
            pushSent += 1;
            continue;
          }

          if (pushResult.providerUnavailable) {
            pushSkipped += 1;
            if (!pushFeatureUnavailableLogged) {
              log.warn('social_reminders_push_unavailable', { reason: pushResult.reason || null });
              pushFeatureUnavailableLogged = true;
            }
            continue;
          }

          if (pushResult.expired) {
            await admin
              .from('push_subscriptions')
              .update({ revoked_at: nowIso })
              .eq('id', subscription.id)
              .is('revoked_at', null);
            pushSkipped += 1;
            continue;
          }

          pushFailed += 1;
          log.warn('social_reminders_push_send_failed', {
            schedule_id: schedule.id,
            subscription_id: subscription.id,
            status: pushResult.status || null,
            reason: pushResult.reason || null,
          });
        }
      }

      if (schedule.status === 'scheduled' || schedule.status === 'snoozed') {
        const { data: updatedNotified } = await admin
          .from('social_schedules')
          .update({
            status: 'notified',
            notified_at: schedule.notified_at || nowIso,
            updated_at: nowIso,
          })
          .eq('id', schedule.id)
          .in('status', ['scheduled', 'snoozed'])
          .select('id')
          .maybeSingle();

        if (updatedNotified) {
          notified += 1;
          schedule.status = 'notified';
          schedule.notified_at = schedule.notified_at || nowIso;
        }
      }

      sent += 1;
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        processed: reminders.length,
        sent,
        cancelled,
        missed,
        notified,
        push_sent: pushSent,
        push_failed: pushFailed,
        push_skipped: pushSkipped,
        request_id: requestId,
      }),
      requestId,
    );
  } catch (error) {
    log.error('social_reminders_runner_unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return withNoStore(
      NextResponse.json({ error: 'internal', message: 'Error intern del servidor', request_id: requestId }, { status: 500 }),
      requestId,
    );
  }
}
