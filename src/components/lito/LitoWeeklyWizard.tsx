'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { useToast } from '@/components/ui/Toast';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import { getIkeaChecklist } from '@/lib/recommendations/howto';
import { captureClientEvent } from '@/lib/analytics/client';

import type { LitoRecommendationItem, LitoViewerRole } from '@/components/lito/types';

type TranslationFn = (key: string, vars?: Record<string, string | number>) => string;

type DraftChannel = 'instagram' | 'tiktok';
type DraftDay = 'mon' | 'wed' | 'fri';
type DraftSlot = 'morning' | 'afternoon';
type DraftFormat = 'post' | 'story' | 'reel';

type WizardDraft = {
  local_id: string;
  recommendation_id: string | null;
  format: DraftFormat;
  channel: DraftChannel;
  day: DraftDay;
  slot: DraftSlot;
  approved: boolean;
  variant: number;
  hook: string;
  idea: string;
  cta: string;
  title: string;
  copy_short: string;
  copy_long: string;
  hashtags: string[];
  steps: string[];
  assets_needed: string[];
};

type TeamMember = {
  user_id: string;
  role: string;
  accepted_at: string | null;
};

type CreateDraftResponse = {
  ok?: boolean;
  draft?: {
    id: string;
    version: number;
  };
  error?: string;
  message?: string;
};

type CreateScheduleResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
};

type LitoWeeklyWizardProps = {
  t: TranslationFn;
  bizId: string;
  orgId: string | null;
  businessName: string;
  businessVertical: string | null | undefined;
  viewerRole: LitoViewerRole;
  recommendations: LitoRecommendationItem[];
  onDone?: () => void;
};

function normalizeFormat(value: string | null | undefined): DraftFormat {
  return value === 'story' || value === 'reel' ? value : 'post';
}

function fallbackHook(index: number): string {
  return index % 2 === 0
    ? 'Un detall real del teu negoci que genera confiança'
    : 'Una escena quotidiana que connecta amb el teu client ideal';
}

function fallbackIdea(index: number): string {
  return index % 2 === 0
    ? 'Mostra una prova visual curta del teu servei en un context real.'
    : 'Explica un benefici concret que el client nota en menys de 10 segons.';
}

function fallbackCta(index: number): string {
  return index % 2 === 0
    ? 'Escriu-nos i t’assessorem sense compromís.'
    : 'Reserva ara i assegura la millor franja.';
}

function buildHashtags(format: DraftFormat): string[] {
  const base = ['#NegociLocal', '#OpinIA', '#ContingutLocal'];
  if (format === 'story') return [...base, '#Story'];
  if (format === 'reel') return [...base, '#Reel'];
  return [...base, '#Post'];
}

