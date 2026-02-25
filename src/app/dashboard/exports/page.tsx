'use client';

export const dynamic = 'force-dynamic';


import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/components/i18n/I18nContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { normalizeWeekStartMonday } from '@/lib/planner';
import { glass, glassStrong, ringAccent } from '@/components/ui/glass';
import type { ExportLanguage, ExportStatus } from '@/types/database';

type ExportItem = {
  id: string;
  week_start: string;
  language: ExportLanguage;
  kind: 'weekly_pack';
  bytes: number;
  items_count: number;
  status: ExportStatus;
  created_at: string;
};

type ExportsListResponse = {
  items?: ExportItem[];
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

function getCurrentWeekStart(): string {
  return normalizeWeekStartMonday(new Date().toISOString().slice(0, 10));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ExportsPage() {
  const t = useT();
  const { biz } = useWorkspace();

  const [weekStart, setWeekStart] = useState<string>(getCurrentWeekStart);
  const [language, setLanguage] = useState<'all' | ExportLanguage>('all');
  const [items, setItems] = useState<ExportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingSignedFor, setLoadingSignedFor] = useState<string | null>(null);
  const [signedUrlById, setSignedUrlById] = useState<Record<string, string>>({});

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', '20');
    if (weekStart) params.set('weekStart', normalizeWeekStartMonday(weekStart));
    if (language !== 'all') params.set('language', language);
    return params.toString();
  }, [weekStart, language]);

  useEffect(() => {
    if (!biz) return;
    void loadExports();
  }, [biz?.id, query]);

  async function loadExports() {
    if (!biz) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/exports?${query}`, {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as ExportsListResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !Array.isArray(payload.items)) {
        const message = payload.message || t('dashboard.exports.errorLoad');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setItems([]);
        setLoading(false);
        return;
      }

      setItems(payload.items);
      setLoading(false);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('dashboard.exports.errorLoad'));
      setItems([]);
      setLoading(false);
    }
  }

  async function refreshSignedUrl(exportId: string) {
    if (!biz) return;
    setLoadingSignedFor(exportId);
    setError(null);

    try {
      const response = await fetch(`/api/exports/${exportId}/signed-url`, {
        headers: {
          'x-biz-id': biz.id,
        },
      });

      const payload = (await response.json().catch(() => ({}))) as SignedUrlResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.signedUrl) {
        const message = payload.message || t('dashboard.exports.errorSignedUrl');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setLoadingSignedFor(null);
        return;
      }

      setSignedUrlById((prev) => ({ ...prev, [exportId]: payload.signedUrl! }));
      setLoadingSignedFor(null);
    } catch (signedError: unknown) {
      setError(signedError instanceof Error ? signedError.message : t('dashboard.exports.errorSignedUrl'));
      setLoadingSignedFor(null);
    }
  }

  if (!biz) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-white/70">
        <div className="text-center">
          <p className="text-3xl mb-3">📦</p>
          <p className="font-medium">Selecciona un negoci per veure exports</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <section className={`${glassStrong} border border-white/10 p-5 shadow-glass space-y-4`}>
        <div>
          <h1 className="font-display text-xl font-bold text-white/90">{t('dashboard.exports.title')}</h1>
          <p className="text-sm text-white/70 mt-1">{t('dashboard.exports.subtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-white/72">
            {t('dashboard.growth.weekLabel')}
            <input
              type="date"
              value={weekStart}
              onChange={(event) => setWeekStart(normalizeWeekStartMonday(event.target.value))}
              className={`${ringAccent} mt-1 block w-44 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/90`}
            />
          </label>

          <label className="text-sm text-white/72">
            {t('common.language')}
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'all' | ExportLanguage)}
              className={`${ringAccent} mt-1 block w-32 rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-sm text-white/90`}
            >
              <option value="all">{t('dashboard.studio.languageAll')}</option>
              <option value="ca">{t('common.locales.ca')}</option>
              <option value="es">{t('common.locales.es')}</option>
              <option value="en">{t('common.locales.en')}</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-400/45 bg-red-500/12 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className={`${glass} border border-white/10 px-4 py-6 text-sm text-white/70`}>
          {t('common.loading')}
        </div>
      )}

      <section className="space-y-3" data-testid="exports-list">
        {!loading && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/16 bg-white/8 px-4 py-8 text-sm text-white/70 text-center">
            {t('dashboard.exports.empty')}
          </div>
        )}

        {items.map((item) => (
          <article key={item.id} className={`${glass} border border-white/10 p-4 shadow-glass transition-all duration-[220ms] ease-premium hover:border-white/15 hover:shadow-float`} data-testid="exports-item">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white/90">{item.kind}</p>
                <p className="text-xs text-white/70">
                  week_start={item.week_start} · {item.language.toUpperCase()} · {formatBytes(item.bytes)} · items={item.items_count}
                </p>
                <p className="text-xs text-white/55 mt-1">{formatDate(item.created_at)}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void refreshSignedUrl(item.id)}
                  className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/8 disabled:opacity-50"
                  disabled={loadingSignedFor === item.id}
                  data-testid="exports-refresh-link"
                >
                  {loadingSignedFor === item.id ? '...' : t('dashboard.exports.refreshLink')}
                </button>

                {signedUrlById[item.id] ? (
                  <a
                    href={signedUrlById[item.id]}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700"
                    data-testid="exports-download"
                  >
                    {t('dashboard.exports.download')}
                  </a>
                ) : (
                  <button
                    disabled
                    className="px-3 py-1.5 rounded-lg bg-white/8 border border-white/14 text-white/55 text-xs font-medium"
                    data-testid="exports-download"
                  >
                    {t('dashboard.exports.download')}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
