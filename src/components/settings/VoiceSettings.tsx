'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useT } from '@/components/i18n/I18nContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { glass, glassCard, glassInput, glassNoise, glassPill, glassSweep, textMain, textMuted, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { audit } from '@/lib/audit';
import { hasSeoSchemaColumns, markSeoSchemaMissingAudit } from '@/lib/seo-schema';
import type { BizSettingsProps } from './types';

type BrandImageKind = 'logo' | 'cover';

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
  const [brandKind, setBrandKind] = useState<BrandImageKind>(biz.brand_image_kind === 'cover' ? 'cover' : 'logo');
  const [brandFile, setBrandFile] = useState<File | null>(null);
  const [brandPreviewUrl, setBrandPreviewUrl] = useState<string | null>(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [seoCapabilities, setSeoCapabilities] = useState<SeoCapabilitiesPayload | null>(null);
  const [seoCapabilitiesLoading, setSeoCapabilitiesLoading] = useState(true);
  const [copiedMigrationCommand, setCopiedMigrationCommand] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
    setBrandKind(biz.brand_image_kind === 'cover' ? 'cover' : 'logo');
  }, [biz.brand_image_kind]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const signedUrl = await fetchBrandImageSignedUrlWithRetry(biz.id, 0);
      if (cancelled) return;
      setBrandPreviewUrl(signedUrl);
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
    setBrandSaved(false);
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
  };

  const handleBrandSave = async () => {
    if (!brandFile) {
      setBrandError(t('settings.voice.brandImageSelectFirst'));
      return;
    }

    setBrandSaving(true);
    setBrandSaved(false);
    setBrandError(null);

    try {
      const formData = new FormData();
      formData.set('kind', brandKind);
      formData.set('file', brandFile);

      const response = await fetch(`/api/businesses/${biz.id}/brand-image`, {
        method: 'POST',
        headers: { 'x-biz-id': biz.id },
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok || payload.error) {
        setBrandError(payload.message || t('settings.voice.brandImageErrorSave'));
        setBrandSaving(false);
        return;
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
      await onSaved();
      setBrandSaving(false);
      setBrandSaved(true);
      window.setTimeout(() => setBrandSaved(false), 2000);
    } catch {
      setBrandSaving(false);
      setBrandError(t('settings.voice.brandImageErrorSave'));
    }
  };

  const copyMigrationCommand = async () => {
    if (typeof window === 'undefined') return;
    const command = seoCapabilities?.migration?.command || 'supabase db push';
    await navigator.clipboard.writeText(command);
    setCopiedMigrationCommand(true);
    window.setTimeout(() => setCopiedMigrationCommand(false), 1400);
  };

  const handleSave = async () => {
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

    const { error } = await supabase.from('businesses').update(updatePayload).eq('id', biz.id);
    if (error) {
      console.warn('[voice-settings] save failed', error.message);
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

  return (
    <div className={cn(glassCard, glassNoise, glassSweep, 'space-y-5 p-6 max-w-2xl')} data-testid="settings-voice-panel">
      <Input
        label={t('settings.voice.signature')}
        value={signature}
        onChange={e => setSignature(e.target.value)}
        data-testid="settings-signature"
      />
      <div>
        <label className={cn('block text-sm font-medium mb-1', textSub)}>{t('settings.voice.instructions')}</label>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
          placeholder={t('settings.voice.instructionsPlaceholder')}
          className={cn(glassInput, 'w-full min-h-[100px] px-4 py-3 text-sm resize-y')} />
      </div>
      <Input label={t('settings.voice.posKeywords')} value={posKeywords} onChange={e => setPosKeywords(e.target.value)} placeholder={t('settings.voice.posPlaceholder')} />
      <Input label={t('settings.voice.negKeywords')} value={negKeywords} onChange={e => setNegKeywords(e.target.value)} placeholder={t('settings.voice.negPlaceholder')} />

      {/* AI Engine — provider abstracted */}
      <div className={cn(glass, glassNoise, glassSweep, 'flex items-center gap-3 py-3 px-4')}>
        <span className="text-lg">🤖</span>
        <div>
          <p className={cn('text-sm font-medium', textMain)}>OpinIA AI</p>
          <p className={cn('text-xs', textMuted)}>{t('settings.voice.aiEngineDesc')}</p>
        </div>
      </div>

      {/* SEO & Visibility */}
      <div className="border-t glass-divider pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={cn('text-sm font-semibold', textMain)}>🔍 {t('settings.voice.seo')}</h3>
              {seoSchemaMissing && (
                <span
                  data-testid="settings-seo-schema-missing-badge"
                  className="inline-flex items-center rounded-full border border-amber-300/45 bg-amber-500/12 px-2 py-0.5 text-[10px] font-semibold text-amber-200"
                >
                  SEO no disponible en aquest entorn
                </span>
              )}
            </div>
            <p className={cn('text-xs mt-0.5', textMuted)}>{t('settings.voice.seoDesc')}</p>
            {seoSchemaMissing && (
              <p className="text-xs text-amber-200 mt-1" data-testid="settings-seo-fallback-note">
                Es manté el fallback de compatibilitat, però els controls SEO estan desactivats fins migrar l&apos;schema.
              </p>
            )}
          </div>
          <button
            onClick={() => setSeoMode(!seoMode)}
            data-testid="settings-seo-toggle"
            aria-pressed={seoMode}
            disabled={seoSchemaMissing}
            className={cn(
              'relative w-12 h-6 rounded-full transition-colors duration-[220ms] ease-premium',
              seoMode ? 'bg-brand-500' : 'bg-white/20',
              seoSchemaMissing && 'cursor-not-allowed opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/40'
            )}>
            <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', seoMode ? 'translate-x-6' : 'translate-x-0.5')} />
          </button>
        </div>

        {seoSchemaMissing && (
          <div className={cn(glass, glassNoise, 'border-amber-300/40 p-3 space-y-2')} data-testid="settings-seo-migration-callout">
            <p className="text-xs text-amber-200">
              Falten columnes SEO a `businesses`. Activa-les amb les migracions del projecte.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void copyMigrationCommand()}
                className={cn(glassPill, 'px-2.5 py-1 text-xs hover:bg-white/14')}
                data-testid="settings-seo-run-migration"
              >
                {copiedMigrationCommand ? 'Command copied' : 'Run migration'}
              </button>
              <code className="text-[11px] text-white/72">{seoCapabilities?.migration?.command || 'supabase db push'}</code>
            </div>
            {seoCapabilities?.migration?.files?.length ? (
              <p className="text-[11px] text-white/62">
                Files: {seoCapabilities.migration.files.join(', ')}
              </p>
            ) : null}
          </div>
        )}

        {(seoMode || seoSchemaMissing) && (
          <>
            <Input
              label={t('settings.voice.seoKeywords')}
              value={seoKeywords}
              onChange={e => setSeoKeywords(e.target.value)}
              placeholder={t('settings.voice.seoKeywordsPlaceholder')}
              data-testid="settings-seo-keywords"
              disabled={seoSchemaMissing}
            />
            <div>
              <label className={cn('block text-sm font-medium mb-2', textSub)}>
                {t('settings.voice.seoIntensity')}: {seoLevels[seoMaxKw] || seoMaxKw}
                <span className={cn('text-xs ml-2', textMuted)}>
                  ({t('settings.voice.seoMaxKw', { n: seoMaxKw })})
                </span>
              </label>
              <input
                type="range" min={1} max={3} value={seoMaxKw}
                onChange={e => setSeoMaxKw(Number(e.target.value))}
                disabled={seoSchemaMissing}
                className="w-full h-2 bg-white/12 rounded-lg appearance-none cursor-pointer accent-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className={cn('flex justify-between text-[10px] mt-1', textMuted)}>
                <span>{seoLevels[1]}</span><span>{seoLevels[2]}</span><span>{seoLevels[3]}</span>
              </div>
            </div>

            {/* Advanced SEO rules */}
            <div className="border-t glass-divider pt-3 space-y-3">
              <p className={cn('text-[10px] uppercase font-bold tracking-wider', textMuted)}>Advanced</p>
              <label className={cn('flex items-center gap-2 text-sm cursor-pointer', textSub)}>
                <input type="checkbox" checked={seoAvoidNeg} onChange={e => setSeoAvoidNeg(e.target.checked)}
                  disabled={seoSchemaMissing}
                  className="rounded border-white/20 bg-white/10 text-brand-600 focus:ring-brand-500" />
                Skip SEO keywords on negative reviews
              </label>
              <div className="flex items-center gap-3">
                <label className={cn('text-sm', textSub)}>Min rating for keywords:</label>
                <select value={seoMinRating} onChange={e => setSeoMinRating(Number(e.target.value))}
                  disabled={seoSchemaMissing}
                  className={cn(glassInput, 'px-3 py-1.5 text-sm')}>
                  <option value={1}>1+</option>
                  <option value={2}>2+</option>
                  <option value={3}>3+</option>
                  <option value={4}>4+</option>
                  <option value={5}>5 only</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-white/10 pt-5 space-y-3">
        <div>
          <h3 className={cn('text-sm font-semibold', textMain)}>🖼️ {t('settings.voice.brandImageTitle')}</h3>
          <p className={cn('text-xs mt-0.5', textMuted)}>{t('settings.voice.brandImageDesc')}</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <select
            value={brandKind}
            onChange={(event) => setBrandKind(event.target.value === 'cover' ? 'cover' : 'logo')}
            className={cn(glassInput, 'px-3 py-2 text-sm')}
            data-testid="business-brand-kind"
          >
            <option value="logo">{t('settings.voice.brandImageLogo')}</option>
            <option value="cover">{t('settings.voice.brandImageCover')}</option>
          </select>

          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => handleBrandFileChange(event.target.files?.[0] || null)}
            data-testid="business-brand-upload"
            className={cn('block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50/50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-emerald-200', textSub)}
          />

          <Button
            onClick={handleBrandSave}
            loading={brandSaving}
            data-testid="business-brand-save"
            disabled={!brandFile}
          >
            {t('common.save')}
          </Button>
        </div>

        <div className={cn(glass, glassNoise, 'flex items-center gap-3 p-3')}>
          {brandPreviewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={brandPreviewUrl}
              alt="Business brand image"
              className="h-14 w-14 rounded-xl border border-white/20 object-cover"
              data-testid="business-brand-preview"
            />
          ) : (
            <div
              className="h-14 w-14 rounded-xl border border-dashed border-white/25 bg-white/6 text-white/62 flex items-center justify-center text-xs"
              data-testid="business-brand-preview"
            >
              {biz.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className={cn('text-xs', textMuted)}>
            <p>{t('settings.voice.brandImageFormats')}</p>
            <p>{t('settings.voice.brandImageMaxSize')}</p>
          </div>
        </div>

        {brandError && <p className="text-xs text-rose-300">{brandError}</p>}
        {brandSaved && <p className="text-xs text-emerald-300">✅ {t('settings.voice.brandImageSaved')}</p>}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={saving} data-testid="settings-save">{t('settings.voice.saveChanges')}</Button>
        {saved && <span className="text-sm text-emerald-300 font-medium animate-fade-in" data-testid="settings-saved-indicator">✅ {t('common.saved')}</span>}
      </div>
    </div>
  );
}
