'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useLocale, useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';
import { toLocalDateTimeInputValue } from '@/lib/social/schedules';
import { getIkeaChecklist } from '@/lib/recommendations/howto';
import { captureClientEvent } from '@/lib/analytics/client';

type ViewerRole = 'owner' | 'manager' | 'staff';

type SocialDraftItem = {
  id: string;
  recommendation_id?: string | null;
  title: string | null;
  copy_short: string | null;
  copy_long: string | null;
  hashtags: string[] | null;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'published';
  format: 'post' | 'story' | 'reel';
  channel: 'instagram' | 'tiktok' | 'facebook';
};

type TeamMember = {
  id: string;
  user_id: string;
  role: string;
  full_name: string | null;
  invited_email: string | null;
  accepted_at: string | null;
};

type SocialScheduleItem = {
  id: string;
  org_id: string;
  biz_id: string;
  draft_id: string;
  assigned_user_id: string;
  platform: 'instagram' | 'tiktok';
  scheduled_at: string;
  status: 'scheduled' | 'notified' | 'published' | 'missed' | 'snoozed' | 'cancelled';
  notified_at: string | null;
  published_at: string | null;
  snoozed_from: string | null;
  created_at: string;
  updated_at: string;
  draft?: SocialDraftItem | null;
};

type SchedulesListPayload = {
  ok?: boolean;
  items?: SocialScheduleItem[];
  viewer_role?: ViewerRole;
  error?: string;
  message?: string;
};

type SocialDraftListPayload = {
  ok?: boolean;
  items?: SocialDraftItem[];
};

type TeamPayload = {
  members?: TeamMember[];
};

type ScheduleMutatePayload = {
  ok?: boolean;
  schedule?: SocialScheduleItem;
  error?: string;
  message?: string;
};

type WeeklySocialStatsPayload = {
  ok?: boolean;
  published_count?: number;
  goal?: number;
  remaining?: number;
  is_completed?: boolean;
  error?: string;
  message?: string;
};

type PushStatusPayload = {
  ok?: boolean;
  subscribed?: boolean;
  push_enabled?: boolean;
  vapid_public_key?: string | null;
  error?: string;
  message?: string;
};

const SCHEDULED_STATUSES = new Set(['scheduled', 'notified', 'snoozed']);

