'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocale } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import { captureClientEvent } from '@/lib/analytics/client';
import {
  sanitizeBusinessMemoryInput,
  type BrandPriorityFocus,
  type BrandVoiceFormality,
} from '@/lib/lito/brand-brain';

type LocaleKey = 'ca' | 'es' | 'en';

type BizRole = 'owner' | 'manager' | 'staff' | null;
type BusinessTypeAnswer = 'hotel' | 'restaurant' | 'bar_cafeteria' | 'retail' | 'other';

type BrandBrainOnboardingWizardProps = {
  bizId: string | null;
  onCompleted?: (input: { prompt: string }) => Promise<void> | void;
};

type BrandBrainApiResponse = {
  ok?: boolean;
  can_edit?: boolean;
  role?: BizRole;
  memory?: unknown;
  error?: string;
  message?: string;
};

type OnboardingCopy = {
  title: string;
  subtitle: string;
  progress: string;
  nowNot: string;
  noEdit: string;
  loading: string;
  saving: string;
  saveError: string;
  saved: string;
  q1: string;
  q2: string;
  q3: string;
  q1Options: Record<BusinessTypeAnswer, string>;
  q2Options: Record<BrandVoiceFormality, string>;
  q3Options: Record<BrandPriorityFocus, string>;
  todayPrompt: string;
};

const SNOOZE_MS = 24 * 60 * 60 * 1000;

const COPY: Record<LocaleKey, OnboardingCopy> = {
  ca: {
    title: 'Configurem LITO en 90 segons',
    subtitle: '3 respostes ràpides perquè no soni genèric.',
    progress: 'Pas {current}/3',
    nowNot: 'Ara no',
    noEdit: 'Demana-ho al teu gestor',
    loading: 'Preparant preguntes…',
    saving: 'Desant…',
    saveError: 'No s’ha pogut desar',
    saved: 'Desat',
    q1: 'Quin tipus de negoci sou?',
    q2: 'Com vols que LITO parli al client?',
    q3: 'Quina és la prioritat principal?',
    q1Options: {
      hotel: 'Hotel',
      restaurant: 'Restaurant',
      bar_cafeteria: 'Bar/Cafeteria',
      retail: 'Retail',
      other: 'Altre',
    },
    q2Options: {
      tu: 'De tu (proper)',
      voste: 'De vostè (professional)',
      mixt: 'Mixt',
    },
    q3Options: {
      reviews: 'Ressenyes',
      social: 'Xarxes',
      both: 'Les dues',
    },
    todayPrompt: 'Què toca avui?',
  },
  es: {
    title: 'Configuremos LITO en 90 segundos',
    subtitle: '3 respuestas rápidas para que no suene genérico.',
    progress: 'Paso {current}/3',
    nowNot: 'Ahora no',
    noEdit: 'Pídeselo a tu gestor',
    loading: 'Preparando preguntas…',
    saving: 'Guardando…',
    saveError: 'No se pudo guardar',
    saved: 'Guardado',
    q1: '¿Qué tipo de negocio sois?',
    q2: '¿Cómo quieres que LITO hable al cliente?',
    q3: '¿Cuál es la prioridad principal?',
    q1Options: {
      hotel: 'Hotel',
      restaurant: 'Restaurante',
      bar_cafeteria: 'Bar/Cafetería',
      retail: 'Retail',
      other: 'Otro',
    },
    q2Options: {
      tu: 'De tú (cercano)',
      voste: 'De usted (profesional)',
      mixt: 'Mixto',
    },
    q3Options: {
      reviews: 'Reseñas',
      social: 'Redes',
      both: 'Ambas',
    },
    todayPrompt: '¿Qué toca hoy?',
  },
  en: {
    title: 'Set up LITO in 90 seconds',
    subtitle: '3 quick answers so it does not sound generic.',
    progress: 'Step {current}/3',
    nowNot: 'Not now',
    noEdit: 'Ask your manager',
    loading: 'Preparing questions…',
    saving: 'Saving…',
    saveError: 'Could not save',
    saved: 'Saved',
    q1: 'What type of business are you?',
    q2: 'How should LITO address customers?',
    q3: 'What is your main priority?',
    q1Options: {
      hotel: 'Hotel',
      restaurant: 'Restaurant',
      bar_cafeteria: 'Bar/Cafe',
      retail: 'Retail',
      other: 'Other',
    },
    q2Options: {
      tu: 'Informal (friendly)',
      voste: 'Formal (professional)',
      mixt: 'Mixed',
    },
    q3Options: {
      reviews: 'Reviews',
      social: 'Social',
      both: 'Both',
    },
    todayPrompt: 'What should I do today?',
  },
};

