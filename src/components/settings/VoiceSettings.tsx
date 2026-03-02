'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { glassPill } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { audit } from '@/lib/audit';
import { hasSeoSchemaColumns, markSeoSchemaMissingAudit } from '@/lib/seo-schema';
import type { BizSettingsProps } from './types';

type LocalVoiceState = {
  seoMode?: boolean;
  seoMaxKw?: number;
  seoAvoidNeg?: boolean;
  seoMinRating?: number;
  seoKeywords?: string;
};

type SeoCapabilitiesPayload = {
  available?: boolean;
  columns?: {
    seo_enabled?: boolean;
    seo_keywords?: boolean;
    seo_aggressivity?: boolean;
    seo_aggressiveness?: boolean;
  };
  migration?: {
    files?: string[];
    command?: string;
    docs?: string;
  } | null;
  request_id?: string;
  error?: string;
  message?: string;
};

async function fetchBrandImageSignedUrlWithRetry(businessId: string, attempt: number = 0): Promise<string | null> {
  try {
    const response = await fetch(`/api/businesses/${businessId}/brand-image/signed-url`, {
      headers: { 'x-biz-id': businessId },
    });
    const payload = (await response.json().catch(() => ({}))) as {
      url?: string | null;
      signedUrl?: string | null;
    };

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 404) return null;
      return null;
    }

    if (typeof payload.url === 'string') return payload.url;
    if (typeof payload.signedUrl === 'string') return payload.signedUrl;
    return null;
  } catch (error: unknown) {
    if (attempt < 1 && error instanceof TypeError) {
      return fetchBrandImageSignedUrlWithRetry(businessId, attempt + 1);
    }
    return null;
  }
}

