'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLocale } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import {
  DEFAULT_BUSINESS_MEMORY,
  splitCommaSeparatedInput,
  type BrandVoiceFormality,
  type BusinessMemoryPayload,
} from '@/lib/lito/brand-brain';

type LocaleKey = 'ca' | 'es' | 'en';

type BrandBrainPanelProps = {
  bizId: string | null;
};

type BrandBrainApiResponse = {
  ok?: boolean;
  memory?: {
    id?: string;
    biz_id?: string;
    brand_voice?: unknown;
    policies?: unknown;
    business_facts?: unknown;
    updated_at?: string;
    updated_by?: string | null;
  };
  can_edit?: boolean;
  role?: 'owner' | 'manager' | 'staff' | null;
  error?: string;
  message?: string;
};

type LocalCopy = {
  title: string;
  subtitle: string;
  loading: string;
  save: string;
  saved: string;
  readOnly: string;
  tone: string;
  keywords: string;
  avoid: string;
  neverMention: string;
  offers: string;
  addOffer: string;
  offerPlaceholder: string;
  commaHint: string;
  formality: string;
  tu: string;
  voste: string;
  mixt: string;
  expand: string;
  collapse: string;
  noBiz: string;
  saveError: string;
};

const COPY: Record<LocaleKey, LocalCopy> = {
  ca: {
    title: '🧠 Context del negoci',
    subtitle: 'Ajusta el to, paraules clau i ofertes perquè LITO soni com tu.',
    loading: 'Carregant context…',
    save: 'Desar',
    saved: 'Desat',
    readOnly: 'Només gestors poden editar',
    tone: 'To (coma separada)',
    keywords: 'Paraules clau',
    avoid: 'Evitar',
    neverMention: 'Mai mencionar',
    offers: 'Ofertes actuals',
    addOffer: 'Afegir oferta',
    offerPlaceholder: 'Ex: Menú migdia 12,90€',
    commaHint: 'Separat per comes',
    formality: 'Formalitat',
    tu: 'Tu',
    voste: 'Vostè',
    mixt: 'Mixt',
    expand: 'Obrir',
    collapse: 'Tancar',
    noBiz: 'Selecciona un negoci per veure el context.',
    saveError: 'No s’ha pogut desar',
  },
  es: {
    title: '🧠 Contexto del negocio',
    subtitle: 'Ajusta tono, palabras clave y ofertas para que LITO suene como tu marca.',
    loading: 'Cargando contexto…',
    save: 'Guardar',
    saved: 'Guardado',
    readOnly: 'Solo gestores pueden editar',
    tone: 'Tono (separado por comas)',
    keywords: 'Palabras clave',
    avoid: 'Evitar',
    neverMention: 'Nunca mencionar',
    offers: 'Ofertas actuales',
    addOffer: 'Añadir oferta',
    offerPlaceholder: 'Ej: Menú mediodía 12,90€',
    commaHint: 'Separado por comas',
    formality: 'Formalidad',
    tu: 'Tú',
    voste: 'Usted',
    mixt: 'Mixto',
    expand: 'Abrir',
    collapse: 'Cerrar',
    noBiz: 'Selecciona un negocio para ver el contexto.',
    saveError: 'No se pudo guardar',
  },
  en: {
    title: '🧠 Business context',
    subtitle: 'Tune tone, keywords and offers so LITO matches your brand.',
    loading: 'Loading context…',
    save: 'Save',
    saved: 'Saved',
    readOnly: 'Only owners/managers can edit',
    tone: 'Tone (comma separated)',
    keywords: 'Keywords',
    avoid: 'Avoid',
    neverMention: 'Never mention',
    offers: 'Current offers',
    addOffer: 'Add offer',
    offerPlaceholder: 'e.g. Lunch menu 12.90€',
    commaHint: 'Comma separated',
    formality: 'Formality',
    tu: 'Informal',
    voste: 'Formal',
    mixt: 'Mixed',
    expand: 'Open',
    collapse: 'Close',
    noBiz: 'Select a business to load context.',
    saveError: 'Could not save',
  },
};