function resolveLocale(locale: string): LocaleKey {
  if (locale.startsWith('ca')) return 'ca';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

function snoozeStorageKey(bizId: string): string {
  return `opinia.lito.brand_onboarding.snooze_until.${bizId}`;
}

function completedStorageKey(bizId: string): string {
  return `opinia.lito.brand_onboarding.completed.${bizId}`;
}

function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore localStorage errors
  }
}

function removeLocalStorage(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore localStorage errors
  }
}

function isMemoryEmpty(memoryRaw: unknown): boolean {
  const memory = sanitizeBusinessMemoryInput(memoryRaw || {});
  return memory.brand_voice.tone.length === 0
    && memory.brand_voice.keywords.length === 0
    && memory.business_facts.current_offers.length === 0;
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function serviceForBusinessType(value: BusinessTypeAnswer): string {
  if (value === 'bar_cafeteria') return 'bar/cafeteria';
  if (value === 'other') return 'other';
  return value;
}

function toneForFormality(value: BrandVoiceFormality): string[] {
  if (value === 'tu') return ['proper'];
  if (value === 'voste') return ['professional'];
  return ['proper', 'professional'];
}

export default function BrandBrainOnboardingWizard({ bizId, onCompleted }: BrandBrainOnboardingWizardProps) {
  const locale = useLocale();
  const { toast } = useToast();

  const lang = useMemo(() => resolveLocale(locale), [locale]);
  const copy = COPY[lang];

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [visible, setVisible] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [role, setRole] = useState<BizRole>(null);
  const [step, setStep] = useState(0);

  const [businessType, setBusinessType] = useState<BusinessTypeAnswer | null>(null);
  const [formality, setFormality] = useState<BrandVoiceFormality | null>(null);
  const [priorityFocus, setPriorityFocus] = useState<BrandPriorityFocus | null>(null);

  const startedEventRef = useRef<string | null>(null);

  const fetchEligibility = useCallback(async () => {
    if (!bizId) {
      setVisible(false);
      setRole(null);
      setCanEdit(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/business-memory?biz_id=${encodeURIComponent(bizId)}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store',
          'x-request-id': createClientRequestId(),
        },
      });

      if (!response.ok) {
        setVisible(false);
        return;
      }

      const payload = await response.json() as BrandBrainApiResponse;
      const memoryIsEmpty = isMemoryEmpty(payload.memory || {});
      const completed = readLocalStorage(completedStorageKey(bizId)) === '1';
      const snoozedUntilRaw = Number(readLocalStorage(snoozeStorageKey(bizId)) || '0');
      const snoozed = Number.isFinite(snoozedUntilRaw) && snoozedUntilRaw > Date.now();
      const nextVisible = memoryIsEmpty && !completed && !snoozed;

      setRole(payload.role || null);
      setCanEdit(Boolean(payload.can_edit));
      setVisible(nextVisible);
      setStep(0);
      setBusinessType(null);
      setFormality(null);
      setPriorityFocus(null);

      if (nextVisible && startedEventRef.current !== bizId) {
        startedEventRef.current = bizId;
        void captureClientEvent({
          bizId,
          event: 'onboarding_started',
          mode: 'basic',
          properties: {
            entry_point: 'lito_brand_brain_overlay',
            role: payload.role || null,
          },
        });
      }
    } finally {
      setLoading(false);
    }
  }, [bizId]);

  useEffect(() => {
    startedEventRef.current = null;
    void fetchEligibility();
  }, [fetchEligibility]);

  const onSkip = useCallback(() => {
    if (!bizId) return;
    writeLocalStorage(snoozeStorageKey(bizId), String(Date.now() + SNOOZE_MS));
    setVisible(false);
    void captureClientEvent({
      bizId,
      event: 'onboarding_skipped',
      mode: 'basic',
      properties: {
        role,
        step: step + 1,
        snooze_h: 24,
      },
    });
  }, [bizId, role, step]);

  const onSave = useCallback(async (focusValue: BrandPriorityFocus) => {
    if (!bizId || !canEdit || !businessType || !formality) return;

    setSaving(true);
    try {
      const service = serviceForBusinessType(businessType);
      const body = {
        brand_voice: {
          formality,
          tone: toneForFormality(formality),
          keywords: [service],
        },
        policies: {
          primary_focus: focusValue,
        },
        business_facts: {
          services: [service],
        },
      };

      const response = await fetch(`/api/business-memory?biz_id=${encodeURIComponent(bizId)}`, {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'x-request-id': createClientRequestId(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('brand_brain_onboarding_save_failed');
      }

      writeLocalStorage(completedStorageKey(bizId), '1');
      removeLocalStorage(snoozeStorageKey(bizId));
      setVisible(false);
      toast(copy.saved, 'success');

      void captureClientEvent({
        bizId,
        event: 'onboarding_completed',
        mode: 'basic',
        properties: {
          business_type: businessType,
          formality,
          primary_focus: focusValue,
        },
      });

      await onCompleted?.({ prompt: copy.todayPrompt });
    } catch {
      toast(copy.saveError, 'error');
    } finally {
      setSaving(false);
    }
  }, [bizId, canEdit, businessType, formality, toast, copy.saved, copy.saveError, copy.todayPrompt, onCompleted]);

  const onPickBusinessType = useCallback((value: BusinessTypeAnswer) => {
    setBusinessType(value);
    setStep(1);
  }, []);

  const onPickFormality = useCallback((value: BrandVoiceFormality) => {
    setFormality(value);
    setStep(2);
  }, []);

  const onPickPriority = useCallback((value: BrandPriorityFocus) => {
    setPriorityFocus(value);
    void onSave(value);
  }, [onSave]);

  if (!bizId || !visible) return null;

  return (
    <div className="lito-onboarding-overlay" role="dialog" aria-modal="true" aria-label={copy.title}>
      <section className="lito-onboarding-card">
        <header className="lito-onboarding-head">
          <div>
            <p className="lito-onboarding-progress">
              {copy.progress.replace('{current}', String(step + 1))}
            </p>
            <h3>{copy.title}</h3>
            <p>{loading ? copy.loading : copy.subtitle}</p>
          </div>
          <button type="button" onClick={onSkip} className="lito-onboarding-skip" disabled={saving}>
            {copy.nowNot}
          </button>
        </header>

        {!canEdit ? (
          <p className="lito-onboarding-readonly">{copy.noEdit}</p>
        ) : null}

        <div className="lito-onboarding-questions">
          <p className="lito-onboarding-question">
            {step === 0 ? copy.q1 : step === 1 ? copy.q2 : copy.q3}
          </p>

          {step === 0 ? (
            <div className="lito-onboarding-options">
              {(Object.keys(copy.q1Options) as BusinessTypeAnswer[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`lito-onboarding-option${businessType === option ? ' is-selected' : ''}`}
                  onClick={() => onPickBusinessType(option)}
                  disabled={!canEdit || saving}
                >
                  {copy.q1Options[option]}
                </button>
              ))}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="lito-onboarding-options">
              {(Object.keys(copy.q2Options) as BrandVoiceFormality[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`lito-onboarding-option${formality === option ? ' is-selected' : ''}`}
                  onClick={() => onPickFormality(option)}
                  disabled={!canEdit || saving}
                >
                  {copy.q2Options[option]}
                </button>
              ))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="lito-onboarding-options">
              {(Object.keys(copy.q3Options) as BrandPriorityFocus[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`lito-onboarding-option${priorityFocus === option ? ' is-selected' : ''}`}
                  onClick={() => onPickPriority(option)}
                  disabled={!canEdit || saving}
                >
                  {copy.q3Options[option]}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {saving ? <p className="lito-onboarding-saving">{copy.saving}</p> : null}
      </section>
    </div>
  );
}