const BRAND_MAX_BYTES = 4 * 1024 * 1024;
const BRAND_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function normalizeKeywordSource(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

export default function VoiceSettings({ biz, onSaved }: BizSettingsProps) {
  const t = useT();
  const bizRecord = biz as unknown as Record<string, unknown>;
  const [signature, setSignature] = useState(biz.default_signature);
  const [instructions, setInstructions] = useState(biz.ai_instructions || '');
  const [posKeywords, setPosKeywords] = useState((biz.tone_keywords_positive || []).join(', '));
  const [negKeywords, setNegKeywords] = useState((biz.tone_keywords_negative || []).join(', '));
  const seoAggressivityValue = typeof bizRecord.seo_aggressivity === 'number'
    ? Number(bizRecord.seo_aggressivity)
    : undefined;
  // SEO — use new fields with fallback to old
  const seoRules = biz.seo_rules || { max_keywords_per_reply: 2, avoid_if_negative: true, min_rating_for_keywords: 4 };
  const [seoMode, setSeoMode] = useState(biz.seo_enabled ?? biz.seo_mode ?? false);
  const [seoMaxKw, setSeoMaxKw] = useState(
    seoRules.max_keywords_per_reply ?? seoAggressivityValue ?? biz.seo_aggressiveness ?? 2
  );
  const [seoAvoidNeg, setSeoAvoidNeg] = useState(seoRules.avoid_if_negative ?? true);
  const [seoMinRating, setSeoMinRating] = useState(seoRules.min_rating_for_keywords ?? 4);
  const [seoKeywords, setSeoKeywords] = useState(
    [...new Set([
      ...normalizeKeywordSource(bizRecord.seo_keywords),
      ...normalizeKeywordSource(bizRecord.target_keywords),
    ])].join(', ')
  );
  const [brandFile, setBrandFile] = useState<File | null>(null);
  const [brandMarkedForRemoval, setBrandMarkedForRemoval] = useState(false);
  const [brandPreviewUrl, setBrandPreviewUrl] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [seoCapabilities, setSeoCapabilities] = useState<SeoCapabilitiesPayload | null>(null);
  const [seoCapabilitiesLoading, setSeoCapabilitiesLoading] = useState(true);
  const [copiedMigrationCommand, setCopiedMigrationCommand] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const brandFileInputRef = useRef<HTMLInputElement | null>(null);
  const objectPreviewRef = useRef<string | null>(null);
  const supabase = createClient();
  const localKey = `opinia.voice.settings.${biz.id}`;
  const localSeoSchemaMissing = typeof biz.seo_enabled === 'undefined' || !hasSeoSchemaColumns(bizRecord);
  const seoSchemaMissing = seoCapabilities ? !seoCapabilities.available : localSeoSchemaMissing;
  const hasColumn = (name: string) => Object.prototype.hasOwnProperty.call(bizRecord, name);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(localKey);
      if (!raw) return;
      const local = JSON.parse(raw) as LocalVoiceState;

      if (typeof local.seoMode === 'boolean') setSeoMode(local.seoMode);
      if (typeof local.seoMaxKw === 'number') setSeoMaxKw(local.seoMaxKw);
      if (typeof local.seoAvoidNeg === 'boolean') setSeoAvoidNeg(local.seoAvoidNeg);
      if (typeof local.seoMinRating === 'number') setSeoMinRating(local.seoMinRating);
      if (typeof local.seoKeywords === 'string') setSeoKeywords(local.seoKeywords);
    } catch {
      // ignore invalid local cache
    }
  }, [localKey]);

  useEffect(() => {
    let cancelled = false;
    setSeoCapabilitiesLoading(true);

    void (async () => {
      try {
        const response = await fetch('/api/seo/capabilities', {
          headers: { 'x-biz-id': biz.id },
        });
        const payload = (await response.json().catch(() => ({}))) as SeoCapabilitiesPayload;
        if (cancelled) return;

        if (!response.ok || payload.error) {
          setSeoCapabilities(null);
          setSeoCapabilitiesLoading(false);
          return;
        }

        setSeoCapabilities(payload);
        setSeoCapabilitiesLoading(false);
      } catch {
        if (!cancelled) {
          setSeoCapabilities(null);
          setSeoCapabilitiesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [biz.id]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const signedUrl = await fetchBrandImageSignedUrlWithRetry(biz.id, 0);
      if (cancelled) return;
      setBrandPreviewUrl(signedUrl);
      setBrandMarkedForRemoval(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [biz.id]);

  useEffect(() => {
    return () => {
      if (objectPreviewRef.current) {
        URL.revokeObjectURL(objectPreviewRef.current);
        objectPreviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (seoCapabilitiesLoading) return;
    if (!seoSchemaMissing) return;
    if (!markSeoSchemaMissingAudit(window.localStorage, biz.org_id)) return;

    let cancelled = false;
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      await audit(supabase, {
        orgId: biz.org_id,
        bizId: biz.id,
        userId: user.id,
        action: 'SEO_SCHEMA_MISSING',
        metadata: { source: 'voice_settings' },
      });
    })();

    return () => { cancelled = true; };
  }, [biz.id, biz.org_id, seoCapabilitiesLoading, seoSchemaMissing, supabase]);

  const handleBrandFileChange = (file: File | null) => {
    setBrandError(null);

    if (!file) {
      setBrandFile(null);
      return;
    }

    if (!BRAND_ALLOWED_TYPES.has(file.type)) {
      setBrandError(t('settings.voice.brandImageErrorType'));
      setBrandFile(null);
      return;
    }

    if (file.size > BRAND_MAX_BYTES) {
      setBrandError(t('settings.voice.brandImageErrorSize'));
      setBrandFile(null);
      return;
    }

    if (objectPreviewRef.current) {
      URL.revokeObjectURL(objectPreviewRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    objectPreviewRef.current = objectUrl;
    setBrandPreviewUrl(objectUrl);
    setBrandFile(file);
    setBrandMarkedForRemoval(false);
  };

  const uploadBrandFile = async (file: File) => {
    setBrandError(null);
    try {
      const formData = new FormData();
      formData.set('kind', 'logo');
      formData.set('file', file);

      const response = await fetch(`/api/businesses/${biz.id}/brand-image`, {
        method: 'POST',
        headers: { 'x-biz-id': biz.id },
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok || payload.error) {
        setBrandError(payload.message || t('settings.voice.brandImageErrorSave'));
        return false;
      }

      const refreshedSignedUrl = await fetchBrandImageSignedUrlWithRetry(biz.id, 0);
      if (refreshedSignedUrl) {
        if (objectPreviewRef.current) {
          URL.revokeObjectURL(objectPreviewRef.current);
          objectPreviewRef.current = null;
        }
        setBrandPreviewUrl(refreshedSignedUrl);
      }

      setBrandFile(null);
      setBrandMarkedForRemoval(false);
      return true;
    } catch {
      setBrandError(t('settings.voice.brandImageErrorSave'));
      return false;
    }
  };

  const openBrandFilePicker = () => {
    const input = brandFileInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };

  const clearBrandSelection = () => {
    setBrandError(null);
    const shouldRemovePersistedLogo = Boolean((biz.brand_image_path || '').trim());
    setBrandFile(null);
    if (objectPreviewRef.current) {
      URL.revokeObjectURL(objectPreviewRef.current);
      objectPreviewRef.current = null;
    }
    setBrandPreviewUrl(null);
    setBrandMarkedForRemoval(shouldRemovePersistedLogo);
  };

  const copyMigrationCommand = async () => {
    if (typeof window === 'undefined') return;
    const command = seoCapabilities?.migration?.command || 'supabase db push';
    await navigator.clipboard.writeText(command);
    setCopiedMigrationCommand(true);
    window.setTimeout(() => setCopiedMigrationCommand(false), 1400);
  };

  const handleSave = async () => {
    setBrandError(null);
    setSaving(true);
    const kwArr = seoKeywords.split(',').map(s => s.trim()).filter(Boolean);
    const updatePayload: Record<string, unknown> = {
      default_signature: signature,
      ai_instructions: instructions || null,
    };

    if (hasColumn('tone_keywords_positive')) {
      updatePayload.tone_keywords_positive = posKeywords.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (hasColumn('tone_keywords_negative')) {
      updatePayload.tone_keywords_negative = negKeywords.split(',').map(s => s.trim()).filter(Boolean);
    }
    if (hasColumn('seo_mode')) updatePayload.seo_mode = seoMode;
    if (hasColumn('seo_enabled')) updatePayload.seo_enabled = seoMode;
    if (hasColumn('seo_aggressiveness')) updatePayload.seo_aggressiveness = seoMaxKw;
    if (hasColumn('seo_aggressivity')) updatePayload.seo_aggressivity = seoMaxKw;
    if (hasColumn('target_keywords')) {
      updatePayload.target_keywords = typeof bizRecord.target_keywords === 'string' ? kwArr.join(', ') : kwArr;
    }
    if (hasColumn('seo_keywords')) {
      updatePayload.seo_keywords = typeof bizRecord.seo_keywords === 'string' ? kwArr.join(', ') : kwArr;
    }
    if (hasColumn('seo_rules')) {
      updatePayload.seo_rules = {
        max_keywords_per_reply: seoMaxKw,
        avoid_if_negative: seoAvoidNeg,
        min_rating_for_keywords: seoMinRating,
      };
    }

    if (brandMarkedForRemoval && !brandFile) {
      if (hasColumn('brand_image_path')) updatePayload.brand_image_path = null;
      if (hasColumn('brand_image_bucket')) updatePayload.brand_image_bucket = null;
      if (hasColumn('brand_image_kind')) updatePayload.brand_image_kind = 'logo';
      if (hasColumn('brand_image_updated_at')) updatePayload.brand_image_updated_at = new Date().toISOString();
    }

    const { error } = await supabase.from('businesses').update(updatePayload).eq('id', biz.id);
    if (error) {
      console.warn('[voice-settings] save failed', error.message);
      setSaving(false);
      return;
    }

    if (brandFile) {
      const uploaded = await uploadBrandFile(brandFile);
      if (!uploaded) {
        setSaving(false);
        return;
      }
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(localKey, JSON.stringify({
        seoMode,
        seoMaxKw,
        seoAvoidNeg,
        seoMinRating,
        seoKeywords,
      }));
    }

    await onSaved();
    if (!brandFile && !brandMarkedForRemoval) {
      const refreshedSignedUrl = await fetchBrandImageSignedUrlWithRetry(biz.id, 0);
      setBrandPreviewUrl(refreshedSignedUrl);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const seoLevels: string[] = (() => {
    try {
      const raw = t('settings.voice.seoLevels');
      return typeof raw === 'string' ? ['—', raw] : ['—', 'Suau', 'Mitjà', 'Alt'];
    } catch { return ['—', 'Suau', 'Mitjà', 'Alt']; }
  })();
  const showSeoDevMigrationBanner = seoSchemaMissing && process.env.NODE_ENV !== 'production';
  const showSeoUnavailableBanner = seoSchemaMissing && process.env.NODE_ENV === 'production';
  const persistedBrandName = (() => {
    if (typeof biz.brand_image_path !== 'string') return '';
    const lastSegment = (biz.brand_image_path.split('/').pop() || '').trim();
    if (!lastSegment) return '';
    try {
      return decodeURIComponent(lastSegment);
    } catch {
      return lastSegment;
    }
  })();
  const displayedBrandFileName = (brandFile?.name || persistedBrandName || '').trim();
  const hasBrandSelected = Boolean(brandFile || brandPreviewUrl);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-sm" data-testid="settings-voice-panel">
      <div className="divide-y divide-black/10">
        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t('settings.voice.signature')}</p>
            <p className="text-sm text-zinc-500">Text final que afegim automàticament a les respostes.</p>
          </div>
          <Input
            value={signature}
            onChange={e => setSignature(e.target.value)}
            data-testid="settings-signature"
            className="border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400"
          />
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr]">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t('settings.voice.instructions')}</p>
            <p className="text-sm text-zinc-500">Context de marca i estil que ha de seguir LITO.</p>
          </div>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={t('settings.voice.instructionsPlaceholder')}
            className="min-h-[104px] w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500/45 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t('settings.voice.posKeywords')}</p>
            <p className="text-sm text-zinc-500">Paraules clau associades a sentiment positiu.</p>
          </div>
          <Input
            value={posKeywords}
            onChange={e => setPosKeywords(e.target.value)}
            placeholder={t('settings.voice.posPlaceholder')}
            className="border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400"
          />
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t('settings.voice.negKeywords')}</p>
            <p className="text-sm text-zinc-500">Paraules clau associades a sentiment negatiu.</p>
          </div>
          <Input
            value={negKeywords}
            onChange={e => setNegKeywords(e.target.value)}
            placeholder={t('settings.voice.negPlaceholder')}
            className="border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400"
          />
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
          <div>
            <p className="text-sm font-medium text-zinc-900">Motor d&apos;IA</p>
            <p className="text-sm text-zinc-500">{t('settings.voice.aiEngineDesc')}</p>
          </div>
          <div className="rounded-xl border border-black/10 bg-zinc-50 px-3 py-2.5">
            <p className="text-sm font-medium text-zinc-900">OpinIA AI</p>
          </div>
        </div>

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
          <div>
            <p className="text-sm font-medium text-zinc-900">SEO</p>
            <p className="text-sm text-zinc-500">{t('settings.voice.seoDesc')}</p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-black/10 bg-zinc-50 px-3 py-2">
            <span className="text-sm text-zinc-700">{seoMode ? 'Activat' : 'Desactivat'}</span>
            <button
              onClick={() => setSeoMode(!seoMode)}
              data-testid="settings-seo-toggle"
              aria-pressed={seoMode}
              disabled={seoSchemaMissing}
              className={cn(
                'relative h-6 w-12 rounded-full transition-colors duration-[220ms] ease-premium',
                seoMode ? 'bg-brand-500' : 'bg-zinc-300',
                seoSchemaMissing && 'cursor-not-allowed opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40'
              )}
            >
              <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', seoMode ? 'translate-x-6' : 'translate-x-0.5')} />
            </button>
          </div>
        </div>

        {showSeoDevMigrationBanner && (
          <div className="px-5 py-4">
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" data-testid="settings-seo-migration-callout">
              <p data-testid="settings-seo-fallback-note">Falten columnes SEO a `businesses`. Cal aplicar la migració.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copyMigrationCommand()}
                  className={cn(glassPill, 'border border-black/10 bg-white px-2.5 py-1 text-xs text-zinc-700')}
                  data-testid="settings-seo-run-migration"
                >
                  {copiedMigrationCommand ? 'Command copied' : 'Run migration'}
                </button>
                <code className="text-[11px] text-zinc-700">{seoCapabilities?.migration?.command || 'supabase db push'}</code>
              </div>
            </div>
          </div>
        )}

        {showSeoUnavailableBanner && (
          <div className="px-5 py-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-600">
              SEO no disponible en aquest entorn.
            </div>
          </div>
        )}

        {(seoMode || seoSchemaMissing) && (
          <>
            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">{t('settings.voice.seoKeywords')}</p>
                <p className="text-sm text-zinc-500">Keywords prioritzades a les respostes.</p>
              </div>
              <Input
                value={seoKeywords}
                onChange={e => setSeoKeywords(e.target.value)}
                placeholder={t('settings.voice.seoKeywordsPlaceholder')}
                data-testid="settings-seo-keywords"
                disabled={seoSchemaMissing}
                className="border-black/10 bg-white text-zinc-900 placeholder:text-zinc-400"
              />
            </div>

            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr]">
              <div>
                <p className="text-sm font-medium text-zinc-900">{t('settings.voice.seoIntensity')}</p>
                <p className="text-sm text-zinc-500">{t('settings.voice.seoMaxKw', { n: seoMaxKw })}</p>
              </div>
              <div>
                <p className="mb-2 text-sm text-zinc-700">{seoLevels[seoMaxKw] || seoMaxKw}</p>
                <input
                  type="range"
                  min={1}
                  max={3}
                  value={seoMaxKw}
                  onChange={e => setSeoMaxKw(Number(e.target.value))}
                  disabled={seoSchemaMissing}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-center">
              <div>
                <p className="text-sm font-medium text-zinc-900">Regles avançades</p>
                <p className="text-sm text-zinc-500">Control sobre context negatiu i llindar de rating.</p>
              </div>
              <div className="space-y-3 rounded-xl border border-black/10 bg-zinc-50 p-3">
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={seoAvoidNeg}
                    onChange={e => setSeoAvoidNeg(e.target.checked)}
                    disabled={seoSchemaMissing}
                    className="rounded border-zinc-300 bg-white text-brand-600"
                  />
                  Ometre keywords SEO en ressenyes negatives
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-zinc-700">Rating mínim:</label>
                  <select
                    value={seoMinRating}
                    onChange={e => setSeoMinRating(Number(e.target.value))}
                    disabled={seoSchemaMissing}
                    className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-zinc-800"
                  >
                    <option value={1}>1+</option>
                    <option value={2}>2+</option>
                    <option value={3}>3+</option>
                    <option value={4}>4+</option>
                    <option value={5}>5 only</option>
                  </select>
                </div>
              </div>
            </div>
          </>
        )}

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_1fr] md:items-start">
          <div>
            <p className="text-sm font-medium text-zinc-900">Logo del negoci</p>
            <p className="text-sm text-zinc-500">PNG/JPG/WEBP · fins a 4 MB</p>
          </div>
          <div className="space-y-3 rounded-xl border border-black/10 bg-zinc-50 p-3">
            <input
              ref={brandFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleBrandFileChange(event.target.files?.[0] || null)}
              data-testid="business-brand-upload"
              className="hidden"
            />

            {!hasBrandSelected ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-zinc-500">Cap fitxer seleccionat</p>
                <button
                  type="button"
                  onClick={openBrandFilePicker}
                  className="inline-flex items-center rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                >
                  Pujar fitxer
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-black/10 bg-white p-3">
                <div className="flex min-w-0 items-center gap-3">
                  {brandPreviewUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={brandPreviewUrl}
                      alt="Logo del negoci"
                      className="h-12 w-12 rounded-lg border border-black/10 object-cover"
                      data-testid="business-brand-preview"
                    />
                  ) : (
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-black/20 bg-zinc-50 text-xs text-zinc-500"
                      data-testid="business-brand-preview"
                    >
                      {biz.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p className="truncate text-sm text-zinc-700">
                    {displayedBrandFileName || 'Logo del negoci'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openBrandFilePicker}
                    className="inline-flex items-center rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100"
                  >
                    Canviar
                  </button>
                  <button
                    type="button"
                    onClick={clearBrandSelection}
                    className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-100"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            )}

            {brandError && <p className="text-xs text-rose-600">{brandError}</p>}
          </div>
        </div>
      </div>

      <div className="border-t border-black/10 bg-zinc-50/70 px-5 py-3">
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} loading={saving} data-testid="settings-save">{t('settings.voice.saveChanges')}</Button>
          {saved ? (
            <span className="text-sm font-medium text-emerald-700 animate-fade-in" data-testid="settings-saved-indicator">
              ✅ {t('common.saved')}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
