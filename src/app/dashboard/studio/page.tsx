'use client';

export const dynamic = 'force-dynamic';


import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import { glass, glassStrong } from '@/components/ui/glass';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import {
  defaultScheduledAtTomorrow,
  getCurrentWeekStartMonday,
  getWeekStartMondayFromDate,
  normalizeWeekStartMonday,
  plannerChannelFromAssetFormat,
} from '@/lib/planner';
import type {
  ContentPlannerChannel,
  ContentPlannerItemType,
  ContentPlannerStatus,
} from '@/types/database';

type StudioLanguage = 'ca' | 'es' | 'en';
type StudioFormat = 'story' | 'feed';
type StudioTemplateId = 'quote-clean' | 'feature-split' | 'top3-reasons' | 'behind-scenes';
type StudioStatus = 'created' | 'failed';

type FormatFilter = 'all' | StudioFormat;
type LanguageFilter = 'all' | StudioLanguage;
type StatusFilter = 'all' | StudioStatus;
type TemplateFilter = 'all' | StudioTemplateId;

type StudioAssetItem = {
  id: string;
  suggestion_id: string | null;
  created_at: string;
  format: StudioFormat;
  template_id: string;
  language: StudioLanguage;
  status: StudioStatus;
};

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

type ListAssetsResponse = {
  items?: StudioAssetItem[];
  nextCursor?: string | null;
  request_id?: string;
  error?: string;
  message?: string;
};

