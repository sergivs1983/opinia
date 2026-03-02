'use client';

import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/Button';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import type {
  LitoMemoryContext,
  LitoQuotaState,
  LitoRecommendationItem,
  LitoViewerRole,
} from '@/components/lito/types';

type MemoryTab = 'profile' | 'voice' | 'policies' | 'events';

type LitoContextPanelProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  bizId: string;
  businessName: string;
  businessVertical: string;
  businessLanguage: string;
  gbpState: 'connected' | 'needs_reauth' | 'not_connected' | 'unknown';
  viewerRole: LitoViewerRole;
  recommendations: LitoRecommendationItem[];
  recommendationsLoading: boolean;
  quota: LitoQuotaState | null;
  trialState: 'none' | 'active' | 'ended';
  trialDaysLeft: number;
  voicePendingCount: number;
  selectedRecommendationId: string | null;
  recalculateLoading: boolean;
  memory: LitoMemoryContext | null;
  memoryLoading: boolean;
  onOpenGeneral: () => void;
  onRecalculateSignals: () => void;
  onSelectRecommendation: (item: LitoRecommendationItem) => void;
  onMemoryUpdated: (next: LitoMemoryContext) => void;
};

function formatVerticalLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'restaurant') return 'Restaurant';
  if (normalized === 'hotel') return 'Hotel';
  return 'General';
}

