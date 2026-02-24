'use client';

import type { Review } from '@/types/database';
import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/components/i18n/I18nContext';
import { cn, sentimentDot, sentimentEmoji, sentimentLabel, sourceIcon, sourceLabel, starsString, timeAgo } from '@/lib/utils';
import { glassStrong, textMain, textMuted, textSub } from '@/components/ui/glass';

interface ReviewDetailCardProps {
  review: Review | null;
  topics?: string[];
}

export default function ReviewDetailCard({ review, topics = [] }: ReviewDetailCardProps) {
  const t = useT();
  const locale = useLocale();

  if (!review) {
    return (
      <section className={cn(glassStrong, 'flex h-full min-h-[320px] items-center justify-center p-6')} data-testid="inbox-review-detail">
        <p className={cn('text-sm', textMuted)}>{t('dashboard.inbox.noSelection')}</p>
      </section>
    );
  }

  return (
    <section className={cn(glassStrong, 'h-full overflow-y-auto p-5')} data-testid="review-detail-page">
      <div data-testid="inbox-review-detail" className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={cn('font-display text-xl font-semibold', textMain)}>{t('dashboard.inbox.detailTitle')}</h2>
            <p className={cn('mt-1 text-xs', textMuted)}>{timeAgo(review.review_date || review.created_at, t, locale)}</p>
          </div>
          <Badge variant="default" className="text-xs uppercase">
            {review.language_detected?.toUpperCase() || 'NA'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="platform" tone={review.source === 'manual' || review.source === 'other' ? 'manual' : review.source}>
            {sourceIcon(review.source)} {sourceLabel(review.source, t)}
          </Badge>
          <span className={cn('text-sm font-semibold text-amber-300')}>{starsString(review.rating)}</span>
          <span className={cn('inline-flex items-center gap-1 text-xs', textSub)}>
            <span className={cn('h-2 w-2 rounded-full', sentimentDot(review.sentiment))} />
            {sentimentEmoji(review.sentiment)} {sentimentLabel(review.sentiment, t)}
          </span>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <p className={cn('text-sm leading-relaxed whitespace-pre-wrap', textSub)}>{review.review_text}</p>
        </div>

        {topics.length > 0 && (
          <div className="space-y-2">
            <p className={cn('text-[11px] font-semibold uppercase tracking-[0.1em]', textMuted)}>
              {t('dashboard.inbox.topicTags')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-cyan-400/35 bg-cyan-500/15 px-2 py-1 text-[11px] font-medium text-cyan-200"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
