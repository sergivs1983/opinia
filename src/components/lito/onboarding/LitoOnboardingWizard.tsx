'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useLocale } from '@/components/i18n/I18nContext';
import { useToast } from '@/components/ui/Toast';
import {
  sanitizeBusinessMemoryInput,
  type BrandPriorityFocus,
  type BrandVoiceFormality,
  type BusinessMemoryType,
} from '@/lib/lito/brand-brain';

type LocaleKey = 'ca' | 'es' | 'en';

type BizRole = 'owner' | 'manager' | 'staff' | null;
type BusinessTypeAnswer = Exclude<BusinessMemoryType, ''>;

type LitoOnboardingWizardProps = {
  bizId: string | null;
  orgId: string | null;
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
  skip: string;
  loading: string;
  saving: string;
  saveError: string;
  saved: string;
  readOnly: string;
  notifyManager: string;
  managerNoteCopied: string;
  managerNoteError: string;
  q1: string;
  q2: string;
  q3: string;
  q1Options: Record<BusinessTypeAnswer, string>;
  q2Options: Record<BrandVoiceFormality, string>;
  q3Options: Record<BrandPriorityFocus, string>;
};

const SNOOZE_STORAGE_KEY = 'opinia.lito.onboarding_snooze_until';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const TODAY_PROMPT = 'Què toca avui?';

const COPY: Record<LocaleKey, OnboardingCopy> = {
  ca: {
    title: 'Configurem LITO en 90 segons',
    subtitle: '3 respostes ràpides i ho deixem a punt.',
    progress: 'Pas {current}/3',
    skip: 'Ara no',
    loading: 'Preparant preguntes…',
    saving: 'Desant…',
    saveError: 'No s’ha pogut desar',
    saved: 'Desat',
    readOnly: 'Només gestors poden configurar això.',
    notifyManager: 'Avisar al meu gestor',
    managerNoteCopied: 'Missatge copiat',
    managerNoteError: 'No s’ha pogut copiar',
    q1: 'Tipus de negoci',
    q2: 'Com parles als clients?',
    q3: 'Què et preocupa més ara?',
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
  },
  es: {
    title: 'Configuramos LITO en 90 segundos',
    subtitle: '3 respuestas rápidas y queda listo.',
    progress: 'Paso {current}/3',
    skip: 'Ahora no',
    loading: 'Preparando preguntas…',
    saving: 'Guardando…',
    saveError: 'No se pudo guardar',
    saved: 'Guardado',
    readOnly: 'Solo gestores pueden configurar esto.',
    notifyManager: 'Avisar a mi gestor',
    managerNoteCopied: 'Mensaje copiado',
    managerNoteError: 'No se pudo copiar',
    q1: 'Tipo de negocio',
    q2: '¿Cómo hablas con tus clientes?',
    q3: '¿Qué te preocupa más ahora?',
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
  },
  en: {
    title: 'Set up LITO in 90 seconds',
    subtitle: '3 quick answers and it is ready.',
    progress: 'Step {current}/3',
    skip: 'Not now',
    loading: 'Preparing questions…',
    saving: 'Saving…',
    saveError: 'Could not save',
    saved: 'Saved',
    readOnly: 'Only managers can configure this.',
    notifyManager: 'Notify my manager',
    managerNoteCopied: 'Message copied',
    managerNoteError: 'Could not copy',
    q1: 'Business type',
    q2: 'How do you talk to customers?',
    q3: 'What concerns you most right now?',
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
  },
};

function resolveLocale(locale: string): LocaleKey {
  if (locale.startsWith('ca')) return 'ca';
  if (locale.startsWith('es')) return 'es';
  return 'en';
}

function createClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isFormalitySet(memoryRaw: unknown): boolean {
  const root = asObject(memoryRaw);
  const brandVoice = asObject(root.brand_voice);
  return brandVoice.formality === 'tu'
    || brandVoice.formality === 'voste'
    || brandVoice.formality === 'mixt';
}

