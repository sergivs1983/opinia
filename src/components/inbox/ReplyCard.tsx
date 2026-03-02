'use client';

import { useEffect, useState } from 'react';
import type { GuardrailWarning, Reply, ReplyTone, Review } from '@/types/database';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import LitoCard from '@/components/ui/LitoCard';
import SeoChips from '@/components/inbox/SeoChips';
import GuardrailStatusBadge from '@/components/inbox/GuardrailStatusBadge';
import { useT } from '@/components/i18n/I18nContext';
import { cn, toneDescription } from '@/lib/utils';
import { tokens, cx } from '@/lib/design/tokens';

type GenerateErrorState = {
  message: string;
  requestId: string | null;
};

interface ReplyCardProps {
  review: Review | null;
  replies: Reply[];
  selectedTone: ReplyTone;
  value: string;
  generating: boolean;
  approving: boolean;
  guardrailWarnings: GuardrailWarning[];
  guardrailAcknowledged: boolean;
  seoEnabled: boolean;
  seoAggressiveness: number;
  seoKeywords: string[];
  error: GenerateErrorState | null;
  copiedRequestId: boolean;
  onToneChange: (tone: ReplyTone) => void;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onApprove: () => void;
  onCopy: () => void;
  onGuardrailAcknowledge: (value: boolean) => void;
  onCopyRequestId: () => void;
}

const REPLY_TABS: Array<{ tone: ReplyTone; labelKey: string }> = [
  { tone: 'proper', labelKey: 'dashboard.inbox.option1' },
  { tone: 'professional', labelKey: 'dashboard.inbox.option2' },
  { tone: 'premium', labelKey: 'dashboard.inbox.option3' },
];

