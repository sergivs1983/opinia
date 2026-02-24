'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import type { ContentSuggestion } from '@/types/database';

type StudioLanguage = 'ca' | 'es' | 'en';
type StudioFormat = 'story' | 'feed';
type StudioTemplateId = 'quote-clean' | 'feature-split' | 'top3-reasons' | 'behind-scenes';
type StudioPlatform = 'x' | 'threads';
type StudioTone = 'professional' | 'friendly' | 'bold';

interface StudioModalProps {
  isOpen: boolean;
  bizId: string;
  suggestion: ContentSuggestion | null;
  initialFormat: StudioFormat;
  onClose: () => void;
}

interface RenderStudioResponse {
  assetId?: string;
  format?: StudioFormat;
  templateId?: StudioTemplateId;
  signedUrl?: string;
  request_id?: string;
  error?: string;
  message?: string;
}

interface GenerateXResponse {
  variants?: string[];
  request_id?: string;
  error?: string;
  message?: string;
}

const TEMPLATE_OPTIONS: StudioTemplateId[] = ['quote-clean', 'feature-split', 'top3-reasons', 'behind-scenes'];

export default function ContentStudioModal({
  isOpen,
  bizId,
  suggestion,
  initialFormat,
  onClose,
}: StudioModalProps) {
  const t = useT();
  const router = useRouter();

  const suggestionLanguage = useMemo<StudioLanguage>(() => {
    const value = suggestion?.language;
    if (value === 'es' || value === 'en') return value;
    return 'ca';
  }, [suggestion?.language]);

  const [format, setFormat] = useState<StudioFormat>(initialFormat);
  const [templateId, setTemplateId] = useState<StudioTemplateId>('quote-clean');
  const [platform, setPlatform] = useState<StudioPlatform>('x');
  const [tone, setTone] = useState<StudioTone>('friendly');

  const [rendering, setRendering] = useState(false);
  const [generatingX, setGeneratingX] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [variants, setVariants] = useState<string[]>([]);
  const [copiedVariant, setCopiedVariant] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFormat(initialFormat);
    setTemplateId('quote-clean');
    setPlatform('x');
    setTone('friendly');
    setPreviewUrl(null);
    setAssetId(null);
    setSavedToLibrary(false);
    setVariants([]);
    setCopiedVariant(null);
    setError(null);
  }, [isOpen, initialFormat, suggestion?.id]);

  if (!isOpen || !suggestion) return null;

  const activeSuggestion = suggestion;

  async function handleRender() {
    setRendering(true);
    setError(null);
    setSavedToLibrary(false);

    try {
      const response = await fetch('/api/content-studio/render', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': bizId,
        },
        body: JSON.stringify({
          suggestionId: activeSuggestion.id,
          format,
          templateId,
          language: suggestionLanguage,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as RenderStudioResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !payload.signedUrl || !payload.assetId) {
        const message = payload.message || t('dashboard.studio.errorRender');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setRendering(false);
        return;
      }

      setPreviewUrl(payload.signedUrl);
      setAssetId(payload.assetId);
      setSavedToLibrary(true);
      setRendering(false);
    } catch (renderError: unknown) {
      setError(renderError instanceof Error ? renderError.message : t('dashboard.studio.errorRender'));
      setRendering(false);
    }
  }

  async function handleGenerateXVariants() {
    setGeneratingX(true);
    setError(null);

    try {
      const response = await fetch('/api/content-studio/x-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-biz-id': bizId,
        },
        body: JSON.stringify({
          suggestionId: activeSuggestion.id,
          platform,
          language: suggestionLanguage,
          tone,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as GenerateXResponse;
      const requestId = payload.request_id || response.headers.get('x-request-id');

      if (!response.ok || payload.error || !Array.isArray(payload.variants)) {
        const message = payload.message || t('dashboard.studio.errorX');
        setError(requestId ? `${message} (ID: ${requestId})` : message);
        setGeneratingX(false);
        return;
      }

      setVariants(payload.variants);
      setGeneratingX(false);
    } catch (generateError: unknown) {
      setError(generateError instanceof Error ? generateError.message : t('dashboard.studio.errorX'));
      setGeneratingX(false);
    }
  }

  async function copyVariant(index: number, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedVariant(index);
    window.setTimeout(() => setCopiedVariant(null), 1200);
  }

  function downloadPreview() {
    if (!previewUrl) return;
    const filename = `studio-${format}-${new Date().toISOString().slice(0, 10)}.png`;
    const anchor = document.createElement('a');
    anchor.href = previewUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  function templateLabel(value: StudioTemplateId): string {
    if (value === 'quote-clean') return t('dashboard.studio.templateQuoteClean');
    if (value === 'feature-split') return t('dashboard.studio.templateFeatureSplit');
    if (value === 'top3-reasons') return t('dashboard.studio.templateTop3Reasons');
    return t('dashboard.studio.templateBehindScenes');
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl rounded-2xl border border-white/16 bg-[#070B14]/82 p-5 shadow-float backdrop-blur-xl md:p-6 max-h-[92vh] overflow-y-auto text-white/90"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-xl font-bold text-white/92">{t('dashboard.studio.title')}</h2>
            <p className="text-sm text-white/65 mt-1">{t('dashboard.studio.subtitle')}</p>
          </div>
          <Button variant="secondary" onClick={onClose} data-testid="studio-close-btn">{t('dashboard.studio.close')}</Button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/12 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {savedToLibrary && (
          <div className="mb-4 rounded-xl border border-emerald-300/35 bg-emerald-500/12 px-4 py-3 text-sm text-emerald-200 flex items-center justify-between gap-3">
            <span>{t('dashboard.studio.savedToLibrary')}</span>
            <button
              className="px-3 py-1.5 rounded-lg border border-emerald-300/45 text-xs font-medium hover:bg-emerald-400/18"
              onClick={() => router.push('/dashboard/studio')}
            >
              {t('dashboard.studio.viewStudio')}
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-4">
            <div className="glass-card p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm border ${format === 'story' ? 'bg-brand-50 border-brand-300 text-emerald-200' : 'bg-white/8 border-white/14 text-white/72'}`}
                  onClick={() => setFormat('story')}
                >
                  {t('dashboard.studio.formatStory')}
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm border ${format === 'feed' ? 'bg-brand-50 border-brand-300 text-emerald-200' : 'bg-white/8 border-white/14 text-white/72'}`}
                  onClick={() => setFormat('feed')}
                >
                  {t('dashboard.studio.formatFeed')}
                </button>
              </div>

              <label className="block text-sm text-white/72">
                {t('dashboard.studio.templateLabel')}
                <select
                  value={templateId}
                  onChange={(event) => setTemplateId(event.target.value as StudioTemplateId)}
                  className="glass-input mt-1 w-full px-3 py-2 text-sm"
                  data-testid="studio-template-picker"
                >
                  {TEMPLATE_OPTIONS.map((value) => (
                    <option key={value} value={value}>{templateLabel(value)}</option>
                  ))}
                </select>
              </label>

              <Button
                onClick={() => void handleRender()}
                loading={rendering}
                data-testid="studio-render-btn"
              >
                {rendering ? t('dashboard.studio.generatingPng') : t('dashboard.studio.generatePng')}
              </Button>

              {assetId && (
                <p className="text-xs text-white/58">{t('dashboard.studio.assetId')}: {assetId}</p>
              )}
            </div>

            {previewUrl && (
              <div className="glass-card p-4 space-y-3">
                <div className="text-sm font-medium text-white/82">{t('dashboard.studio.preview')}</div>
                <img
                  src={previewUrl}
                  alt="Studio preview"
                  className="w-full rounded-lg border border-white/16 bg-white/8"
                  data-testid="studio-preview"
                />
                <Button variant="secondary" onClick={downloadPreview} data-testid="studio-download-btn">
                  {t('dashboard.studio.downloadPng')}
                </Button>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="glass-card p-4 space-y-3">
              <h3 className="font-semibold text-white/92">{t('dashboard.studio.createXThreads')}</h3>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm text-white/72">
                  {t('dashboard.studio.platformLabel')}
                  <select
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value as StudioPlatform)}
                    className="glass-input mt-1 w-full px-3 py-2 text-sm"
                  >
                    <option value="x">X</option>
                    <option value="threads">Threads</option>
                  </select>
                </label>

                <label className="text-sm text-white/72">
                  {t('dashboard.studio.toneLabel')}
                  <select
                    value={tone}
                    onChange={(event) => setTone(event.target.value as StudioTone)}
                    className="glass-input mt-1 w-full px-3 py-2 text-sm"
                  >
                    <option value="friendly">{t('dashboard.studio.toneFriendly')}</option>
                    <option value="professional">{t('dashboard.studio.toneProfessional')}</option>
                    <option value="bold">{t('dashboard.studio.toneBold')}</option>
                  </select>
                </label>
              </div>

              <Button
                variant="secondary"
                onClick={() => void handleGenerateXVariants()}
                loading={generatingX}
                data-testid="studio-x-generate-btn"
              >
                {generatingX ? t('dashboard.studio.generatingVariants') : t('dashboard.studio.generateVariants')}
              </Button>
            </div>

            <div className="space-y-2">
              {variants.map((variant, index) => (
                <article key={`${variant}-${index}`} className="glass-card p-3" data-testid="studio-x-variant">
                  <p className="text-sm text-white/78 whitespace-pre-line">{variant}</p>
                  <div className="mt-2">
                    <button
                      className="px-3 py-1.5 rounded-lg border border-white/14 text-xs text-white/72 hover:bg-white/10"
                      onClick={() => void copyVariant(index, variant)}
                      data-testid="studio-x-copy"
                    >
                      {copiedVariant === index ? t('dashboard.studio.copied') : t('dashboard.studio.copy')}
                    </button>
                  </div>
                </article>
              ))}

              {variants.length === 0 && (
                <p className="text-sm text-white/62">{t('dashboard.studio.noVariants')}</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