function isMemoryEmpty(memoryRaw: unknown): boolean {
  const memory = sanitizeBusinessMemoryInput(memoryRaw || {});
  const emptyCore = memory.brand_voice.tone.length === 0
    && memory.brand_voice.keywords.length === 0
    && memory.business_facts.current_offers.length === 0;
  if (emptyCore) return true;

  const optionalFormalityMissing = !isFormalitySet(memoryRaw)
    && memory.brand_voice.tone.length === 0
    && memory.brand_voice.keywords.length === 0;
  return optionalFormalityMissing;
}

function readSnoozeMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SNOOZE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || !key.trim()) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeSnoozeMap(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage errors.
  }
}

function getSnoozeUntil(bizId: string): number {
  const map = readSnoozeMap();
  const value = map[bizId];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return value;
}

function setSnoozeForBiz(bizId: string, until: number): void {
  const map = readSnoozeMap();
  map[bizId] = until;
  writeSnoozeMap(map);
}

function clearSnoozeForBiz(bizId: string): void {
  const map = readSnoozeMap();
  if (!(bizId in map)) return;
  delete map[bizId];
  writeSnoozeMap(map);
}

function serviceForBusinessType(value: BusinessTypeAnswer): string {
  if (value === 'bar_cafeteria') return 'bar/cafeteria';
  if (value === 'other') return 'other';
  return value;
}

function keywordForBusinessType(value: BusinessTypeAnswer): string {
  if (value === 'bar_cafeteria') return 'bar cafeteria';
  if (value === 'other') return 'negoci local';
  return value;
}

function toneForFormality(value: BrandVoiceFormality): string[] {
  if (value === 'tu') return ['proper'];
  if (value === 'voste') return ['professional'];
  return ['proper', 'professional'];
}

async function trackOnboardingEvent(input: {
  orgId: string | null;
  bizId: string;
  eventName: 'onboarding_started' | 'onboarding_completed' | 'onboarding_snoozed' | 'onboarding_blocked_staff';
  props?: Record<string, unknown>;
}): Promise<void> {
  if (!input.orgId || !input.bizId) return;
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'x-request-id': createClientRequestId(),
      },
      body: JSON.stringify({
        org_id: input.orgId,
        event_name: input.eventName,
        props: {
          biz_id: input.bizId,
          ...(input.props || {}),
        },
      }),
    });
  } catch {
    // Telemetry should never break UX.
  }
}