export default function ReplyCard({
  review,
  replies,
  selectedTone,
  value,
  generating,
  approving,
  guardrailWarnings,
  guardrailAcknowledged,
  seoEnabled,
  seoAggressiveness,
  seoKeywords,
  error,
  copiedRequestId,
  onToneChange,
  onChange,
  onGenerate,
  onApprove,
  onCopy,
  onGuardrailAcknowledge,
  onCopyRequestId,
}: ReplyCardProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState(() => {
    const index = REPLY_TABS.findIndex((tab) => tab.tone === selectedTone);
    return index >= 0 ? index : 1;
  });
  const hasReplies = replies.length > 0;
  const currentReply = replies.find((reply) => reply.tone === selectedTone);
  const hasWarnings = guardrailWarnings.length > 0;
  const publishBlocked = hasWarnings && !guardrailAcknowledged;

  useEffect(() => {
    const index = REPLY_TABS.findIndex((tab) => tab.tone === selectedTone);
    if (index >= 0) {
      setActiveTab((previous) => (previous === index ? previous : index));
    }
  }, [selectedTone]);

  if (!review) {
    return (
      <LitoCard spotlight={false} className="flex h-full min-h-[320px] items-center justify-center p-6" data-testid="inbox-reply-card">
        <p className={cx('text-sm', tokens.text.secondary)}>{t('dashboard.inbox.selectReviewHint')}</p>
      </LitoCard>
    );
  }

  return (
    <LitoCard
      spotlight={false}
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="inbox-reply-card"
    >
      <header className={cx('sticky top-0 z-10 px-4 py-3', tokens.border.divider, tokens.bg.surface)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className={cx('font-display text-lg font-semibold', tokens.text.primary)}>{t('dashboard.inbox.replyTitle')}</h3>
            <p className={cx('mt-0.5 text-xs', tokens.text.secondary)}>{t('dashboard.inbox.optionsCount')}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={onCopy} disabled={!value}>
              {t('dashboard.inbox.copy')}
            </Button>
            <Button
              size="sm"
              variant={hasReplies ? 'secondary' : 'primary'}
              onClick={onGenerate}
              loading={generating}
              data-testid="inbox-generate-reply"
            >
              <span data-testid="review-generate">{hasReplies ? t('dashboard.inbox.regenerate') : t('dashboard.inbox.generateResponses')}</span>
            </Button>
          </div>
        </div>
        <p className={cx('mt-1 text-xs', tokens.text.secondary)}>{review.author_name || t('dashboard.home.meta.anonymousAuthor')}</p>
      </header>

      <div className={cx('px-4 pb-3 pt-3', tokens.border.divider)}>
        <div className={cx('rounded-2xl p-1', tokens.border.subtle, tokens.bg.subtle)}>
          <div className="flex items-center gap-1">
            {REPLY_TABS.map((tab, index) => {
              const isActive = selectedTone === tab.tone && activeTab === index;
              return (
                <button
                  key={tab.tone}
                  type="button"
                  onClick={() => {
                    setActiveTab(index);
                    if (selectedTone !== tab.tone) onToneChange(tab.tone);
                  }}
                  className={cn(
                    'relative flex-1 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-[220ms] ease-premium',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
                    isActive
                      ? 'border border-[#d4d3ce] bg-white text-[#1a1917] shadow-[0_0_0_1px_rgba(16,185,129,0.25)]'
                      : 'border border-transparent bg-transparent text-[#6b6a65] hover:border-[#e5e4df] hover:bg-white hover:text-[#1a1917]',
                  )}
                  data-testid={`reply-option-tab-${index + 1}`}
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-[#e7e6e1] via-[#f1f0eb] to-transparent" />
        <p className={cx('mt-2 text-xs', tokens.text.secondary)}>{toneDescription(selectedTone, t)}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <SeoChips enabled={seoEnabled} aggressiveness={seoAggressiveness} keywords={seoKeywords} />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">{selectedTone}</Badge>
          <GuardrailStatusBadge warningsCount={guardrailWarnings.length} />
        </div>

        {error && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3" data-testid="generate-error-box">
            <p className="text-sm font-medium text-red-700">{error.message}</p>
            {error.requestId && (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-red-700" data-testid="generate-error-request-id">ID: {error.requestId}</span>
                <button
                  type="button"
                  onClick={onCopyRequestId}
                  className="text-xs text-red-700 underline underline-offset-2 hover:text-red-800"
                  data-testid="generate-error-copy-id"
                >
                  {copiedRequestId ? t('dashboard.inbox.idCopied') : t('dashboard.inbox.copyId')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className={cx('rounded-2xl p-4', tokens.border.subtle, tokens.bg.subtle)}>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t('dashboard.inbox.noReplyYet')}
            data-testid="review-response-editor"
            className={cx('min-h-[240px] w-full resize-y bg-transparent text-sm leading-relaxed focus:outline-none', tokens.text.primary)}
          />
          <div className={cx('mt-3 flex items-center justify-between gap-2 pt-2', tokens.border.divider)}>
            <p className={cx('text-xs', tokens.text.secondary)}>
              {t('dashboard.inbox.chars')}: {value.length}
            </p>
            <Badge variant="brand">{t(REPLY_TABS[activeTab]?.labelKey || REPLY_TABS[1].labelKey)}</Badge>
          </div>
        </div>

        {hasWarnings && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-700">{t('dashboard.inbox.guardrailWarning')}</p>
            <ul className="mt-2 space-y-1">
              {guardrailWarnings.map((warning, index) => (
                <li key={`${warning.type}-${index}`} className="text-sm text-red-700">
                  • {warning.text}
                </li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 text-sm text-red-700">
              <input
                type="checkbox"
                checked={guardrailAcknowledged}
                onChange={(event) => onGuardrailAcknowledge(event.target.checked)}
                className="rounded border-red-300"
              />
              {t('dashboard.inbox.guardrailAcknowledge')}
            </label>
          </div>
        )}
      </div>

      <footer className={cx('px-4 py-3', tokens.border.divider)}>
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={onApprove}
            loading={approving}
            disabled={!currentReply || !value || publishBlocked || currentReply.status === 'published'}
          >
            {currentReply?.status === 'published' ? '✅' : t('dashboard.inbox.approve')}
          </Button>
        </div>
      </footer>
    </LitoCard>
  );
}