type SignedUrlResponse = {
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

type RenderResponse = {
  assetId?: string;
  format?: StudioFormat;
  templateId?: StudioTemplateId;
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerListResponse = {
  weekStart?: string;
  items?: PlannerItem[];
  request_id?: string;
  error?: string;
  message?: string;
};

type PlannerMutateResponse = {
  item?: PlannerItem;
  deduped?: boolean;
  request_id?: string;
  error?: string;
  message?: string;
};

function toLocalDateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function plannerChannelLabel(channel: ContentPlannerChannel): string {
  if (channel === 'ig_story') return 'IG Story';
  if (channel === 'ig_feed') return 'IG Feed';
  if (channel === 'ig_reel') return 'IG Reel';
  if (channel === 'threads') return 'Threads';
  return 'X';
}

export default function StudioPage() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { biz } = useWorkspace();
  const fromContent = searchParams.get('from') === 'content';
  const focusedAssetId = searchParams.get('assetId');
  const shouldAutoOpenEditor = searchParams.get('edit') === '1';

  const [weekStart, setWeekStart] = useState<string>(getCurrentWeekStartMonday);
  const [format, setFormat] = useState<FormatFilter>('all');
  const [language, setLanguage] = useState<LanguageFilter>('all');
  const [templateId, setTemplateId] = useState<TemplateFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<StudioAssetItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [previewByAssetId, setPreviewByAssetId] = useState<Record<string, string>>({});
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const [plannerItems, setPlannerItems] = useState<PlannerItem[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerPendingAssetId, setPlannerPendingAssetId] = useState<string | null>(null);

  const [reuseAsset, setReuseAsset] = useState<StudioAssetItem | null>(null);
  const [reuseFormat, setReuseFormat] = useState<StudioFormat>('story');
  const [reuseTemplateId, setReuseTemplateId] = useState<StudioTemplateId>('quote-clean');
  const [reusing, setReusing] = useState(false);
  const [autoOpenedAssetId, setAutoOpenedAssetId] = useState<string | null>(null);

  const listParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('weekStart', normalizeWeekStartMonday(weekStart));
    params.set('limit', '30');
    if (format !== 'all') params.set('format', format);
    if (language !== 'all') params.set('language', language);
    if (templateId !== 'all') params.set('templateId', templateId);
    if (status !== 'all') params.set('status', status);
    return params;
  }, [weekStart, format, language, templateId, status]);

  useEffect(() => {
    if (!biz) return;
    void loadAssets(false);
  }, [biz?.id, listParams.toString()]);

  useEffect(() => {
    if (!biz) return;
    void loadPlanner();
  }, [biz?.id, weekStart]);

  useEffect(() => {
    if (!focusedAssetId || !shouldAutoOpenEditor) return;
    if (autoOpenedAssetId === focusedAssetId) return;
    const asset = assets.find((item) => item.id === focusedAssetId);
    if (!asset) return;
    startReuse(asset);
    setAutoOpenedAssetId(focusedAssetId);
  }, [assets, autoOpenedAssetId, focusedAssetId, shouldAutoOpenEditor]);

  async function loadPlanner() {
    if (!biz) return;
    setPlannerLoading(true);

    try {
      const params = new URLSearchParams();
      params.set('weekStart', normalizeWeekStartMonday(weekStart));
      params.set('limit', '20');

      const response = await fetch(`/api/planner?${params.toString()}`, {
        headers: {
          'x-biz-id': biz.id,
        },
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

  async function loadAssets(append: boolean) {
    if (!biz) return;

    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams(listParams);
      if (append && nextCursor) {
        params.set('cursor', nextCursor);
      }

      const response = await fetch(`/api/content-studio/assets?${params.toString()}`, {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as ListAssetsResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !Array.isArray(payload.items)) {
        const message = payload.message || t('dashboard.studio.errorLoadAssets');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        if (!append) {
          setAssets([]);
          setNextCursor(null);
        }
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      setAssets((prev) => append ? [...prev, ...payload.items!] : payload.items!);
      setNextCursor(payload.nextCursor || null);
      setLoading(false);
      setLoadingMore(false);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('dashboard.studio.errorLoadAssets'));
      setLoading(false);
      setLoadingMore(false);
    }
  }

  async function fetchSignedUrl(assetId: string): Promise<string | null> {
    if (!biz) return null;
    if (previewByAssetId[assetId]) return previewByAssetId[assetId];

    setPreviewLoadingId(assetId);

    try {
      const response = await fetch(`/api/content-studio/assets/${assetId}/signed-url`, {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as SignedUrlResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.signedUrl) {
        const message = payload.message || t('dashboard.studio.errorSignedUrl');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setPreviewLoadingId(null);
        return null;
      }

      setPreviewByAssetId((prev) => ({ ...prev, [assetId]: payload.signedUrl! }));
      setPreviewLoadingId(null);
      return payload.signedUrl;
    } catch (signedError: unknown) {
      setError(signedError instanceof Error ? signedError.message : t('dashboard.studio.errorSignedUrl'));
      setPreviewLoadingId(null);
      return null;
    }
  }

  async function handleOpenAsset(assetId: string) {
    await fetchSignedUrl(assetId);
  }

  async function handleDownloadAsset(assetId: string, formatValue: StudioFormat) {
    const existing = previewByAssetId[assetId];
    setDownloadingId(assetId);
    const signedUrl = existing || await fetchSignedUrl(assetId);
    if (!signedUrl) {
      setDownloadingId(null);
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = signedUrl;
    anchor.download = `studio-${formatValue}-${assetId}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setDownloadingId(null);
  }

  async function addAssetToPlanner(asset: StudioAssetItem) {
    if (!biz) return;

    setPlannerPendingAssetId(asset.id);
    setError(null);

    try {
      const scheduledAt = defaultScheduledAtTomorrow();
      const plannerWeekStart = getWeekStartMondayFromDate(new Date(scheduledAt));
      const response = await fetch('/api/planner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify({
          businessId: biz.id,
          weekStart: plannerWeekStart,
          scheduledAt,
          channel: plannerChannelFromAssetFormat(asset.format),
          itemType: 'asset',
          assetId: asset.id,
          title: `Asset: ${asset.template_id}`,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as PlannerMutateResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');
      if (!response.ok || payload.error || !payload.item) {
        const message = payload.message || t('dashboard.growth.plannerErrorSave');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setPlannerPendingAssetId(null);
        return;
      }

      const normalizedCurrentWeek = normalizeWeekStartMonday(weekStart);
      if (plannerWeekStart !== normalizedCurrentWeek) {
        setWeekStart(plannerWeekStart);
      } else {
        await loadPlanner();
      }

      setPlannerPendingAssetId(null);
    } catch (plannerError: unknown) {
      setError(plannerError instanceof Error ? plannerError.message : t('dashboard.growth.plannerErrorSave'));
      setPlannerPendingAssetId(null);
    }
  }

  function startReuse(asset: StudioAssetItem) {
    setReuseAsset(asset);
    setReuseFormat(asset.format);
    setReuseTemplateId((asset.template_id as StudioTemplateId) || 'quote-clean');
  }

  async function handleReuseGenerate() {
    if (!biz || !reuseAsset) return;

    setReusing(true);
    setError(null);

    try {
      const body = reuseAsset.suggestion_id
        ? {
            suggestionId: reuseAsset.suggestion_id,
            format: reuseFormat,
            templateId: reuseTemplateId,
            language: reuseAsset.language,
          }
        : {
            sourceAssetId: reuseAsset.id,
            format: reuseFormat,
            templateId: reuseTemplateId,
            language: reuseAsset.language,
          };

      const response = await fetch('/api/content-studio/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': biz.id,
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as RenderResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.assetId || !payload.signedUrl) {
        const message = payload.message || t('dashboard.studio.errorRender');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setReusing(false);
        return;
      }

      setPreviewByAssetId((prev) => ({ ...prev, [payload.assetId!]: payload.signedUrl! }));
      setReuseAsset(null);
      setReusing(false);
      await loadAssets(false);
    } catch (reuseError: unknown) {
      setError(reuseError instanceof Error ? reuseError.message : t('dashboard.studio.errorRender'));
      setReusing(false);
    }
  }

  if (!biz) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-white/55">
        <div className="text-center">
          <p className="text-3xl mb-3">🗂️</p>
          <p className="font-medium">Selecciona un negoci per obrir Studio</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="studio-page">
      <section className={`${glassStrong} p-5 space-y-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-bold text-white/92">{t('dashboard.studio.libraryTitle')}</h1>
            <p className="text-sm text-white/68 mt-1">{t('dashboard.studio.librarySubtitle')}</p>
          </div>
          {fromContent && (
            <Button
              variant="secondary"
              onClick={() => router.push('/dashboard/content')}
              className="text-xs md:text-sm"
            >
              {t('dashboard.contentGallery.backToGallery')}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-white/72">
            {t('dashboard.growth.weekLabel')}
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
              className="mt-1 block w-44 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
              data-testid="studio-filter-week"
            />
          </label>

          <label className="text-sm text-white/72">
            {t('dashboard.studio.formatLabel')}
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as FormatFilter)}
              className="mt-1 block w-36 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
              data-testid="studio-filter-format"
            >
              <option value="all">{t('dashboard.studio.formatAll')}</option>
              <option value="story">{t('dashboard.studio.formatStory')}</option>
              <option value="feed">{t('dashboard.studio.formatFeed')}</option>
            </select>
          </label>

          <label className="text-sm text-white/72">
            {t('common.language')}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as LanguageFilter)}
              className="mt-1 block w-36 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
              data-testid="studio-filter-language"
            >
              <option value="all">{t('dashboard.studio.languageAll')}</option>
              <option value="ca">{t('common.locales.ca')}</option>
              <option value="es">{t('common.locales.es')}</option>
              <option value="en">{t('common.locales.en')}</option>
            </select>
          </label>

          <label className="text-sm text-white/72">
            {t('dashboard.studio.templateLabel')}
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value as TemplateFilter)}
              className="mt-1 block w-44 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
            >
              <option value="all">{t('dashboard.studio.templateAll')}</option>
              <option value="quote-clean">{t('dashboard.studio.templateQuoteClean')}</option>
              <option value="feature-split">{t('dashboard.studio.templateFeatureSplit')}</option>
              <option value="top3-reasons">{t('dashboard.studio.templateTop3Reasons')}</option>
              <option value="behind-scenes">{t('dashboard.studio.templateBehindScenes')}</option>
            </select>
          </label>

          <label className="text-sm text-white/72">
            {t('dashboard.studio.statusLabel')}
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className="mt-1 block w-32 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
            >
              <option value="all">{t('dashboard.studio.statusAll')}</option>
              <option value="created">{t('dashboard.studio.statusCreated')}</option>
              <option value="failed">{t('dashboard.studio.statusFailed')}</option>
            </select>
          </label>
        </div>
      </section>

      <section className={`${glassStrong} p-5 space-y-3`}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white/92">{t('dashboard.growth.planner')}</h2>
          <a href="/dashboard/growth-hub" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
            {t('dashboard.studio.openGrowthPlanner')}
          </a>
        </div>

        {plannerLoading && (
          <p className="text-sm text-white/68">{t('common.loading')}</p>
        )}

        {!plannerLoading && plannerItems.length === 0 && (
          <p className="text-sm text-white/68">{t('dashboard.growth.noPlannerItems')}</p>
        )}

        <div className="space-y-2">
          {plannerItems.slice(0, 5).map((item) => (
            <div key={item.id} className={`${glass} px-3 py-2`} data-testid="planner-item">
              <p className="text-sm font-medium text-white/88">{toLocalDateTimeLabel(item.scheduled_at)}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-white/14 bg-white/8 px-2 py-0.5 text-[11px] text-white/72" data-testid="planner-channel-badge">
                  {plannerChannelLabel(item.channel)}
                </span>
                <span className="text-[11px] text-white/68">{item.title}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && (
        <div className={`${glass} px-4 py-6 text-sm text-white/68`}>
          {t('dashboard.studio.loadingAssets')}
        </div>
      )}

      {!loading && assets.length === 0 && (
        <div className={`${glass} border-dashed border-white/20 px-4 py-8 text-sm text-white/68 text-center`}>
          {t('dashboard.studio.noAssets')}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {assets.map((asset) => {
          const previewUrl = previewByAssetId[asset.id];
          const previewLoading = previewLoadingId === asset.id;

          return (
            <article
              key={asset.id}
              className={`${glass} p-4 space-y-3 ${focusedAssetId === asset.id ? 'ring-1 ring-brand-accent/35 border-brand-accent/35' : ''}`}
              data-testid="studio-asset-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/55 font-semibold">{asset.format}</p>
                  <h2 className="font-semibold text-white/92 leading-tight">{asset.template_id}</h2>
                  <p className="text-xs text-white/68 mt-1">{toLocalDateTimeLabel(asset.created_at)}</p>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full border border-white/14 bg-white/5 text-white/72">
                  {asset.status}
                </span>
              </div>

              <div className="text-xs text-white/68 flex flex-wrap gap-3">
                <span><strong>Lang:</strong> {asset.language}</span>
                <span><strong>ID:</strong> {asset.id.slice(0, 8)}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void handleOpenAsset(asset.id)}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                  data-testid="studio-asset-open"
                >
                  {previewLoading ? '...' : t('dashboard.studio.openAsset')}
                </button>
                <button
                  onClick={() => void handleDownloadAsset(asset.id, asset.format)}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5"
                  data-testid="studio-asset-download"
                >
                  {downloadingId === asset.id ? '...' : t('dashboard.studio.downloadAsset')}
                </button>
                <button
                  onClick={() => startReuse(asset)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                  data-testid="studio-asset-reuse"
                >
                  {t('dashboard.studio.reuseAsset')}
                </button>
                <button
                  onClick={() => void addAssetToPlanner(asset)}
                  disabled={plannerPendingAssetId === asset.id}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/5 disabled:opacity-50"
                  data-testid="planner-add"
                >
                  {plannerPendingAssetId === asset.id ? '...' : t('dashboard.growth.addToPlanner')}
                </button>
              </div>

              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase signed URL (expiring token); next/image optimizer cannot cache these correctly
                <img
                  src={previewUrl}
                  alt={`asset-${asset.id}`}
                  className="w-full rounded-lg border border-white/14"
                  data-testid="studio-asset-preview"
                />
              )}
            </article>
          );
        })}
      </section>

      {nextCursor && (
        <div className="pt-1">
          <Button variant="secondary" onClick={() => void loadAssets(true)} loading={loadingMore}>
            Carregar més
          </Button>
        </div>
      )}

      {reuseAsset && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setReuseAsset(null)}>
          <div className={`${glassStrong} w-full max-w-md p-5 space-y-4`} onClick={(event) => event.stopPropagation()}>
            <h3 className="font-semibold text-white/92">{t('dashboard.studio.reuseTitle')}</h3>

            <label className="block text-sm text-white/72">
              Format
              <select
                value={reuseFormat}
                onChange={(event) => setReuseFormat(event.target.value as StudioFormat)}
                className="mt-1 w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
                data-testid="studio-reuse-format"
              >
                <option value="story">{t('dashboard.studio.formatStory')}</option>
                <option value="feed">{t('dashboard.studio.formatFeed')}</option>
              </select>
            </label>

            <label className="block text-sm text-white/72">
              Template
              <select
                value={reuseTemplateId}
                onChange={(event) => setReuseTemplateId(event.target.value as StudioTemplateId)}
                className="mt-1 w-full rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm"
                data-testid="studio-reuse-template"
              >
                <option value="quote-clean">{t('dashboard.studio.templateQuoteClean')}</option>
                <option value="feature-split">{t('dashboard.studio.templateFeatureSplit')}</option>
                <option value="top3-reasons">{t('dashboard.studio.templateTop3Reasons')}</option>
                <option value="behind-scenes">{t('dashboard.studio.templateBehindScenes')}</option>
              </select>
            </label>

            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setReuseAsset(null)}>
                {t('dashboard.studio.close')}
              </Button>
              <Button onClick={() => void handleReuseGenerate()} loading={reusing} data-testid="studio-reuse-generate">
                {reusing ? t('dashboard.studio.reuseGenerating') : t('dashboard.studio.reuseGenerate')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
