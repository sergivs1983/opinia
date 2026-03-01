'use client';

export const dynamic = 'force-dynamic';


import { useEffect, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { cn } from '@/lib/utils';
import { glass, glassPill, glassStrong, ringAccent } from '@/components/ui/glass';
import SocialPlannerPanel from '@/components/planner/SocialPlannerPanel';
import {
  getCurrentWeekStartMonday,
  normalizeWeekStartMonday,
} from '@/lib/planner';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
} from '@/types/database';

type ContentLanguage = 'ca' | 'es' | 'en';

type PlannerItem = {
  id: string;
  scheduled_at: string;
  channel: ContentPlannerChannel;
  item_type: ContentPlannerItemType;
  title: string;
  status: ContentPlannerStatus;
  suggestion_id: string | null;
  asset_id: string | null;
  text_post_id: string | null;
};

type PlannerListResponse = {
  items?: PlannerItem[];
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerMutateResponse = {
  item?: PlannerItem;
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerWebhookSendResponse = {
  status?: 'sent' | 'failed' | 'skipped';
  request_id?: string;
  error?: string;
  message?: string;
};

type WeeklyExportResponse = {
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

type WebhookConfigResponse = {
  connectors?: Array<{
    enabled: boolean;
    allowed_channels: ContentPlannerChannel[];
  }>;
  enabled?: boolean;
  channels?: ContentPlannerChannel[];
  request_id?: string;
  error?: string;
  message?: string;
};

function toLocalPlannerLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function plannerChannelLabel(channel: ContentPlannerChannel): string {
  if (channel === 'ig_story') return 'IG Story';
  if (channel === 'ig_feed') return 'IG Feed';
  if (channel === 'ig_reel') return 'IG Reel';
  if (channel === 'threads') return 'Threads';
  return 'X';
}

export default function PlannerPage() {
  const { biz } = useWorkspace();
  const t = useT();

  const [weekStart, setWeekStart] = useState<string>(getCurrentWeekStartMonday);
  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerPendingKey, setPlannerPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookChannels, setWebhookChannels] = useState<ContentPlannerChannel[]>([]);
  const [webhookPendingId, setWebhookPendingId] = useState<string | null>(null);
  const [webhookStatusByItem, setWebhookStatusByItem] = useState<Record<string, { status: 'sent' | 'failed' | 'skipped'; requestId?: string }>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exportingWeekly, setExportingWeekly] = useState(false);
  const [exportSignedUrl, setExportSignedUrl] = useState<string | null>(null);
  const [exportRequestId, setExportRequestId] = useState<string | null>(null);
  const [language, setLanguage] = useState<ContentLanguage>('ca');
  const [showAdvancedManual, setShowAdvancedManual] = useState(false);

  useEffect(() => {
    if (!biz) return;
    const nextLanguage = biz.default_language === 'en' || biz.default_language === 'es' ? biz.default_language : 'ca';
    setLanguage(nextLanguage);
  }, [biz]);

  useEffect(() => {
    if (!biz) return;
    void loadPlanner();
  }, [biz?.id, weekStart]);

  useEffect(() => {
    if (!biz) return;
    void loadWebhookConfig();
  }, [biz?.id]);

  useEffect(() => {
    setWebhookStatusByItem({});
    setExportSignedUrl(null);
    setExportRequestId(null);
  }, [biz?.id, weekStart]);

  async function loadPlanner() {
    if (!biz) return;
    setPlannerLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('weekStart', normalizeWeekStartMonday(weekStart));
      params.set('limit', '50');

      const response = await fetch(`/api/planner?${params.toString()}`, {
        headers: { 'x-biz-id': biz.id },
      });
      const payload = (await response.json().catch(() => ({}))) as PlannerListResponse;
      if (!response.ok || payload.error || !Array.isArray(payload.items)) {
        setPlannerItems([]);
        setPlannerLoading(false);
        return;
      }

      setPlannerItems(payload.items);
      setPlannerLoading(false);
    } catch {
      setPlannerItems([]);
      setPlannerLoading(false);
    }
  }

  async function loadWebhookConfig() {
    if (!biz) return;
    try {
      const response = await fetch('/api/integrations/connectors', {
        headers: { 'x-biz-id': biz.id },
      });
      const payload = (await response.json().catch(() => ({}))) as WebhookConfigResponse;
      if (!response.ok || payload.error) throw new Error('connectors_load_failed');

      const connector = Array.isArray(payload.connectors) ? payload.connectors[0] : undefined;
      if (connector) {
        setWebhookEnabled(!!connector.enabled);
        setWebhookChannels(Array.isArray(connector.allowed_channels) ? connector.allowed_channels : []);
        return;
      }

      setWebhookEnabled(!!payload.enabled);
      setWebhookChannels(Array.isArray(payload.channels) ? payload.channels : []);
    } catch {
      setWebhookEnabled(false);
      setWebhookChannels([]);
    }
  }

  async function copyText(key: string, value: string | null | undefined) {
    await navigator.clipboard.writeText(value || '');
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1200);
  }

  async function markPlannerPublished(id: string) {
    if (!biz) return;
    setError(null);
    const pendingKey = `publish-${id}`;
    setPlannerPendingKey(pendingKey);

    try {
      const response = await fetch(`/api/planner/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ status: 'published' }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerMutateResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      if (!response.ok || payload.error || !payload.item) {
        const message = payload.message || t('dashboard.growth.plannerErrorPublish');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setPlannerPendingKey(null);
        return;
      }

      setPlannerItems((prev) => prev.map((item) => (item.id === id ? payload.item! : item)));
      setPlannerPendingKey(null);
    } catch (plannerError: unknown) {
      setError(plannerError instanceof Error ? plannerError.message : t('dashboard.growth.plannerErrorPublish'));
      setPlannerPendingKey(null);
    }
  }

  async function sendPlannerWebhook(id: string) {
    if (!biz) return;
    setError(null);
    setWebhookPendingId(id);

    try {
      const response = await fetch(`/api/planner/${id}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({ event: 'planner.ready' }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerWebhookSendResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id') || undefined;
      if (!response.ok || payload.error || !payload.status) {
        const message = payload.message || t('dashboard.growth.webhookSendError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setWebhookStatusByItem((prev) => ({ ...prev, [id]: { status: 'failed', requestId } }));
        setWebhookPendingId(null);
        return;
      }

      setWebhookStatusByItem((prev) => ({ ...prev, [id]: { status: payload.status!, requestId } }));
      setWebhookPendingId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('dashboard.growth.webhookSendError'));
      setWebhookStatusByItem((prev) => ({ ...prev, [id]: { status: 'failed' } }));
      setWebhookPendingId(null);
    }
  }

  async function handleWeeklyExport() {
    if (!biz) return;
    setError(null);
    setExportingWeekly(true);

    try {
      const response = await fetch('/api/exports/weekly', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          weekStart: normalizeWeekStartMonday(weekStart),
          language,
          includeAssets: true,
          includeTexts: true,
          includeCsv: true,
          includeReadme: true,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as WeeklyExportResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      if (!response.ok || payload.error || !payload.signedUrl) {
        const message = payload.message || t('dashboard.growth.exportError');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setExportingWeekly(false);
        return;
      }

      setExportSignedUrl(payload.signedUrl);
      setExportRequestId(requestId || null);
      setExportingWeekly(false);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : t('dashboard.growth.exportError'));
      setExportingWeekly(false);
    }
  }

  if (!biz) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-white/60">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="planner-page">
      <SocialPlannerPanel />

      <div className="flex justify-end">
        <button
          type="button"
          className={cn(glassPill, 'px-3 py-1.5 text-xs transition-all duration-[220ms] ease-premium hover:bg-white/12', ringAccent)}
          onClick={() => setShowAdvancedManual((value) => !value)}
          data-testid="planner-advanced-toggle"
        >
          {showAdvancedManual
            ? t('dashboard.home.socialPlanner.advancedOptionsHide')
            : t('dashboard.home.socialPlanner.advancedOptionsShow')}
        </button>
      </div>

      {showAdvancedManual ? (
        <>
          <section className={cn(glassStrong, 'border border-white/10 p-5 shadow-glass space-y-3')}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-white/92">{t('dashboard.growth.planner')}</h1>
                <p className="text-sm text-white/65">{t('dashboard.growth.subtitle')}</p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-white/72">
                  Week
                  <input
                    type="date"
                    value={weekStart}
                    onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
                    className={cn('glass-input mt-1 block w-44 px-3 py-2 text-sm', ringAccent)}
                    data-testid="planner-week-picker"
                  />
                </label>
                <button
                  onClick={() => void handleWeeklyExport()}
                  className={cn(glassPill, 'px-3 py-2 text-sm transition-all duration-[220ms] ease-premium hover:bg-white/15 disabled:opacity-50', ringAccent)}
                  disabled={exportingWeekly}
                  data-testid="export-weekly-btn"
                >
                  {t('dashboard.growth.exportWeekly')}
                </button>
              </div>
            </div>

            {exportingWeekly && (
              <p className="text-sm text-white/68" data-testid="export-weekly-loading">
                {t('dashboard.growth.exportLoading')}
              </p>
            )}

            {exportSignedUrl && (
              <div className={cn(glass, 'border border-emerald-300/35 px-3 py-2 text-sm text-emerald-200')}>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={exportSignedUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-testid="export-weekly-link">
                    {t('dashboard.growth.exportDownload')}
                  </a>
                  <button
                    type="button"
                    onClick={() => void copyText('export-link', exportSignedUrl)}
                    className={cn(glassPill, 'px-2 py-1 text-xs transition-all duration-[220ms] ease-premium hover:bg-white/15', ringAccent)}
                    data-testid="export-weekly-copy"
                  >
                    {copiedKey === 'export-link' ? t('dashboard.studio.copied') : t('dashboard.growth.exportCopyLink')}
                  </button>
                </div>
                {exportRequestId && <p className="mt-1 text-[11px] text-emerald-300">ID: {exportRequestId}</p>}
              </div>
            )}
          </section>

          {error && <div className={cn(glass, 'border border-rose-400/35 px-4 py-3 text-sm text-rose-200')}>{error}</div>}

          <section className={cn(glassStrong, 'border border-white/10 p-5 shadow-glass space-y-3')}>
            {plannerLoading && <p className="text-sm text-white/68">{t('common.loading')}</p>}

            {!plannerLoading && plannerItems.length === 0 && (
              <p className="text-sm text-white/68">{t('dashboard.growth.noPlannerItems')}</p>
            )}

            <div className="space-y-2">
              {plannerItems.map((item) => (
                <div key={item.id} className={cn(glass, 'border border-white/10 px-4 py-3 shadow-glass transition-all duration-[220ms] ease-premium hover:border-white/15 hover:shadow-float flex items-center justify-between gap-3')} data-testid="planner-item">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white/88">{toLocalPlannerLabel(item.scheduled_at)}</p>
                    <p className="text-xs text-white/68">{item.title}</p>
                    <div className="flex items-center gap-2">
                      <span className={cn(glassPill, 'px-2 py-0.5 text-[11px]')} data-testid="planner-channel-badge">
                        {plannerChannelLabel(item.channel)}
                      </span>
                      <span className="text-[11px] text-white/68">
                        {item.status === 'published' ? t('dashboard.growth.publishedStatus') : t('dashboard.growth.plannedStatus')}
                      </span>
                    </div>
                    {webhookStatusByItem[item.id] && (
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/72" data-testid="planner-webhook-status">
                        <span>
                          {webhookStatusByItem[item.id].status === 'sent'
                            ? t('dashboard.growth.webhookSent')
                            : webhookStatusByItem[item.id].status === 'failed'
                              ? t('dashboard.growth.webhookFailed')
                              : t('dashboard.growth.webhookSkipped')}
                          {webhookStatusByItem[item.id].requestId ? ` · ID: ${webhookStatusByItem[item.id].requestId}` : ''}
                        </span>
                        {webhookStatusByItem[item.id].requestId && (
                          <button
                            type="button"
                            onClick={() => void copyText(`webhook-${item.id}`, webhookStatusByItem[item.id].requestId)}
                            className={cn(glassPill, 'px-1.5 py-0.5 text-[10px] transition-all duration-[220ms] ease-premium hover:bg-white/12', ringAccent)}
                            data-testid="planner-webhook-copy-id"
                          >
                            {copiedKey === `webhook-${item.id}` ? 'Copiat' : 'Copiar ID'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {webhookEnabled && webhookChannels.includes(item.channel) && (
                      <button
                        onClick={() => void sendPlannerWebhook(item.id)}
                        disabled={webhookPendingId === item.id}
                        className={cn(glassPill, 'px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium hover:bg-white/12 disabled:opacity-50', ringAccent)}
                        data-testid="planner-send-webhook"
                      >
                        {webhookPendingId === item.id ? '...' : t('dashboard.growth.sendToPublish')}
                      </button>
                    )}
                    <button
                      onClick={() => void markPlannerPublished(item.id)}
                      disabled={item.status === 'published' || plannerPendingKey === `publish-${item.id}`}
                      className={cn(glassPill, 'px-3 py-1.5 text-xs font-medium transition-all duration-[220ms] ease-premium hover:bg-white/12 disabled:opacity-50', ringAccent)}
                      data-testid="planner-mark-published"
                    >
                      {item.status === 'published'
                        ? t('dashboard.growth.published')
                        : plannerPendingKey === `publish-${item.id}`
                          ? '...'
                          : t('dashboard.growth.markPublished')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
