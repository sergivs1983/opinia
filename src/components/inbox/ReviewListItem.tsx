'use client';

import type { MouseEvent } from 'react';
import type { Review } from '@/types/database';
import Badge from '@/components/ui/Badge';
import { useLocale, useT } from '@/components/i18n/I18nContext';
import { cn, sentimentDot, sourceIcon, sourceLabel, timeAgo, truncate } from '@/lib/utils';
import { glass, glassActive, textMain, textMuted, textSub } from '@/components/ui/glass';

type ItemStatus = 'pending' | 'generated' | 'published';

interface ReviewListItemProps {
  review: Review;
  selected: boolean;
  onSelect: (reviewId: string) => void;
  onDelete?: (reviewId: string, event: MouseEvent<HTMLButtonElement>) => void;
}

function resolveItemStatus(review: Review): ItemStatus {
  if (review.is_replied) return 'published';
  const hasGenerated = (review.replies || []).some((reply) => reply.status === 'draft' || reply.status === 'selected');
  return hasGenerated ? 'generated' : 'pending';
}

function statusBadge(itemStatus: ItemStatus): { tone: 'draft' | 'selected' | 'published'; labelKey: string } {
  if (itemStatus === 'published') return { tone: 'published', labelKey: 'dashboard.inbox.replied' };
  if (itemStatus === 'generated') return { tone: 'selected', labelKey: 'dashboard.inbox.statusGenerated' };
  return { tone: 'draft', labelKey: 'dashboard.inbox.pendingFilter' };
}

export default function ReviewListItem({ review, selected, onSelect, onDelete }: ReviewListItemProps) {
  const t = useT();
  const locale = useLocale();
  const itemStatus = resolveItemStatus(review);
  const badge = statusBadge(itemStatus);

  return (
    <article
      className={cn(
        'group rounded-xl border p-4 transition-all duration-[220ms] ease-premium',
        selected ? cn(glassActive, 'ring-1 ring-brand-accent/45') : cn(glass, 'hover:bg-white/10'),
      )}
      data-testid="inbox-review-item"
      data-review-id={review.id}
    >
      <button
        type="button"
        onClick={() => onSelect(review.id)}
        data-testid={`inbox-review-item-${review.id}`}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'h-10 w-10 shrink-0 rounded-full border text-center text-sm font-bold leading-10',
              review.rating >= 4
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : review.rating === 3
                  ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                  : 'border-red-500/40 bg-red-500/20 text-red-300',
            )}
          >
            {review.rating}★
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={cn('truncate text-sm font-semibold', textMain)}>{review.author_name || t('dashboard.home.meta.anonymousAuthor')}</p>
              <span className={cn('ml-auto text-[11px]', textMuted)}>{timeAgo(review.review_date || review.created_at, t, locale)}</span>
            </div>

            <p className={cn('mt-0.5 text-xs', textSub)}>
              {sourceIcon(review.source)} {sourceLabel(review.source, t)}
            </p>

            <p className={cn('mt-2 text-sm leading-relaxed', textSub)}>{truncate(review.review_text, 140)}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', sentimentDot(review.sentiment))} />
              <Badge kind="status" tone={badge.tone} className="text-[10px] uppercase">
                {t(badge.labelKey)}
              </Badge>
              <Badge variant="default" className="text-[10px] uppercase">
                {review.language_detected?.toUpperCase() || 'NA'}
              </Badge>
            </div>
          </div>
        </div>
      </button>

      {onDelete && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(event) => onDelete(review.id, event)}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-red-500/20 hover:text-red-300"
            title={t('common.delete')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
    </article>
  );
}
