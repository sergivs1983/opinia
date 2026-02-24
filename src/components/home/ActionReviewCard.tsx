'use client';

import Button from '@/components/ui/Button';
import Divider from '@/components/ui/Divider';
import GlassCard from '@/components/ui/GlassCard';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { textMain, textMuted } from '@/components/ui/glass';
import type { ReviewSource } from '@/types/database';

export type ActionReviewCardData = {
  id: string;
  rating: number;
  source: ReviewSource;
  author_name: string | null;
  created_at: string | null;
  review_text: string;
};

function stars(rating: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(rating || 0)));
  return `${'★'.repeat(clamped)}${'☆'.repeat(5 - clamped)}`;
}

function platformLabel(t: (key: string) => string, source: ReviewSource): string {
  switch (source) {
    case 'google':
      return t('dashboard.home.platform.google');
    case 'tripadvisor':
      return t('dashboard.home.platform.tripadvisor');
    case 'booking':
      return t('dashboard.home.platform.booking');
    case 'manual':
      return t('dashboard.home.platform.manual');
    default:
      return t('dashboard.home.platform.other');
  }
}

function timeAgoLabel(iso: string | null, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (!iso) return t('dashboard.home.meta.justNow');
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t('dashboard.home.meta.justNow');

  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const mins = Math.floor(diffMs / 60000);
  if (mins <= 0) return t('dashboard.home.meta.justNow');
  if (mins < 60) return t('dashboard.home.meta.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('dashboard.home.meta.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('dashboard.home.meta.daysAgo', { count: days });
}

type ActionReviewCardProps = {
  review: ActionReviewCardData;
  proposalText: string;
  approving?: boolean;
  generating?: boolean;
  removing?: boolean;
  showToneActions?: boolean;
  onEdit?: () => void;
  onRedo?: () => void;
  onApprove?: () => void;
  onToneApology?: () => void;
  onToneContact?: () => void;
  primaryLabel?: string;
  proposalTitle?: string;
  proposalConfidenceLine?: string;
  className?: string;
  testId?: string;
};

export default function ActionReviewCard({
  review,
  proposalText,
  approving = false,
  generating = false,
  removing = false,
  showToneActions = false,
  onEdit,
  onRedo,
  onApprove,
  onToneApology,
  onToneContact,
  primaryLabel,
  proposalTitle,
  proposalConfidenceLine,
  className,
  testId = 'home-review-card',
}: ActionReviewCardProps) {
  const t = useT();
  const author = review.author_name?.trim() || t('dashboard.home.meta.anonymousAuthor');

  return (
    <GlassCard
      variant="strong"
      className={cn(
        'space-y-4 p-5 transition-all duration-[260ms] ease-premium',
        removing && 'translate-y-3 scale-[0.985] opacity-0',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium text-amber-200">{stars(review.rating)}</span>
        <span className={textMain}>
          {t('dashboard.home.reviewLine', {
            author,
            platform: platformLabel(t, review.source),
          })}
        </span>
        <span className={textMuted}>· {timeAgoLabel(review.created_at, t)}</span>
      </div>

      <p className={cn('text-[15px] leading-relaxed', textMain)}>{review.review_text}</p>

      <Divider />

      <div className="rounded-2xl border border-white/10 bg-white/6 p-4 shadow-inner">
        <p className={cn('mb-2 text-xs font-semibold uppercase tracking-wide', textMuted)}>
          {proposalTitle || t('dashboard.home.proposalTitle')}
        </p>
        <p className={cn('text-sm leading-relaxed', textMain)}>{proposalText}</p>
        <p className={cn('mt-2 text-xs', textMuted)}>
          {proposalConfidenceLine || t('dashboard.home.proposalConfidenceLine')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
          {onEdit && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full border-white/10 bg-white/4 text-white/70 hover:bg-white/6 md:w-auto"
              onClick={onEdit}
            >
              {t('dashboard.home.actions.edit')}
            </Button>
          )}
          {onRedo && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-white/60 hover:text-white/80 md:w-auto"
              loading={generating}
              onClick={onRedo}
            >
              {t('dashboard.home.actions.redo')}
            </Button>
          )}

          {showToneActions && onToneApology && onToneContact && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-white/60 hover:text-white/80 md:w-auto"
                onClick={onToneApology}
              >
                {t('dashboard.home.actions.toneApology')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-white/60 hover:text-white/80 md:w-auto"
                onClick={onToneContact}
              >
                {t('dashboard.home.actions.toneContact')}
              </Button>
            </>
          )}
        </div>

        {onApprove && (
          <Button
            size="lg"
            className="w-full shadow-[0_14px_36px_rgba(0,168,107,0.24)] md:ml-auto md:w-auto md:min-w-[280px]"
            loading={approving}
            disabled={approving || generating || !proposalText.trim()}
            onClick={onApprove}
            data-testid="home-approve-publish"
          >
            {primaryLabel || t('dashboard.home.actions.approvePublish')}
          </Button>
        )}
      </div>
    </GlassCard>
  );
}
