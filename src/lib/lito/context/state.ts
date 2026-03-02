import type { SupabaseClient } from '@supabase/supabase-js';

import type { LITOStateContext } from '@/lib/lito/context/types';

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

function startOfWeekMonday(date: Date): Date {
  const copy = new Date(date.getTime());
  const day = copy.getDay();
  const offset = (day + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfWeekMonday(date: Date): Date {
  const start = startOfWeekMonday(date);
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

function safeCount(value: number | null): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export async function loadStateContext(input: {
  admin: SupabaseClient;
  bizId: string;
  now?: Date;
}): Promise<LITOStateContext> {
  const now = input.now || new Date();
  const todayStart = startOfLocalDay(now).toISOString();
  const todayEnd = endOfLocalDay(now).toISOString();
  const weekStart = startOfWeekMonday(now).toISOString();
  const weekEnd = endOfWeekMonday(now).toISOString();
  const since14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [
    dueTodayResult,
    scheduledWeekResult,
    pendingDraftsResult,
    approvedDraftsResult,
    snoozedOrMissedResult,
    published14dResult,
    lastPublishedResult,
  ] = await Promise.all([
    input.admin
      .from('social_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .in('status', ['scheduled', 'notified'])
      .gte('scheduled_at', todayStart)
      .lt('scheduled_at', todayEnd),
    input.admin
      .from('social_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .in('status', ['scheduled', 'notified', 'snoozed'])
      .gte('scheduled_at', weekStart)
      .lt('scheduled_at', weekEnd),
    input.admin
      .from('social_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .eq('status', 'pending'),
    input.admin
      .from('social_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .eq('status', 'approved'),
    input.admin
      .from('social_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .in('status', ['snoozed', 'missed']),
    input.admin
      .from('social_schedules')
      .select('id', { count: 'exact', head: true })
      .eq('biz_id', input.bizId)
      .eq('status', 'published')
      .gte('published_at', since14d),
    input.admin
      .from('social_schedules')
      .select('published_at')
      .eq('biz_id', input.bizId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const errors = [
    dueTodayResult.error,
    scheduledWeekResult.error,
    pendingDraftsResult.error,
    approvedDraftsResult.error,
    snoozedOrMissedResult.error,
    published14dResult.error,
    lastPublishedResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors[0]?.message || 'lito_context_state_query_failed');
  }

  const lastPublishedAt = (lastPublishedResult.data as { published_at?: string | null } | null)?.published_at || null;
  let daysSinceLastPublished: number | null = null;
  if (lastPublishedAt) {
    const parsed = new Date(lastPublishedAt);
    if (!Number.isNaN(parsed.getTime())) {
      daysSinceLastPublished = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }

  return {
    due_today_count: safeCount(dueTodayResult.count),
    scheduled_this_week_count: safeCount(scheduledWeekResult.count),
    pending_drafts_count: safeCount(pendingDraftsResult.count),
    approved_drafts_count: safeCount(approvedDraftsResult.count),
    snoozed_or_missed_count: safeCount(snoozedOrMissedResult.count),
    published_last_14d_count: safeCount(published14dResult.count),
    days_since_last_published: daysSinceLastPublished,
  };
}
