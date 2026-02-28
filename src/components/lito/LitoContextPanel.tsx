'use client';

import Button from '@/components/ui/Button';
import { textMain, textSub } from '@/components/ui/glass';
import { cn } from '@/lib/utils';
import type { LitoQuotaState, LitoRecommendationItem, LitoViewerRole } from '@/components/lito/types';

type LitoContextPanelProps = {
  t: (key: string, vars?: Record<string, string | number>) => string;
  businessName: string;
  businessVertical: string;
  businessLanguage: string;
  gbpState: 'connected' | 'needs_reauth' | 'not_connected' | 'unknown';
  viewerRole: LitoViewerRole;
  recommendations: LitoRecommendationItem[];
  recommendationsLoading: boolean;
  quota: LitoQuotaState | null;
  selectedRecommendationId: string | null;
  onOpenGeneral: () => void;
  onSelectRecommendation: (item: LitoRecommendationItem) => void;
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

export default function LitoContextPanel({
  t,
  businessName,
  businessVertical,
  businessLanguage,
  gbpState,
  viewerRole,
  recommendations,
  recommendationsLoading,
  quota,
  selectedRecommendationId,
  onOpenGeneral,
  onSelectRecommendation,
}: LitoContextPanelProps) {
  const gbpLabel = (() => {
    if (gbpState === 'connected') return t('dashboard.litoPage.context.gbpConnected');
    if (gbpState === 'needs_reauth') return t('dashboard.litoPage.context.gbpNeedsReauth');
    if (gbpState === 'not_connected') return t('dashboard.litoPage.context.gbpNotConnected');
    return t('dashboard.litoPage.context.gbpUnknown');
  })();

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/45 p-4 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn('text-sm font-semibold tracking-wide', textMain)}>
          {t('dashboard.litoPage.context.title')}
        </h2>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
          {quota?.limit
            ? t('dashboard.home.recommendations.lito.quotaBadge', { used: quota.used, limit: quota.limit })
            : t('dashboard.litoPage.context.quotaUnknown')}
        </span>
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

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={cn('text-xs uppercase tracking-wide text-white/55')}>
          {t('dashboard.litoPage.context.signalsTitle')}
        </p>
        <Button size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={onOpenGeneral}>
          {t('dashboard.litoPage.context.askLito')}
        </Button>
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