function formatDateLabel(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const resolvedLocale = locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : 'ca-ES';
  return date.toLocaleString(resolvedLocale, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeLabel(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  const resolvedLocale = locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : 'ca-ES';
  return date.toLocaleTimeString(resolvedLocale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDayLabel(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const resolvedLocale = locale === 'en' ? 'en-GB' : locale === 'es' ? 'es-ES' : 'ca-ES';
  return date.toLocaleDateString(resolvedLocale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function platformUrl(platform: 'instagram' | 'tiktok'): string {
  return platform === 'instagram' ? 'https://www.instagram.com/' : 'https://www.tiktok.com/';
}

function normalizeScheduleCopy(draft: SocialDraftItem | null | undefined): string {
  if (!draft) return '';
  const parts: string[] = [];
  if (draft.title) parts.push(draft.title);
  if (draft.copy_long) parts.push(draft.copy_long);
  else if (draft.copy_short) parts.push(draft.copy_short);
  if (Array.isArray(draft.hashtags) && draft.hashtags.length > 0) {
    parts.push(draft.hashtags.join(' '));
  }
  return parts.join('\n\n').trim();
}

function normalizeExecutionCopy(draft: SocialDraftItem | null | undefined, ikeaCopyText: string): string {
  const draftText = normalizeScheduleCopy(draft);
  if (!draftText) return ikeaCopyText;
  return `${draftText}\n\n---\n\n${ikeaCopyText}`.trim();
}

function defaultScheduledAt(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return toLocalDateTimeInputValue(date.toISOString());
}

function browserSupportsPush(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToBufferSource(base64Url: string): ArrayBuffer {
  const normalized = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : `${normalized}${'='.repeat(4 - padding)}`;
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0)).buffer;
}

export default function SocialPlannerPanel() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { biz } = useWorkspace();

  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null);
  const [schedules, setSchedules] = useState<SocialScheduleItem[]>([]);
  const [approvedDrafts, setApprovedDrafts] = useState<SocialDraftItem[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionById, setActionById] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState('');
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt());
  const [assignedUserId, setAssignedUserId] = useState('');
  const [executionChannelByScheduleId, setExecutionChannelByScheduleId] = useState<Record<string, 'instagram' | 'tiktok'>>({});
  const [weeklyStats, setWeeklyStats] = useState<{
    published_count: number;
    goal: number;
    remaining: number;
    is_completed: boolean;
  } | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushPending, setPushPending] = useState(false);
  const expiredSignalRef = useRef<string | null>(null);

  const canManageSchedules = viewerRole === 'owner' || viewerRole === 'manager';
  const canMarkPublished = viewerRole === 'owner' || viewerRole === 'manager' || viewerRole === 'staff';
  const canSnoozeSchedules = viewerRole === 'owner' || viewerRole === 'manager';
  const preselectedDraftId = searchParams.get('draft_id');
  const preselectedRecommendationId = searchParams.get('recommendation_id');
  const highlightedScheduleId = searchParams.get('schedule_id');

  const loadPushStatus = useCallback(async () => {
    const supported = browserSupportsPush();
    setPushSupported(supported);

    if (!supported || !biz?.id) {
      setPushEnabled(false);
      setPushSubscribed(false);
      setPushPublicKey(null);
      return;
    }

    setPushPending(true);
    try {
      const response = await fetch(`/api/push/status?biz_id=${encodeURIComponent(biz.id)}`);
      const payload = (await response.json().catch(() => ({}))) as PushStatusPayload;

      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'push_status_failed');
      }

      setPushEnabled(Boolean(payload.push_enabled));
      setPushSubscribed(Boolean(payload.subscribed));
      setPushPublicKey(typeof payload.vapid_public_key === 'string' ? payload.vapid_public_key : null);
    } catch {
      setPushEnabled(false);
      setPushSubscribed(false);
      setPushPublicKey(null);
    } finally {
      setPushPending(false);
    }
  }, [biz?.id]);

  const loadPlannerData = useCallback(async () => {
    if (!biz?.id) {
      setSchedules([]);
      setApprovedDrafts([]);
      setTeamMembers([]);
      setViewerRole(null);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('biz_id', biz.id);
      params.set('limit', '200');

      const schedulesResponse = await fetch(`/api/social/schedules?${params.toString()}`);
      const schedulesPayload = (await schedulesResponse.json().catch(() => ({}))) as SchedulesListPayload;
      if (!schedulesResponse.ok || schedulesPayload.error) {
        throw new Error(schedulesPayload.message || 'load_failed');
      }

      const nextRole = schedulesPayload.viewer_role || null;
      setViewerRole(nextRole);
      setSchedules(schedulesPayload.items || []);

      const statsResponse = await fetch(`/api/social/stats/weekly?biz_id=${biz.id}`);
      const statsPayload = (await statsResponse.json().catch(() => ({}))) as WeeklySocialStatsPayload;
      if (statsResponse.ok && !statsPayload.error) {
        setWeeklyStats({
          published_count: typeof statsPayload.published_count === 'number' ? statsPayload.published_count : 0,
          goal: typeof statsPayload.goal === 'number' ? statsPayload.goal : 3,
          remaining: typeof statsPayload.remaining === 'number' ? statsPayload.remaining : 0,
          is_completed: Boolean(statsPayload.is_completed),
        });
      } else {
        setWeeklyStats(null);
      }

      const draftsResponse = await fetch(`/api/social/drafts?biz_id=${biz.id}&status=approved&limit=40`);
      const draftsPayload = (await draftsResponse.json().catch(() => ({}))) as SocialDraftListPayload;
      if (draftsResponse.ok && Array.isArray(draftsPayload.items)) {
        setApprovedDrafts(draftsPayload.items);
      } else {
        setApprovedDrafts([]);
      }

      if (nextRole === 'owner' || nextRole === 'manager') {
        const teamResponse = await fetch(`/api/team?org_id=${biz.org_id}`);
        const teamPayload = (await teamResponse.json().catch(() => ({}))) as TeamPayload;
        const members = Array.isArray(teamPayload.members) ? teamPayload.members : [];
        const eligible = members.filter((member) => (
          member.accepted_at
          && (member.role === 'owner' || member.role === 'manager' || member.role === 'staff')
        ));
        setTeamMembers(eligible);
      } else {
        setTeamMembers([]);
      }
    } catch {
      setSchedules([]);
      setApprovedDrafts([]);
      setTeamMembers([]);
      setViewerRole(null);
      setWeeklyStats(null);
    } finally {
      setLoading(false);
    }
  }, [biz?.id, biz?.org_id]);

  useEffect(() => {
    void loadPlannerData();
  }, [loadPlannerData]);

  useEffect(() => {
    void loadPushStatus();
  }, [loadPushStatus]);

  useEffect(() => {
    if (!canManageSchedules) return;
    if (!formOpen) return;

    if (preselectedDraftId && approvedDrafts.some((draft) => draft.id === preselectedDraftId)) {
      setSelectedDraftId(preselectedDraftId);
    } else if (preselectedRecommendationId) {
      const byRecommendation = approvedDrafts.find((draft) => draft.recommendation_id === preselectedRecommendationId);
      if (byRecommendation) {
        setSelectedDraftId(byRecommendation.id);
      } else if (!selectedDraftId && approvedDrafts.length > 0) {
        setSelectedDraftId(approvedDrafts[0].id);
      }
    } else if (!selectedDraftId && approvedDrafts.length > 0) {
      setSelectedDraftId(approvedDrafts[0].id);
    }

    if (!assignedUserId && teamMembers.length > 0) {
      setAssignedUserId(teamMembers[0].user_id);
    }
  }, [approvedDrafts, assignedUserId, canManageSchedules, formOpen, preselectedDraftId, preselectedRecommendationId, selectedDraftId, teamMembers]);

  useEffect(() => {
    if (!canManageSchedules) {
      setFormOpen(false);
      return;
    }
    if (preselectedDraftId) {
      setShowAdvanced(true);
      setFormOpen(true);
    }
  }, [canManageSchedules, preselectedDraftId]);

  useEffect(() => {
    if (showAdvanced) return;
    setFormOpen(false);
  }, [showAdvanced]);

  const scheduledItems = useMemo(
    () => schedules.filter((item) => SCHEDULED_STATUSES.has(item.status)),
    [schedules],
  );

  const publishedItems = useMemo(
    () => schedules.filter((item) => item.status === 'published'),
    [schedules],
  );

  const missedItems = useMemo(
    () => schedules.filter((item) => item.status === 'missed'),
    [schedules],
  );

  const weeklyStatsProgress = useMemo(() => {
    if (!weeklyStats || weeklyStats.goal <= 0) return 0;
    const ratio = weeklyStats.published_count / weeklyStats.goal;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  }, [weeklyStats]);

  const assigneeNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of teamMembers) {
      names[member.user_id] = member.full_name || member.invited_email || member.user_id;
    }
    return names;
  }, [teamMembers]);

  const todayPendingCount = useMemo(() => {
    const now = new Date();
    const nowY = now.getFullYear();
    const nowM = now.getMonth();
    const nowD = now.getDate();
    return scheduledItems.filter((item) => {
      const date = new Date(item.scheduled_at);
      if (Number.isNaN(date.getTime())) return false;
      return date.getFullYear() === nowY && date.getMonth() === nowM && date.getDate() === nowD;
    }).length;
  }, [scheduledItems]);

  const handleCreateSchedule = useCallback(async () => {
    if (!biz?.id || !selectedDraftId || !assignedUserId || !scheduledAt) {
      toast(t('dashboard.home.socialPlanner.validationError'), 'warning');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/social/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          draft_id: selectedDraftId,
          platform,
          scheduled_at: scheduledAt,
          assigned_user_id: assignedUserId,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as ScheduleMutatePayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.socialPlanner.createError'));
      }

      toast(t('dashboard.home.socialPlanner.createSuccess'), 'success');
      setFormOpen(false);
      setScheduledAt(defaultScheduledAt());
      await loadPlannerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.socialPlanner.createError');
      toast(message, 'error');
    } finally {
      setCreating(false);
    }
  }, [assignedUserId, biz?.id, loadPlannerData, platform, scheduledAt, selectedDraftId, t, toast]);

  const mutateSchedule = useCallback(async (
    scheduleId: string,
    action: 'publish' | 'snooze' | 'cancel',
    body?: Record<string, unknown>,
    analytics?: { platformTarget?: 'instagram' | 'tiktok'; pushTriggered?: boolean },
  ) => {
    setActionById((previous) => ({ ...previous, [scheduleId]: true }));

    try {
      const response = await fetch(`/api/social/schedules/${scheduleId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : '{}',
      });
      const payload = (await response.json().catch(() => ({}))) as ScheduleMutatePayload;
      if (!response.ok || payload.error) {
        throw new Error(payload.message || t('dashboard.home.socialPlanner.actionError'));
      }

      toast(t('dashboard.home.socialPlanner.actionSuccess'), 'success');
      if (action === 'publish') {
        void captureClientEvent({
          bizId: biz?.id || '',
          event: 'ikea_action',
          mode: showAdvanced ? 'advanced' : 'basic',
          properties: {
            action: 'done',
            schedule_id: scheduleId,
          },
        });
        void captureClientEvent({
          bizId: biz?.id || '',
          event: 'post_executed',
          mode: showAdvanced ? 'advanced' : 'basic',
          properties: {
            schedule_id: scheduleId,
            platform_target: analytics?.platformTarget || null,
            push_triggered: analytics?.pushTriggered ?? null,
          },
        });
      } else if (action === 'snooze') {
        void captureClientEvent({
          bizId: biz?.id || '',
          event: 'ikea_action',
          mode: showAdvanced ? 'advanced' : 'basic',
          properties: {
            action: 'snooze',
            schedule_id: scheduleId,
          },
        });
        void captureClientEvent({
          bizId: biz?.id || '',
          event: 'post_snoozed',
          mode: showAdvanced ? 'advanced' : 'basic',
          properties: {
            schedule_id: scheduleId,
            platform_target: analytics?.platformTarget || null,
          },
        });
      }
      await loadPlannerData();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.home.socialPlanner.actionError');
      toast(message, 'error');
    } finally {
      setActionById((previous) => {
        const next = { ...previous };
        delete next[scheduleId];
        return next;
      });
    }
  }, [biz?.id, loadPlannerData, showAdvanced, t, toast]);

  const handleCopyDraft = useCallback(async (text: string) => {
    if (!text) {
      toast(t('dashboard.home.socialPlanner.copyError'), 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      toast(t('dashboard.home.socialPlanner.copySuccess'), 'success');
      void captureClientEvent({
        bizId: biz?.id || '',
        event: 'ikea_action',
        mode: showAdvanced ? 'advanced' : 'basic',
        properties: {
          action: 'copy',
        },
      });
    } catch {
      toast(t('dashboard.home.socialPlanner.copyError'), 'error');
    }
  }, [biz?.id, showAdvanced, t, toast]);

  const handleOpenPlatform = useCallback((platform: 'instagram' | 'tiktok', scheduleId?: string) => {
    if (!biz?.id) return;
    void captureClientEvent({
      bizId: biz.id,
      event: 'ikea_action',
      mode: showAdvanced ? 'advanced' : 'basic',
      properties: {
        action: 'open',
        platform,
        schedule_id: scheduleId || null,
      },
    });
    window.open(platformUrl(platform), '_blank', 'noopener,noreferrer');
  }, [biz?.id, showAdvanced]);

  const handleEnablePush = useCallback(async () => {
    if (!biz?.id) return;
    if (!browserSupportsPush()) {
      toast('Push no disponible en aquest navegador.', 'error');
      void captureClientEvent({
        bizId: biz.id,
        event: 'enable_push',
        mode: showAdvanced ? 'advanced' : 'basic',
        properties: {
          push_enabled: false,
          os_permission_granted: false,
          push_subscription_active: false,
          reason: 'unsupported_browser',
        },
      });
      return;
    }
    if (!pushPublicKey) {
      toast('Push no configurat al servidor.', 'error');
      void captureClientEvent({
        bizId: biz.id,
        event: 'enable_push',
        mode: showAdvanced ? 'advanced' : 'basic',
        properties: {
          push_enabled: false,
          os_permission_granted: false,
          push_subscription_active: false,
          reason: 'missing_vapid_key',
        },
      });
      return;
    }

    setPushPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Cal acceptar permisos de notificació per activar recordatoris.', 'error');
        void captureClientEvent({
          bizId: biz.id,
          event: 'enable_push',
          mode: showAdvanced ? 'advanced' : 'basic',
          properties: {
            push_enabled: false,
            os_permission_granted: false,
            push_subscription_active: false,
            reason: 'permission_denied',
          },
        });
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBufferSource(pushPublicKey),
        });
      }

      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
        throw new Error('subscription_invalid');
      }

      const response = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          subscription: {
            endpoint: serialized.endpoint,
            keys: {
              p256dh: serialized.keys.p256dh,
              auth: serialized.keys.auth,
            },
          },
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'push_subscribe_failed');
      }

      toast('Push activat per aquest dispositiu.', 'success');
      setPushSubscribed(true);
      void captureClientEvent({
        bizId: biz.id,
        event: 'enable_push',
        mode: showAdvanced ? 'advanced' : 'basic',
        properties: {
          push_enabled: true,
          os_permission_granted: true,
          push_subscription_active: true,
        },
      });
    } catch {
      toast('No s’ha pogut activar el push.', 'error');
      void captureClientEvent({
        bizId: biz.id,
        event: 'enable_push',
        mode: showAdvanced ? 'advanced' : 'basic',
        properties: {
          push_enabled: false,
          os_permission_granted: true,
          push_subscription_active: false,
          reason: 'subscribe_failed',
        },
      });
    } finally {
      setPushPending(false);
      void loadPushStatus();
    }
  }, [biz?.id, loadPushStatus, pushPublicKey, showAdvanced, toast]);

  const handleDisablePush = useCallback(async () => {
    if (!biz?.id) return;
    if (!browserSupportsPush()) return;

    setPushPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      const response = await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz_id: biz.id,
          endpoint: subscription?.endpoint || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'push_unsubscribe_failed');
      }

      if (subscription) {
        await subscription.unsubscribe().catch(() => undefined);
      }

      toast('Push desactivat per aquest dispositiu.', 'success');
      setPushSubscribed(false);
    } catch {
      toast('No s’ha pogut desactivar el push.', 'error');
    } finally {
      setPushPending(false);
      void loadPushStatus();
    }
  }, [biz?.id, loadPushStatus, toast]);

  useEffect(() => {
    if (!biz?.id) return;
    const signature = `${biz.id}:${missedItems.length}`;
    if (missedItems.length === 0) {
      expiredSignalRef.current = signature;
      return;
    }
    if (expiredSignalRef.current === signature) return;
    expiredSignalRef.current = signature;
    void captureClientEvent({
      bizId: biz.id,
      event: 'post_expired',
      mode: showAdvanced ? 'advanced' : 'basic',
      properties: {
        missed_count: missedItems.length,
      },
    });
  }, [biz?.id, missedItems.length, showAdvanced]);

  if (!biz) {
    return null;
  }

  return (
    <GlassCard variant="strong" className="p-4 md:p-5" data-testid="dashboard-social-planner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={cn('text-base font-semibold', textMain)}>{t('dashboard.home.socialPlanner.title')}</h2>
          <p className={cn('mt-1 text-xs', textSub)}>{t('dashboard.home.socialPlanner.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pushSupported ? (
            pushEnabled ? (
              <Button
                variant={pushSubscribed ? 'ghost' : 'secondary'}
                className="h-8 px-3 text-xs"
                loading={pushPending}
                onClick={() => {
                  if (pushSubscribed) {
                    void handleDisablePush();
                  } else {
                    void handleEnablePush();
                  }
                }}
              >
                {pushSubscribed ? 'Push actiu' : 'Activar push'}
              </Button>
            ) : (
              <span className="inline-flex h-8 items-center rounded-full border border-amber-300/35 bg-amber-300/10 px-3 text-[11px] font-semibold text-amber-100">
                Push no configurat
              </span>
            )
          ) : null}
          <Button
            variant="ghost"
            className="h-8 px-3 text-xs text-white/80 hover:text-white"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            {showAdvanced
              ? t('dashboard.home.socialPlanner.advancedOptionsHide')
              : t('dashboard.home.socialPlanner.advancedOptionsShow')}
          </Button>
          {canManageSchedules && showAdvanced ? (
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setFormOpen((value) => !value)}
            >
              {t('dashboard.home.socialPlanner.scheduleButton')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
            {t('dashboard.home.weeklyConsistency.title')}
          </p>
          <p className="text-sm font-semibold text-white/90">
            {weeklyStats
              ? t('dashboard.home.weeklyConsistency.value', {
                done: weeklyStats.published_count,
                goal: weeklyStats.goal,
              })
              : '—/—'}
          </p>
        </div>
        <div className="mt-2 h-2 rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-300/80 transition-all duration-300"
            style={{ width: `${weeklyStatsProgress}%` }}
          />
        </div>
        <p className={cn('mt-2 text-xs', textSub)}>
          {weeklyStats
            ? weeklyStats.is_completed
              ? t('dashboard.home.weeklyConsistency.completed')
              : t('dashboard.home.weeklyConsistency.remaining', { count: weeklyStats.remaining })
            : t('dashboard.home.weeklyConsistency.unavailable')}
        </p>
        {todayPendingCount === 0 ? (
          <p className="mt-1 text-xs text-emerald-200/90">
            {t('dashboard.home.socialPlanner.todayDone')}
          </p>
        ) : null}
      </div>

      {canManageSchedules && showAdvanced && formOpen ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
            {t('dashboard.home.socialPlanner.scheduleModalTitle')}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-white/70">{t('dashboard.home.socialPlanner.draftLabel')}</span>
              <select
                className="glass-input w-full"
                value={selectedDraftId}
                onChange={(event) => setSelectedDraftId(event.target.value)}
              >
                {approvedDrafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {(draft.title || t('dashboard.home.approvalInbox.untitled')).slice(0, 80)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/70">{t('dashboard.home.socialPlanner.platformLabel')}</span>
              <select
                className="glass-input w-full"
                value={platform}
                onChange={(event) => setPlatform(event.target.value === 'tiktok' ? 'tiktok' : 'instagram')}
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/70">{t('dashboard.home.socialPlanner.assigneeLabel')}</span>
              <select
                className="glass-input w-full"
                value={assignedUserId}
                onChange={(event) => setAssignedUserId(event.target.value)}
              >
                {teamMembers.map((member) => (
                  <option key={member.id} value={member.user_id}>
                    {member.full_name || member.invited_email || member.user_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-white/70">{t('dashboard.home.socialPlanner.datetimeLabel')}</span>
              <input
                type="datetime-local"
                className="glass-input w-full"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>
          </div>

          {approvedDrafts.length === 0 ? (
            <div className="mt-2 space-y-2">
                <p className="text-xs text-amber-200/85">{t('dashboard.home.socialPlanner.approvedDraftsEmpty')}</p>
                <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => router.push(`/dashboard/lito?biz_id=${biz.id}`)}
                >
                    {t('dashboard.home.socialPlanner.createDraftCta')}
                </Button>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => router.push(`/dashboard/lito/review?biz_id=${biz.id}`)}
                >
                    {t('dashboard.home.socialPlanner.viewPendingCta')}
                  </Button>
                </div>
              </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-8 px-3 text-xs"
              onClick={() => setFormOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              className="h-8 px-3 text-xs"
              loading={creating}
              disabled={approvedDrafts.length === 0}
              onClick={() => void handleCreateSchedule()}
            >
              {t('dashboard.home.socialPlanner.saveSchedule')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
            {`${t('dashboard.home.socialPlanner.scheduledList')} (${scheduledItems.length})`}
          </p>
          <div className="mt-2 space-y-2">
            {loading ? (
              <div className="h-16 animate-pulse rounded-lg border border-white/10 bg-white/5" />
            ) : scheduledItems.length === 0 ? (
              <div className="space-y-2">
                <p className={cn('text-xs', textSub)}>{t('dashboard.home.socialPlanner.emptyScheduled')}</p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="secondary"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => router.push(`/dashboard/lito?biz_id=${biz.id}`)}
                  >
                    {t('dashboard.home.socialPlanner.prepareWithLito')}
                  </Button>
                  {canManageSchedules && showAdvanced ? (
                    <Button
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setFormOpen(true)}
                    >
                      {t('dashboard.home.socialPlanner.emptyScheduledCta')}
                    </Button>
                  ) : null}
                  {approvedDrafts.length === 0 ? (
                    <Button
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => router.push(`/dashboard/lito/review?biz_id=${biz.id}`)}
                    >
                      {t('dashboard.home.socialPlanner.viewPendingCta')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              scheduledItems.map((item) => {
                const pending = Boolean(actionById[item.id]);
                const draft = item.draft || null;
                const executionChannel = executionChannelByScheduleId[item.id] || item.platform;
                const ikeaChecklist = getIkeaChecklist({
                  t,
                  format: draft?.format || 'post',
                  channel: executionChannel,
                  locale: locale === 'es' || locale === 'en' ? locale : 'ca',
                  vertical: biz.type || 'general',
                  hook: draft?.title || '',
                  idea: draft?.copy_short || draft?.copy_long || '',
                  cta: t('dashboard.home.socialPlanner.ikeaCtaFallback'),
                });
                const executionCopy = normalizeExecutionCopy(draft, ikeaChecklist.copyText);
                const draftTitle = draft?.title || t('dashboard.home.socialPlanner.defaultScheduledTitle');
                const assigneeLabel = assigneeNames[item.assigned_user_id] || t('dashboard.home.socialPlanner.assignedFallback');
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-lg border border-white/10 bg-black/20 p-2',
                      highlightedScheduleId === item.id && 'border-emerald-300/50 bg-emerald-400/10',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold leading-none text-white/92">
                          {formatTimeLabel(item.scheduled_at, locale)}
                        </p>
                        <p className="mt-1 text-[11px] text-white/65">
                          {formatDayLabel(item.scheduled_at, locale)}
                        </p>
                      </div>
                      <span className="inline-flex rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                        {item.platform === 'instagram' ? 'IG' : 'TikTok'}
                      </span>
                    </div>
                    <p className={cn('mt-2 line-clamp-2 text-xs font-semibold text-white/90')}>
                      {draftTitle}
                    </p>
                    <p className={cn('mt-1 text-[11px] text-white/65')}>
                      {t('dashboard.home.socialPlanner.assignedTo', { name: assigneeLabel })}
                    </p>
                    <span className="mt-2 inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                      {t(`dashboard.home.socialPlanner.status.${item.status}`)}
                    </span>
                    <div className="mt-2 rounded-md border border-white/10 bg-black/20 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/65">
                        {t('dashboard.home.socialPlanner.ikeaQuickTitle')}
                      </p>
                      <div className="mt-1 inline-flex rounded-full border border-white/10 bg-black/30 p-0.5">
                        <button
                          type="button"
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-medium transition-colors',
                            executionChannel === 'instagram'
                              ? 'bg-white/16 text-white'
                              : 'text-white/70 hover:text-white',
                          )}
                          onClick={() => setExecutionChannelByScheduleId((previous) => ({ ...previous, [item.id]: 'instagram' }))}
                        >
                          Instagram
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'rounded-full px-2 py-1 text-[10px] font-medium transition-colors',
                            executionChannel === 'tiktok'
                              ? 'bg-white/16 text-white'
                              : 'text-white/70 hover:text-white',
                          )}
                          onClick={() => setExecutionChannelByScheduleId((previous) => ({ ...previous, [item.id]: 'tiktok' }))}
                        >
                          TikTok
                        </button>
                      </div>
                      <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-white/75">
                        {ikeaChecklist.steps.slice(0, 2).map((step) => (
                          <li key={`${item.id}-${step}`}>{step}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Button
                        variant="secondary"
                        className="h-7 px-2 text-[11px]"
                        loading={pending}
                        onClick={() => {
                          if (canMarkPublished) {
                            void mutateSchedule(item.id, 'publish', undefined, {
                              platformTarget: executionChannel,
                              pushTriggered: pushSubscribed,
                            });
                            return;
                          }
                          router.push(`/dashboard/lito/review?biz_id=${biz.id}&draft_id=${item.draft_id}`);
                        }}
                      >
                        {canMarkPublished
                          ? t('dashboard.home.socialPlanner.quickDone')
                          : t('dashboard.home.socialPlanner.viewItem')}
                      </Button>
                      <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void handleCopyDraft(executionCopy)}>
                        {t('dashboard.home.socialPlanner.quickCopy')}
                      </Button>
                      <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => handleOpenPlatform(executionChannel, item.id)}>
                        {t('dashboard.home.socialPlanner.quickOpen')}
                      </Button>
                      {canSnoozeSchedules ? (
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          loading={pending}
                          onClick={() => void mutateSchedule(item.id, 'snooze', { mode: 'tomorrow_same_time' }, {
                            platformTarget: executionChannel,
                          })}
                        >
                          {t('dashboard.home.socialPlanner.quickTomorrow')}
                        </Button>
                      ) : null}
                      {canManageSchedules && showAdvanced ? (
                        <Button
                          variant="ghost"
                          className="h-7 px-2 text-[11px] text-rose-200"
                          loading={pending}
                          onClick={() => void mutateSchedule(item.id, 'cancel')}
                        >
                          {t('dashboard.home.socialPlanner.cancelSchedule')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
            {`${t('dashboard.home.socialPlanner.publishedList')} (${publishedItems.length})`}
          </p>
          <div className="mt-2 space-y-2">
            {publishedItems.length === 0 ? (
              <p className={cn('text-xs', textSub)}>{t('dashboard.home.socialPlanner.emptyPublished')}</p>
            ) : (
              publishedItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-2',
                    highlightedScheduleId === item.id && 'border-emerald-200/70',
                  )}
                >
                  <p className={cn('line-clamp-1 text-xs font-semibold text-emerald-100')}>
                    {item.draft?.title || t('dashboard.home.socialPlanner.defaultScheduledTitle')}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-100/80">{formatDateLabel(item.published_at || item.updated_at, locale)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => router.push(`/dashboard/lito/review?biz_id=${biz.id}&draft_id=${item.draft_id}`)}
                    >
                      {t('dashboard.home.socialPlanner.viewItem')}
                    </Button>
                    <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => void handleCopyDraft(normalizeScheduleCopy(item.draft || null))}>
                      {t('dashboard.home.socialPlanner.quickCopy')}
                    </Button>
                    <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => handleOpenPlatform(item.platform, item.id)}>
                      {t('dashboard.home.socialPlanner.quickOpen')}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/70')}>
            {`${t('dashboard.home.socialPlanner.missedList')} (${missedItems.length})`}
          </p>
          <div className="mt-2 space-y-2">
            {missedItems.length === 0 ? (
              <p className={cn('text-xs', textSub)}>{t('dashboard.home.socialPlanner.emptyMissed')}</p>
            ) : (
              missedItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'rounded-lg border border-amber-300/20 bg-amber-500/10 p-2',
                    highlightedScheduleId === item.id && 'border-amber-100/70',
                  )}
                >
                  <p className={cn('line-clamp-1 text-xs font-semibold text-amber-100')}>
                    {item.draft?.title || t('dashboard.home.socialPlanner.defaultScheduledTitle')}
                  </p>
                  <p className="mt-1 text-[11px] text-amber-100/80">{formatDateLabel(item.scheduled_at, locale)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => router.push(`/dashboard/lito/review?biz_id=${biz.id}&draft_id=${item.draft_id}`)}
                    >
                      {t('dashboard.home.socialPlanner.viewItem')}
                    </Button>
                    {canSnoozeSchedules ? (
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void mutateSchedule(item.id, 'snooze', { mode: 'tomorrow_same_time' }, {
                          platformTarget: item.platform,
                        })}
                      >
                        {t('dashboard.home.socialPlanner.snoozeTomorrow')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