function buildSignalReason(item: LitoRecommendationItem): string {
  const signal = item.signal_meta || item.recommendation_template?.signal;
  if (!signal) return item.idea;
  if (signal.keyword && typeof signal.keyword_mentions === 'number' && signal.keyword_mentions > 0) {
    return `${signal.keyword_mentions} mentions de “${signal.keyword}”`;
  }
  if (typeof signal.neg_reviews === 'number' && signal.neg_reviews > 0) {
    return `${signal.neg_reviews} ressenyes negatives`;
  }
  if (typeof signal.avg_rating === 'number' && Number.isFinite(signal.avg_rating)) {
    return `Mitjana ${signal.avg_rating.toFixed(1)}★`;
  }
  return item.idea;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return '-';
  return new Date(ts).toLocaleString('ca-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export default function LitoContextPanel({
  t,
  bizId,
  businessName,
  businessVertical,
  businessLanguage,
  gbpState,
  viewerRole,
  recommendations,
  recommendationsLoading,
  quota,
  trialState,
  trialDaysLeft,
  voicePendingCount,
  selectedRecommendationId,
  recalculateLoading,
  memory,
  memoryLoading,
  onOpenGeneral,
  onRecalculateSignals,
  onSelectRecommendation,
  onMemoryUpdated,
}: LitoContextPanelProps) {
  const [memoryTab, setMemoryTab] = useState<MemoryTab>('profile');
  const [profileSaving, setProfileSaving] = useState(false);
  const [voiceSaving, setVoiceSaving] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState({
    vertical: '',
    audience: '',
    city: '',
    country: '',
    notes: '',
  });

  const [voiceForm, setVoiceForm] = useState({
    tone: '',
    formality: '',
    doWords: '',
    avoidWords: '',
  });

  useEffect(() => {
    const profile = (memory?.profile?.profile_json || {}) as Record<string, unknown>;
    setProfileForm({
      vertical: typeof profile.vertical === 'string' ? profile.vertical : businessVertical,
      audience: typeof profile.audience === 'string' ? profile.audience : '',
      city: typeof profile.city === 'string' ? profile.city : '',
      country: typeof profile.country === 'string' ? profile.country : '',
      notes: typeof profile.notes === 'string' ? profile.notes : '',
    });

    const voice = (memory?.voice?.voice_json || {}) as Record<string, unknown>;
    setVoiceForm({
      tone: typeof voice.tone === 'string' ? voice.tone : '',
      formality: typeof voice.formality === 'string' ? voice.formality : '',
      doWords: toStringArray(voice.do_words).join(', '),
      avoidWords: toStringArray(voice.avoid_words).join(', '),
    });
  }, [businessVertical, memory]);

  const gbpLabel = (() => {
    if (gbpState === 'connected') return t('dashboard.litoPage.context.gbpConnected');
    if (gbpState === 'needs_reauth') return t('dashboard.litoPage.context.gbpNeedsReauth');
    if (gbpState === 'not_connected') return t('dashboard.litoPage.context.gbpNotConnected');
    return t('dashboard.litoPage.context.gbpUnknown');
  })();

  const selectedPolicies = useMemo(() => (memory?.policies_top || []).slice(0, 5), [memory?.policies_top]);
  const recentEvents = useMemo(() => (memory?.events_recent || []).slice(0, 8), [memory?.events_recent]);

  const persistProfile = async () => {
    setProfileSaving(true);
    setMemoryError(null);
    try {
      const response = await fetch('/api/memory/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: bizId,
          profile: {
            vertical: profileForm.vertical.trim(),
            audience: profileForm.audience.trim(),
            city: profileForm.city.trim(),
            country: profileForm.country.trim(),
            notes: profileForm.notes.trim(),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        profile?: LitoMemoryContext['profile'];
        error?: string;
        message?: string;
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'No s\'ha pogut desar el perfil.');
      }

      onMemoryUpdated({
        profile: payload.profile || memory?.profile || null,
        voice: memory?.voice || null,
        policies_top: memory?.policies_top || [],
        events_recent: memory?.events_recent || [],
      });
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'No s\'ha pogut desar el perfil.');
    } finally {
      setProfileSaving(false);
    }
  };

  const persistVoice = async () => {
    setVoiceSaving(true);
    setMemoryError(null);
    try {
      const response = await fetch('/api/memory/voice', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        body: JSON.stringify({
          biz_id: bizId,
          voice: {
            tone: voiceForm.tone.trim(),
            formality: voiceForm.formality.trim(),
            do_words: voiceForm.doWords.split(',').map((item) => item.trim()).filter(Boolean),
            avoid_words: voiceForm.avoidWords.split(',').map((item) => item.trim()).filter(Boolean),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        voice?: LitoMemoryContext['voice'];
        error?: string;
        message?: string;
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.message || 'No s\'ha pogut desar el to de marca.');
      }

      onMemoryUpdated({
        profile: memory?.profile || null,
        voice: payload.voice || memory?.voice || null,
        policies_top: memory?.policies_top || [],
        events_recent: memory?.events_recent || [],
      });
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : 'No s\'ha pogut desar el to de marca.');
    } finally {
      setVoiceSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/45 p-4 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>
          {t('dashboard.litoPage.context.title')}
        </h2>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            {quota?.limit
              ? t('dashboard.home.recommendations.lito.quotaBadge', { used: quota.used, limit: quota.limit })
              : t('dashboard.litoPage.context.quotaUnknown')}
          </span>
          {trialState === 'active' ? (
            <span className="rounded-full border border-cyan-300/35 bg-cyan-500/12 px-2.5 py-1 text-[11px] font-medium text-cyan-200">
              {t('dashboard.litoPage.trial.activeBadge', { days: trialDaysLeft })}
            </span>
          ) : null}
          {trialState === 'ended' ? (
            <span className="rounded-full border border-amber-300/35 bg-amber-500/12 px-2.5 py-1 text-[11px] font-medium text-amber-200">
              {t('dashboard.litoPage.trial.readOnlyBadge')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-xl border border-white/8 bg-black/20 p-3">
        <p className={cn('text-sm font-medium text-white/90')}>{businessName}</p>
        <p className={cn('text-xs', textSub)}>
          {t('dashboard.litoPage.context.vertical')}: {formatVerticalLabel(businessVertical)}
        </p>
        <p className={cn('text-xs', textSub)}>
          {t('dashboard.litoPage.context.language')}: {businessLanguage || 'ca'}
        </p>
        <p className={cn('text-xs', textSub)}>
          {t('dashboard.litoPage.context.gbp')}: {gbpLabel}
        </p>
        <p className={cn('text-xs', textSub)}>
          {t('dashboard.litoPage.context.role')}: {viewerRole || 'staff'}
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-semibold uppercase tracking-wide text-white/75')}>
            Context del negoci
          </p>
          <span className={cn('text-[11px]', textSub)}>
            {memoryLoading ? 'Carregant…' : `Actualitzat ${fmtDate(memory?.profile?.updated_at || memory?.voice?.updated_at)}`}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1">
          <button
            type="button"
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              memoryTab === 'profile' ? 'bg-emerald-500/16 text-emerald-200' : 'bg-white/6 text-white/65 hover:bg-white/10',
            )}
            onClick={() => setMemoryTab('profile')}
          >
            Perfil
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              memoryTab === 'voice' ? 'bg-emerald-500/16 text-emerald-200' : 'bg-white/6 text-white/65 hover:bg-white/10',
            )}
            onClick={() => setMemoryTab('voice')}
          >
            To
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              memoryTab === 'policies' ? 'bg-emerald-500/16 text-emerald-200' : 'bg-white/6 text-white/65 hover:bg-white/10',
            )}
            onClick={() => setMemoryTab('policies')}
          >
            Polítiques
          </button>
          <button
            type="button"
            className={cn(
              'rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
              memoryTab === 'events' ? 'bg-emerald-500/16 text-emerald-200' : 'bg-white/6 text-white/65 hover:bg-white/10',
            )}
            onClick={() => setMemoryTab('events')}
          >
            Historial
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {memoryTab === 'profile' ? (
            <>
              <input
                value={profileForm.vertical}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, vertical: event.target.value }))}
                placeholder="Vertical"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <input
                value={profileForm.audience}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, audience: event.target.value }))}
                placeholder="Audiència principal"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={profileForm.city}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, city: event.target.value }))}
                  placeholder="Ciutat"
                  className="h-8 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
                />
                <input
                  value={profileForm.country}
                  onChange={(event) => setProfileForm((prev) => ({ ...prev, country: event.target.value }))}
                  placeholder="País"
                  className="h-8 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
                />
              </div>
              <textarea
                value={profileForm.notes}
                onChange={(event) => setProfileForm((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Notes de marca"
                className="min-h-[72px] w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <div className="flex justify-end">
                <Button size="sm" className="h-7 px-3 text-xs" loading={profileSaving} onClick={() => void persistProfile()}>
                  Desar perfil
                </Button>
              </div>
            </>
          ) : null}

          {memoryTab === 'voice' ? (
            <>
              <input
                value={voiceForm.tone}
                onChange={(event) => setVoiceForm((prev) => ({ ...prev, tone: event.target.value }))}
                placeholder="To de marca (ex: proper i premium)"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <input
                value={voiceForm.formality}
                onChange={(event) => setVoiceForm((prev) => ({ ...prev, formality: event.target.value }))}
                placeholder="Formalitat (tu/vostè)"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <input
                value={voiceForm.doWords}
                onChange={(event) => setVoiceForm((prev) => ({ ...prev, doWords: event.target.value }))}
                placeholder="Paraules recomanades (coma)"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <input
                value={voiceForm.avoidWords}
                onChange={(event) => setVoiceForm((prev) => ({ ...prev, avoidWords: event.target.value }))}
                placeholder="Paraules a evitar (coma)"
                className="h-8 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs text-white outline-none focus:border-emerald-300/35"
              />
              <div className="flex justify-end">
                <Button size="sm" className="h-7 px-3 text-xs" loading={voiceSaving} onClick={() => void persistVoice()}>
                  Desar to
                </Button>
              </div>
            </>
          ) : null}

          {memoryTab === 'policies' ? (
            selectedPolicies.length > 0 ? (
              <div className="space-y-1.5">
                {selectedPolicies.map((policy) => (
                  <div key={policy.id} className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white/90">{policy.kind}</p>
                      <span className="text-[10px] text-white/50">p{policy.priority}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-white/65">
                      {JSON.stringify(policy.rules_json).slice(0, 120)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={cn('rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-xs', textSub)}>
                No hi ha polítiques guardades.
              </p>
            )
          ) : null}

          {memoryTab === 'events' ? (
            recentEvents.length > 0 ? (
              <div className="space-y-1.5">
                {recentEvents.map((event) => (
                  <div key={event.id} className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-white/90">{event.type}</p>
                      <span className="text-[10px] text-white/50">{fmtDate(event.occurred_at)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/72">{event.summary}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className={cn('rounded-lg border border-white/8 bg-white/4 px-2.5 py-2 text-xs', textSub)}>
                Encara no hi ha historial de memòria.
              </p>
            )
          ) : null}

          {memoryError ? (
            <p className="rounded-lg border border-rose-300/25 bg-rose-500/12 px-2.5 py-2 text-xs text-rose-200">
              {memoryError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={cn('text-xs uppercase tracking-wide text-white/55')}>
          {t('dashboard.litoPage.context.signalsTitle')}
        </p>
        <div className="flex items-center gap-2">
          {(viewerRole === 'owner' || viewerRole === 'manager') ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs text-white/80 hover:text-white"
              onClick={onRecalculateSignals}
              disabled={recalculateLoading}
            >
              {recalculateLoading
                ? t('dashboard.litoPage.context.recalculateSignalsLoading')
                : t('dashboard.litoPage.context.recalculateSignals')}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={onOpenGeneral}>
            {t('dashboard.litoPage.context.askLito')}
          </Button>
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-white/10 bg-white/6 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('text-xs font-medium text-white/85')}>
            {t('dashboard.litoPage.voice.widgetTitle')}
          </p>
          <span className="rounded-full border border-amber-300/30 bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
            {voicePendingCount}
          </span>
        </div>
        <p className={cn('mt-1 text-[11px]', textSub)}>
          {voicePendingCount > 0
            ? t('dashboard.litoPage.voice.widgetPending', { count: voicePendingCount })
            : t('dashboard.litoPage.voice.widgetEmpty')}
        </p>
      </div>

      <div className="mt-2 space-y-2">
        {recommendationsLoading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
            <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
            <div className="h-14 animate-pulse rounded-xl border border-white/8 bg-white/6" />
          </div>
        ) : recommendations.length > 0 ? (
          recommendations.slice(0, 3).map((item) => {
            const selected = selectedRecommendationId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectRecommendation(item)}
                className={cn(
                  'w-full rounded-xl border px-3 py-2 text-left transition-all duration-200 ease-premium',
                  selected
                    ? 'border-emerald-300/45 bg-emerald-500/12'
                    : 'border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/8',
                )}
              >
                <div className="flex items-center gap-2">
                  <p className="text-[11px] uppercase tracking-wide text-white/55">{item.format}</p>
                  {item.source === 'signal' && (
                    <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                      Per Que?
                    </span>
                  )}
                </div>
                <p className={cn('mt-0.5 text-sm font-medium text-white/90')}>{item.hook}</p>
                <p className={cn('mt-1 text-xs', textSub)}>{buildSignalReason(item)}</p>
                <p className="mt-1 text-[11px] font-medium text-emerald-200/90">
                  {item.source === 'signal'
                    ? 'Veure amb LITO'
                    : t('dashboard.litoPage.openWithLito')}
                </p>
              </button>
            );
          })
        ) : (
          <p className={cn('rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-xs', textSub)}>
            {t('dashboard.home.recommendations.empty')}
          </p>
        )}
      </div>
    </section>
  );
}