export default function LitoOnboardingWizard({ bizId, orgId, onCompleted }: LitoOnboardingWizardProps) {
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
  const blockedEventRef = useRef<string | null>(null);

  const resetAnswers = useCallback(() => {
    setStep(0);
    setBusinessType(null);
    setFormality(null);
    setPriorityFocus(null);
  }, []);

  const fetchEligibility = useCallback(async () => {
    if (!bizId) {
      setVisible(false);
      setRole(null);
      setCanEdit(false);
      resetAnswers();
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
        resetAnswers();
        return;
      }

      const payload = await response.json() as BrandBrainApiResponse;
      const memoryIsEmpty = isMemoryEmpty(payload.memory || {});
      const snoozedUntil = getSnoozeUntil(bizId);
      const snoozed = snoozedUntil > Date.now();
      const nextVisible = memoryIsEmpty && !snoozed;

      const nextRole = payload.role || null;
      const nextCanEdit = Boolean(payload.can_edit);

      setRole(nextRole);
      setCanEdit(nextCanEdit);
      setVisible(nextVisible);
      resetAnswers();

      if (nextVisible && startedEventRef.current !== bizId) {
        startedEventRef.current = bizId;
        void trackOnboardingEvent({
          orgId,
          bizId,
          eventName: 'onboarding_started',
        });
      }

      if (nextVisible && nextRole === 'staff' && blockedEventRef.current !== bizId) {
        blockedEventRef.current = bizId;
        void trackOnboardingEvent({
          orgId,
          bizId,
          eventName: 'onboarding_blocked_staff',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [bizId, orgId, resetAnswers]);

  useEffect(() => {
    startedEventRef.current = null;
    blockedEventRef.current = null;
    void fetchEligibility();
  }, [fetchEligibility]);

  const onSkip = useCallback(() => {
    if (!bizId) return;
    setSnoozeForBiz(bizId, Date.now() + SNOOZE_MS);
    setVisible(false);
    void trackOnboardingEvent({
      orgId,
      bizId,
      eventName: 'onboarding_snoozed',
    });
  }, [bizId, orgId]);

  const onNotifyManager = useCallback(async () => {
    if (!bizId) return;
    const text = `Hola! Pots completar l'onboarding de LITO (Brand Brain) del negoci ${bizId}?`;
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        throw new Error('clipboard_unavailable');
      }
      await navigator.clipboard.writeText(text);
      toast(copy.managerNoteCopied, 'success');
    } catch {
      toast(copy.managerNoteError, 'error');
    }
  }, [bizId, toast, copy.managerNoteCopied, copy.managerNoteError]);

  const onSave = useCallback(async (focusValue: BrandPriorityFocus) => {
    if (!bizId || !canEdit || !businessType || !formality) return;

    setSaving(true);
    try {
      const service = serviceForBusinessType(businessType);
      const body = {
        business_facts: {
          type: businessType,
          services: [service],
        },
        brand_voice: {
          formality,
          tone: toneForFormality(formality),
          keywords: [keywordForBusinessType(businessType)],
        },
        policies: {
          primary_focus: focusValue,
        },
      };

      const response = await fetch(`/api/business-memory?biz_id=${encodeURIComponent(bizId)}`, {
        method: 'PATCH',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'x-request-id': createClientRequestId(),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error('lito_onboarding_save_failed');
      }

      clearSnoozeForBiz(bizId);
      setVisible(false);
      toast(copy.saved, 'success');

      void trackOnboardingEvent({
        orgId,
        bizId,
        eventName: 'onboarding_completed',
        props: {
          answers: {
            business_type: businessType,
            formality,
            primary_focus: focusValue,
          },
        },
      });

      await onCompleted?.({ prompt: TODAY_PROMPT });
    } catch {
      toast(copy.saveError, 'error');
    } finally {
      setSaving(false);
    }
  }, [bizId, canEdit, businessType, formality, toast, copy.saved, copy.saveError, orgId, onCompleted]);

  const onPickBusinessType = useCallback((value: BusinessTypeAnswer) => {
    if (!canEdit || saving) return;
    setBusinessType(value);
    setStep(1);
  }, [canEdit, saving]);

  const onPickFormality = useCallback((value: BrandVoiceFormality) => {
    if (!canEdit || saving) return;
    setFormality(value);
    setStep(2);
  }, [canEdit, saving]);

  const onPickPriority = useCallback((value: BrandPriorityFocus) => {
    if (!canEdit || saving) return;
    setPriorityFocus(value);
    void onSave(value);
  }, [canEdit, saving, onSave]);

  if (!bizId || !visible) return null;

  const currentQuestion = step === 0 ? copy.q1 : step === 1 ? copy.q2 : copy.q3;
  const isReadOnly = !canEdit;

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
            {copy.skip}
          </button>
        </header>

        {isReadOnly ? (
          <>
            <p className="lito-onboarding-readonly">{copy.readOnly}</p>
            <div className="lito-onboarding-staff-actions">
              <button type="button" className="lito-onboarding-staff-button" onClick={() => void onNotifyManager()}>
                {copy.notifyManager}
              </button>
            </div>
          </>
        ) : null}

        <div className="lito-onboarding-questions">
          <p className="lito-onboarding-question">{currentQuestion}</p>

          {step === 0 ? (
            <div className="lito-onboarding-options">
              {(Object.keys(copy.q1Options) as BusinessTypeAnswer[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`lito-onboarding-option${businessType === option ? ' is-selected' : ''}`}
                  onClick={() => onPickBusinessType(option)}
                  disabled={isReadOnly || saving}
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
                  disabled={isReadOnly || saving}
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
                  disabled={isReadOnly || saving}
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
