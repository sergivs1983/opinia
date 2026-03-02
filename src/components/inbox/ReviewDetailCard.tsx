'use client';

import type { Review } from '@/types/database';
import Badge from '@/components/ui/Badge';
import LitoCard from '@/components/ui/LitoCard';
import { useLocale, useT } from '@/components/i18n/I18nContext';
import { cn, sentimentDot, sentimentEmoji, sentimentLabel, sourceIcon, sourceLabel, starsString, timeAgo } from '@/lib/utils';
import { tokens, cx } from '@/lib/design/tokens';

interface ReviewDetailCardProps {
  review: Review | null;
  topics?: string[];
}

export default function ReviewDetailCard({ review, topics = [] }: ReviewDetailCardProps) {
  const t = useT();
  const locale = useLocale();

  if (!review) {
    return (
      <LitoCard spotlight={false} className="flex h-full min-h-[320px] items-center justify-center p-6" data-testid="inbox-review-detail">
        <p className={cx('text-sm', tokens.text.secondary)}>{t('dashboard.inbox.noSelection')}</p>
      </LitoCard>
    );
  }

  return (
    <LitoCard spotlight={false} className="h-full overflow-y-auto p-5" data-testid="review-detail-page">
      <div data-testid="inbox-review-detail" className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={cx('font-display text-xl font-semibold', tokens.text.primary)}>{t('dashboard.inbox.detailTitle')}</h2>
            <p className={cx('mt-1 text-xs', tokens.text.secondary)}>{timeAgo(review.review_date || review.created_at, t, locale)}</p>
          </div>
          <Badge variant="default" className="text-xs uppercase">
            {review.language_detected?.toUpperCase() || 'NA'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge kind="platform" tone={review.source === 'manual' || review.source === 'other' ? 'manual' : review.source}>
            {sourceIcon(review.source)} {sourceLabel(review.source, t)}
          </Badge>
          <span className={cx('text-sm font-semibold', tokens.text.primary)}>{starsString(review.rating)}</span>
          <span className={cx('inline-flex items-center gap-1 text-xs', tokens.text.secondary)}>
            <span className={cn('h-2 w-2 rounded-full', sentimentDot(review.sentiment))} />
            {sentimentEmoji(review.sentiment)} {sentimentLabel(review.sentiment, t)}
          </span>
        </div>

        <div className={cx('rounded-xl p-4', tokens.border.subtle, tokens.bg.subtle)}>
          <p className={cx('whitespace-pre-wrap text-sm leading-relaxed', tokens.text.primary)}>{review.review_text}</p>
        </div>

        {topics.length > 0 && (
          <div className="space-y-2">
            <p className={cx('text-[11px] font-semibold uppercase tracking-[0.1em]', tokens.text.secondary)}>
              {t('dashboard.inbox.topicTags')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full border border-emerald-300/45 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </LitoCard>
  );
}