function resolveLocale(locale: string): LocaleKey {
  if (locale.startsWith('ca')) return 'ca';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    const next = cleanText(raw, maxLen);
    if (!next) continue;
    const key = next.toLocaleLowerCase('ca');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeMemory(raw: unknown): BusinessMemoryPayload {
  const root = asObject(raw);
  const voice = asObject(root.brand_voice);
  const policies = asObject(root.policies);
  const facts = asObject(root.business_facts);

  const formality = voice.formality === 'tu' || voice.formality === 'voste' || voice.formality === 'mixt'
    ? voice.formality
    : 'mixt';
  const responseTime = typeof policies.response_time_h === 'number' && Number.isFinite(policies.response_time_h)
    ? Math.max(1, Math.min(168, Math.floor(policies.response_time_h)))
    : DEFAULT_BUSINESS_MEMORY.policies.response_time_h;
  const maxWords = typeof policies.max_length_words === 'number' && Number.isFinite(policies.max_length_words)
    ? Math.max(20, Math.min(300, Math.floor(policies.max_length_words)))
    : DEFAULT_BUSINESS_MEMORY.policies.max_length_words;
  const primaryFocus = policies.primary_focus === 'reviews'
    || policies.primary_focus === 'social'
    || policies.primary_focus === 'both'
    ? policies.primary_focus
    : DEFAULT_BUSINESS_MEMORY.policies.primary_focus;

  return {
    brand_voice: {
      tone: cleanStringArray(voice.tone, 12, 48),
      formality: formality as BrandVoiceFormality,
      avoid: cleanStringArray(voice.avoid, 16, 60),
      keywords: cleanStringArray(voice.keywords, 20, 40),
      examples: cleanStringArray(voice.examples, 8, 220),
    },
    policies: {
      require_approval: typeof policies.require_approval === 'boolean'
        ? policies.require_approval
        : DEFAULT_BUSINESS_MEMORY.policies.require_approval,
      response_time_h: responseTime,
      never_mention: cleanStringArray(policies.never_mention, 16, 80),
      max_length_words: maxWords,
      primary_focus: primaryFocus,
    },
    business_facts: {
      services: cleanStringArray(facts.services, 20, 80),
      hours: cleanStringArray(facts.hours, 14, 120),
      location_notes: cleanText(facts.location_notes, 280),
      seasonal_peaks: cleanStringArray(facts.seasonal_peaks, 12, 80),
      current_offers: cleanStringArray(facts.current_offers, 12, 120),
      faqs: cleanStringArray(facts.faqs, 16, 220),
    },
  };
}

function toCsv(values: string[]): string {
  return values.join(', ');
}

export default function BrandBrainPanel({ bizId }: BrandBrainPanelProps) {
  const locale = useLocale();
  const { toast } = useToast();
  const lang = useMemo(() => resolveLocale(locale), [locale]);
  const copy = COPY[lang];

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [memory, setMemory] = useState<BusinessMemoryPayload>(DEFAULT_BUSINESS_MEMORY);
  const [toneText, setToneText] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [avoidText, setAvoidText] = useState('');
  const [neverMentionText, setNeverMentionText] = useState('');
  const [offerInput, setOfferInput] = useState('');
  const [offers, setOffers] = useState<string[]>([]);

  const loadMemory = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/business-memory?biz_id=${encodeURIComponent(bizId)}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store',
        },
      });
      if (!response.ok) throw new Error('business_memory_fetch_failed');
      const payload = await response.json() as BrandBrainApiResponse;
      const normalized = normalizeMemory(payload.memory || {});
      setMemory(normalized);
      setCanEdit(Boolean(payload.can_edit));
      setToneText(toCsv(normalized.brand_voice.tone));
      setKeywordsText(toCsv(normalized.brand_voice.keywords));
      setAvoidText(toCsv(normalized.brand_voice.avoid));
      setNeverMentionText(toCsv(normalized.policies.never_mention));
      setOffers(normalized.business_facts.current_offers);
    } catch {
      setMemory(DEFAULT_BUSINESS_MEMORY);
      setCanEdit(false);
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => {
    setOpen(false);
    setOfferInput('');
    if (!bizId) {
      setMemory(DEFAULT_BUSINESS_MEMORY);
      setCanEdit(false);
      return;
    }
    void loadMemory();
  }, [bizId, loadMemory]);

  const summaryTone = memory.brand_voice.tone.slice(0, 2).join(' · ') || '-';
  const summaryKeywords = memory.brand_voice.keywords.slice(0, 3).join(', ') || '-';
  const summaryOffers = memory.business_facts.current_offers.slice(0, 2).join(' · ') || '-';

  const onAddOffer = useCallback(() => {
    if (!canEdit) return;
    const value = offerInput.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!value) return;
    setOffers((prev) => {
      const next = [...prev];
      if (!next.find((entry) => entry.toLocaleLowerCase('ca') === value.toLocaleLowerCase('ca'))) {
        next.push(value);
      }
      return next.slice(0, 12);
    });
    setOfferInput('');
  }, [offerInput, canEdit]);

  const onRemoveOffer = useCallback((index: number) => {
    if (!canEdit) return;
    setOffers((prev) => prev.filter((_, idx) => idx !== index));
  }, [canEdit]);

  const onSave = useCallback(async () => {
    if (!bizId || !canEdit) return;
    setSaving(true);
    try {
      const nextMemory: BusinessMemoryPayload = {
        brand_voice: {
          ...memory.brand_voice,
          tone: splitCommaSeparatedInput(toneText, 12, 48),
          keywords: splitCommaSeparatedInput(keywordsText, 20, 40),
          avoid: splitCommaSeparatedInput(avoidText, 16, 60),
        },
        policies: {
          ...memory.policies,
          never_mention: splitCommaSeparatedInput(neverMentionText, 16, 80),
        },
        business_facts: {
          ...memory.business_facts,
          current_offers: offers,
        },
      };

      const response = await fetch(`/api/business-memory?biz_id=${encodeURIComponent(bizId)}`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(nextMemory),
      });
      if (!response.ok) throw new Error('business_memory_save_failed');

      setMemory(nextMemory);
      toast(copy.saved, 'success');
    } catch {
      toast(copy.saveError, 'error');
    } finally {
      setSaving(false);
    }
  }, [bizId, canEdit, memory, toneText, keywordsText, avoidText, neverMentionText, offers, toast, copy.saved, copy.saveError]);

  return (
    <section className="lito-brand-brain">
      <div className="lito-brand-brain-head">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        <button
          type="button"
          className="lito-brand-brain-toggle"
          onClick={() => setOpen((prev) => !prev)}
          disabled={!bizId}
        >
          {open ? copy.collapse : copy.expand}
        </button>
      </div>

      {!bizId ? (
        <p className="lito-brand-brain-empty">{copy.noBiz}</p>
      ) : loading ? (
        <p className="lito-brand-brain-empty">{copy.loading}</p>
      ) : (
        <>
          <div className="lito-brand-brain-summary">
            <span><strong>{copy.tone}:</strong> {summaryTone}</span>
            <span><strong>{copy.keywords}:</strong> {summaryKeywords}</span>
            <span><strong>{copy.offers}:</strong> {summaryOffers}</span>
          </div>

          {open ? (
            <div className="lito-brand-brain-form">
              {!canEdit ? (
                <p className="lito-brand-brain-readonly">{copy.readOnly}</p>
              ) : null}

              <label className="lito-brand-brain-field">
                <span>{copy.formality}</span>
                <select
                  value={memory.brand_voice.formality}
                  onChange={(event) => {
                    const next = event.target.value as BrandVoiceFormality;
                    setMemory((prev) => ({
                      ...prev,
                      brand_voice: {
                        ...prev.brand_voice,
                        formality: next,
                      },
                    }));
                  }}
                  disabled={!canEdit}
                >
                  <option value="tu">{copy.tu}</option>
                  <option value="voste">{copy.voste}</option>
                  <option value="mixt">{copy.mixt}</option>
                </select>
              </label>

              <label className="lito-brand-brain-field">
                <span>{copy.tone}</span>
                <input
                  value={toneText}
                  onChange={(event) => setToneText(event.target.value)}
                  placeholder={copy.commaHint}
                  disabled={!canEdit}
                />
              </label>

              <label className="lito-brand-brain-field">
                <span>{copy.keywords}</span>
                <input
                  value={keywordsText}
                  onChange={(event) => setKeywordsText(event.target.value)}
                  placeholder={copy.commaHint}
                  disabled={!canEdit}
                />
              </label>

              <label className="lito-brand-brain-field">
                <span>{copy.avoid}</span>
                <input
                  value={avoidText}
                  onChange={(event) => setAvoidText(event.target.value)}
                  placeholder={copy.commaHint}
                  disabled={!canEdit}
                />
              </label>

              <label className="lito-brand-brain-field">
                <span>{copy.neverMention}</span>
                <input
                  value={neverMentionText}
                  onChange={(event) => setNeverMentionText(event.target.value)}
                  placeholder={copy.commaHint}
                  disabled={!canEdit}
                />
              </label>

              <div className="lito-brand-brain-field">
                <span>{copy.offers}</span>
                <div className="lito-brand-brain-offer-row">
                  <input
                    value={offerInput}
                    onChange={(event) => setOfferInput(event.target.value)}
                    placeholder={copy.offerPlaceholder}
                    disabled={!canEdit}
                  />
                  <button type="button" onClick={onAddOffer} disabled={!canEdit || !offerInput.trim()}>
                    {copy.addOffer}
                  </button>
                </div>
                <div className="lito-brand-brain-offers">
                  {offers.map((offer, index) => (
                    <span key={`${offer}-${index}`} className="lito-brand-brain-chip">
                      {offer}
                      {canEdit ? (
                        <button type="button" onClick={() => onRemoveOffer(index)} aria-label="remove">
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>

              <div className="lito-brand-brain-actions">
                <button type="button" className="lito-action-card-primary" onClick={onSave} disabled={!canEdit || saving}>
                  {saving ? `${copy.save}…` : copy.save}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