function sanitizeLine(value: string, max = 280): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function nextDateByPreference(day: DraftDay, slot: DraftSlot): string {
  const targetDow = day === 'mon' ? 1 : day === 'wed' ? 3 : 5;
  const date = new Date();
  const currentDow = date.getDay();
  const normalizedCurrent = currentDow === 0 ? 7 : currentDow;
  let delta = targetDow - normalizedCurrent;
  if (delta < 0) delta += 7;
  if (delta === 0 && date.getHours() >= (slot === 'morning' ? 10 : 17)) {
    delta = 7;
  }

  date.setDate(date.getDate() + delta);
  date.setHours(slot === 'morning' ? 10 : 17, 0, 0, 0);

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}T${hours}:${minutes}`;
}

function pickTargetCount(input: number | 'surprise'): number {
  if (input === 'surprise') {
    return 1 + Math.floor(Math.random() * 5);
  }
  return input;
}

function chooseDay(index: number): DraftDay {
  const order: DraftDay[] = ['mon', 'wed', 'fri'];
  return order[index % order.length];
}

function chooseSlot(index: number): DraftSlot {
  const order: DraftSlot[] = ['morning', 'afternoon'];
  return order[index % order.length];
}

function buildDraftVariant(input: {
  recommendation: LitoRecommendationItem | null;
  index: number;
  variant: number;
  noveltyText: string;
  businessName: string;
  businessVertical: string | null | undefined;
  t: TranslationFn;
}): Omit<WizardDraft, 'local_id' | 'approved' | 'day' | 'slot' | 'channel' | 'variant'> {
  const recommendation = input.recommendation;
  const format = normalizeFormat(recommendation?.format);
  const hookBase = recommendation?.hook?.trim() || fallbackHook(input.index);
  const ideaBase = recommendation?.idea?.trim() || fallbackIdea(input.index);
  const ctaBase = recommendation?.cta?.trim() || fallbackCta(input.index);

  const novelty = input.noveltyText.trim();
  let hook = hookBase;
  let idea = ideaBase;
  let cta = ctaBase;

  if (input.variant % 3 === 1) {
    hook = `${hookBase} · ${input.t('dashboard.litoPage.wizard.variantFast')}`;
  } else if (input.variant % 3 === 2) {
    hook = `${input.t('dashboard.litoPage.wizard.variantQuestion')} ${hookBase}?`;
  }

  if (novelty) {
    idea = `${ideaBase} ${input.t('dashboard.litoPage.wizard.noveltyPrefix', { value: novelty })}`;
  }

  const short = sanitizeLine(`${hook}. ${cta}`, 120);
  const long = sanitizeLine(`${hook}\n\n${idea}\n\n${cta}`, 500);

  const ikea = getIkeaChecklist({
    t: input.t,
    format,
    channel: 'instagram',
    vertical: input.businessVertical || 'general',
    hook,
    idea,
    cta,
    locale: 'ca',
  });

  return {
    recommendation_id: recommendation?.id || null,
    format,
    hook,
    idea,
    cta,
    title: sanitizeLine(`${input.t(`dashboard.litoPage.ikea.format.${format}`)}: ${hook}`, 120),
    copy_short: short,
    copy_long: long,
    hashtags: buildHashtags(format),
    steps: ikea.steps,
    assets_needed: [
      input.t('dashboard.litoPage.wizard.assetOne', { business: input.businessName }),
      input.t('dashboard.litoPage.wizard.assetTwo'),
    ],
  };
}

async function resolveDefaultAssignee(orgId: string): Promise<string | null> {
  const response = await fetch(`/api/team?org_id=${encodeURIComponent(orgId)}`, {
    cache: 'no-store',
    headers: {
      'x-request-id': crypto.randomUUID(),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as { members?: TeamMember[] };
  if (!response.ok || !Array.isArray(payload.members)) return null;

  const eligible = payload.members.find((member) => {
    if (!member.accepted_at) return false;
    return member.role === 'owner' || member.role === 'manager' || member.role === 'staff';
  });

  return eligible?.user_id || null;
}

export default function LitoWeeklyWizard({
  t,
  bizId,
  orgId,
  businessName,
  businessVertical,
  viewerRole,
  recommendations,
  onDone,
}: LitoWeeklyWizardProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [targetInput, setTargetInput] = useState<1 | 3 | 5 | 'surprise'>(3);
  const [novelty, setNovelty] = useState('');
  const [drafts, setDrafts] = useState<WizardDraft[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const completedRef = useRef(false);

  const canSchedule = viewerRole === 'owner' || viewerRole === 'manager';

  const activeDraft = drafts[activeIndex] || null;

  const approvedCount = useMemo(() => drafts.filter((item) => item.approved).length, [drafts]);

  const openWizard = (target: 1 | 3 | 5 | 'surprise') => {
    void captureClientEvent({
      bizId,
      event: 'start_weekly_wizard',
      mode: 'basic',
      properties: {
        target_count: target === 'surprise' ? 'surprise' : target,
      },
    });
    setTargetInput(target);
    setOpen(true);
    setStep(1);
    setDrafts([]);
    setActiveIndex(0);
    setShowPushPrompt(false);
    completedRef.current = false;
  };

  const startStepTwo = () => {
    const desiredCount = pickTargetCount(targetInput);
    const source = recommendations.length > 0 ? recommendations : [null];
    const nextDrafts = Array.from({ length: desiredCount }, (_, index) => {
      const recommendation = source[index % source.length];
      const base = buildDraftVariant({
        recommendation,
        index,
        variant: 0,
        noveltyText: novelty,
        businessName,
        businessVertical,
        t,
      });

      return {
        ...base,
        local_id: `${Date.now()}-${index}`,
        variant: 0,
        approved: true,
        channel: 'instagram' as const,
        day: chooseDay(index),
        slot: chooseSlot(index),
      };
    });

    setDrafts(nextDrafts);
    setActiveIndex(0);
    setStep(2);
  };

  const updateActiveDraft = (partial: Partial<WizardDraft>) => {
    if (typeof partial.approved === 'boolean') {
      void captureClientEvent({
        bizId,
        event: 'approve_draft',
        mode: 'basic',
        properties: {
          approved: partial.approved,
          index: activeIndex + 1,
          format: activeDraft?.format || null,
        },
      });
    }
    setDrafts((previous) => previous.map((item, index) => {
      if (index !== activeIndex) return item;
      return { ...item, ...partial };
    }));
  };

  const closeWizard = (reason: string) => {
    if (open && !completedRef.current) {
      void captureClientEvent({
        bizId,
        event: 'wizard_abandoned',
        mode: 'basic',
        properties: {
          reason,
          step,
          approved_count: approvedCount,
        },
      });
    }
    setOpen(false);
  };

  const regenerateActive = () => {
    if (!activeDraft) return;
    const recommendation = recommendations.find((item) => item.id === activeDraft.recommendation_id) || null;
    const nextVariant = activeDraft.variant + 1;
    const regenerated = buildDraftVariant({
      recommendation,
      index: activeIndex,
      variant: nextVariant,
      noveltyText: novelty,
      businessName,
      businessVertical,
      t,
    });

    setDrafts((previous) => previous.map((item, index) => {
      if (index !== activeIndex) return item;
      return {
        ...item,
        ...regenerated,
        variant: nextVariant,
      };
    }));
  };

  const moveStepThree = () => {
    if (approvedCount === 0) {
      toast(t('dashboard.litoPage.wizard.needOneApproved'), 'warning');
      return;
    }
    setStep(3);
  };

  const finalize = async () => {
    if (approvedCount === 0) {
      toast(t('dashboard.litoPage.wizard.needOneApproved'), 'warning');
      return;
    }

    setSaving(true);

    try {
      const approvedDrafts = drafts.filter((item) => item.approved);
      const assignee = canSchedule && orgId ? await resolveDefaultAssignee(orgId) : null;

      for (const item of approvedDrafts) {
        const createDraftResponse = await fetch('/api/social/drafts', {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            biz_id: bizId,
            channel: item.channel,
            format: item.format,
            title: item.title,
            copy_short: item.copy_short,
            copy_long: item.copy_long,
            hashtags: item.hashtags,
            assets_needed: item.assets_needed,
            steps: item.steps,
            recommendation_id: item.recommendation_id,
            source: 'lito',
          }),
        });

        const createDraftPayload = (await createDraftResponse.json().catch(() => ({}))) as CreateDraftResponse;
        if (!createDraftResponse.ok || !createDraftPayload.draft) {
          throw new Error(createDraftPayload.message || t('dashboard.litoPage.wizard.finalizeError'));
        }

        if (canSchedule && assignee) {
          const scheduleResponse = await fetch('/api/social/schedules', {
            method: 'POST',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': crypto.randomUUID(),
            },
            body: JSON.stringify({
              biz_id: bizId,
              draft_id: createDraftPayload.draft.id,
              platform: item.channel,
              scheduled_at: nextDateByPreference(item.day, item.slot),
              assigned_user_id: assignee,
            }),
          });

          const schedulePayload = (await scheduleResponse.json().catch(() => ({}))) as CreateScheduleResponse;
          if (!scheduleResponse.ok || schedulePayload.error) {
            throw new Error(schedulePayload.message || t('dashboard.litoPage.wizard.finalizeError'));
          }
        }
      }

      if (!canSchedule) {
        toast(t('dashboard.litoPage.wizard.finalizeDraftOnlySuccess'), 'success');
      } else {
        toast(t('dashboard.litoPage.wizard.finalizeSuccess'), 'success');
      }

      completedRef.current = true;
      void captureClientEvent({
        bizId,
        event: 'handoff_to_planner',
        mode: 'basic',
        properties: {
          approved_count: approvedDrafts.length,
          scheduled_count: canSchedule && assignee ? approvedDrafts.length : 0,
          role: viewerRole || null,
        },
      });
      setShowPushPrompt(true);
      onDone?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('dashboard.litoPage.wizard.finalizeError');
      toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => () => {
    if (open && !completedRef.current) {
      void captureClientEvent({
        bizId,
        event: 'wizard_abandoned',
        mode: 'basic',
        properties: {
          reason: 'unmount',
          step,
          approved_count: approvedCount,
        },
      });
    }
  }, [approvedCount, bizId, open, step]);

  return (
    <GlassCard variant="strong" className="border border-white/10 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={cn('text-lg font-semibold', textMain)}>{t('dashboard.litoPage.wizard.heroTitle')}</p>
          <p className={cn('mt-1 text-sm', textSub)}>{t('dashboard.litoPage.wizard.heroSubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="h-9 px-3 text-sm" onClick={() => openWizard(3)}>
            {t('dashboard.litoPage.wizard.prepareThree')}
          </Button>
          <Button variant="secondary" className="h-9 px-3 text-sm" onClick={() => openWizard(1)}>1</Button>
          <Button variant="secondary" className="h-9 px-3 text-sm" onClick={() => openWizard(5)}>5</Button>
          <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => openWizard('surprise')}>
            {t('dashboard.litoPage.wizard.surprise')}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 md:p-4">
          {step === 1 ? (
            <div className="space-y-3">
              <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.wizard.step1Title')}</p>
              <p className={cn('text-xs', textSub)}>{t('dashboard.litoPage.wizard.step1Subtitle')}</p>
              <textarea
                value={novelty}
                onChange={(event) => setNovelty(event.target.value)}
                className="glass-input min-h-[90px] w-full"
                placeholder={t('dashboard.litoPage.wizard.noveltyPlaceholder')}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => closeWizard('cancel_step_1')}>
                  {t('common.cancel')}
                </Button>
                <Button className="h-8 px-3 text-xs" onClick={startStepTwo}>
                  {t('dashboard.litoPage.wizard.continue')}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.wizard.step2Title')}</p>
                <p className={cn('text-xs', textSub)}>
                  {t('dashboard.litoPage.wizard.step2Counter', { current: activeIndex + 1, total: drafts.length })}
                </p>
              </div>

              {activeDraft ? (
                <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={activeDraft.approved ? 'secondary' : 'ghost'}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => updateActiveDraft({ approved: !activeDraft.approved })}
                    >
                      {activeDraft.approved ? t('dashboard.litoPage.wizard.approved') : t('dashboard.litoPage.wizard.approve')}
                    </Button>
                    <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={regenerateActive}>
                      {t('dashboard.litoPage.wizard.regenerate')}
                    </Button>
                  </div>

                  <label className="space-y-1">
                    <span className="text-xs text-white/70">{t('dashboard.litoPage.wizard.inlineEdit')}</span>
                    <input
                      value={activeDraft.copy_short}
                      onChange={(event) => updateActiveDraft({ copy_short: sanitizeLine(event.target.value, 120) })}
                      className="glass-input w-full"
                    />
                  </label>

                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs text-white/70">{t('dashboard.litoPage.wizard.recommendedDay')}</span>
                      <select
                        className="glass-input w-full"
                        value={activeDraft.day}
                        onChange={(event) => updateActiveDraft({ day: event.target.value as DraftDay })}
                      >
                        <option value="mon">{t('dashboard.litoPage.wizard.days.mon')}</option>
                        <option value="wed">{t('dashboard.litoPage.wizard.days.wed')}</option>
                        <option value="fri">{t('dashboard.litoPage.wizard.days.fri')}</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs text-white/70">{t('dashboard.litoPage.wizard.recommendedSlot')}</span>
                      <select
                        className="glass-input w-full"
                        value={activeDraft.slot}
                        onChange={(event) => updateActiveDraft({ slot: event.target.value as DraftSlot })}
                      >
                        <option value="morning">{t('dashboard.litoPage.wizard.slots.morning')}</option>
                        <option value="afternoon">{t('dashboard.litoPage.wizard.slots.afternoon')}</option>
                      </select>
                    </label>
                  </div>

                  <p className="text-xs text-white/65">{activeDraft.copy_long}</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={activeIndex === 0}
                    onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}
                  >
                    {t('common.previous')}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    disabled={activeIndex >= drafts.length - 1}
                    onClick={() => setActiveIndex((value) => Math.min(drafts.length - 1, value + 1))}
                  >
                    {t('common.next')}
                  </Button>
                </div>
                <Button className="h-8 px-3 text-xs" onClick={moveStepThree}>
                  {t('dashboard.litoPage.wizard.continue')}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <p className={cn('text-sm font-semibold', textMain)}>{t('dashboard.litoPage.wizard.step3Title')}</p>
              <p className={cn('text-xs', textSub)}>
                {t('dashboard.litoPage.wizard.step3Summary', { count: approvedCount })}
              </p>

              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-white/70">{t('dashboard.litoPage.wizard.microGuideTitle')}</p>
                <p className="mt-1 text-sm text-white/85">{t('dashboard.litoPage.wizard.microGuideBody')}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setStep(2)}>
                  {t('common.back')}
                </Button>
                <Button className="h-8 px-3 text-xs" loading={saving} onClick={() => void finalize()}>
                  {t('dashboard.litoPage.wizard.finalCta')}
                </Button>
              </div>

              {showPushPrompt ? (
                <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-3">
                  <p className="text-sm font-semibold text-amber-100">{t('dashboard.litoPage.wizard.pushTitle')}</p>
                  <p className="mt-1 text-xs text-amber-100/80">{t('dashboard.litoPage.wizard.pushSubtitle')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        void captureClientEvent({
                          bizId,
                          event: 'enable_push',
                          mode: 'basic',
                          properties: {
                            source: 'wizard_prompt',
                            decision: 'accepted',
                          },
                        });
                        router.push(`/dashboard/planner?biz_id=${encodeURIComponent(bizId)}`);
                      }}
                    >
                      {t('dashboard.litoPage.wizard.pushYes')}
                    </Button>
                    <Button
                      variant="secondary"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        void captureClientEvent({
                          bizId,
                          event: 'enable_push',
                          mode: 'basic',
                          properties: {
                            source: 'wizard_prompt',
                            decision: 'declined',
                          },
                        });
                        setShowPushPrompt(false);
                      }}
                    >
                      {t('dashboard.litoPage.wizard.pushNo')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
