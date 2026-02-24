'use client';

import { useEffect, useState } from 'react';
import type { GuardrailWarning, Reply, ReplyTone, Review } from '@/types/database';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import SeoChips from '@/components/inbox/SeoChips';
import GuardrailStatusBadge from '@/components/inbox/GuardrailStatusBadge';
import { useT } from '@/components/i18n/I18nContext';
import { cn, toneDescription } from '@/lib/utils';
import { glass, glassStrong, ringAccent, textMain, textMuted, textSub } from '@/components/ui/glass';

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
      <section className={cn(glassStrong, 'flex h-full min-h-[320px] items-center justify-center p-6')} data-testid="inbox-reply-card">
        <p className={cn('text-sm', textMuted)}>{t('dashboard.inbox.selectReviewHint')}</p>
      </section>
    );
  }

  return (
    <section
      className={cn(
        glassStrong,
        'flex h-full min-h-0 flex-col overflow-hidden border-white/12 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.7)]',
      )}
      data-testid="inbox-reply-card"
    >
      <header className="sticky top-0 z-10 border-b border-white/10 bg-gradient-to-b from-black/45 via-black/20 to-transparent px-4 py-3 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className={cn('font-display text-lg font-semibold', textMain)}>{t('dashboard.inbox.replyTitle')}</h3>
            <p className={cn('mt-0.5 text-xs', textMuted)}>{t('dashboard.inbox.optionsCount')}</p>
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
        <p className={cn('mt-1 text-xs', textMuted)}>{review.author_name || t('dashboard.home.meta.anonymousAuthor')}</p>
      </header>

      <div className="border-b border-white/10 px-4 pb-3 pt-3">
        <div className="rounded-2xl border border-white/12 bg-white/5 p-1 backdrop-blur-xl">
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
                    ringAccent,
                    isActive
                      ? 'bg-white/12 text-white border border-white/20 shadow-[0_0_0_1px_rgba(34,197,94,0.25)] ring-1 ring-emerald-400/20'
                      : 'bg-white/5 text-white/75 border border-transparent hover:bg-white/8 hover:border-white/15 hover:text-white/90',
                  )}
                  data-testid={`reply-option-tab-${index + 1}`}
                >
                  {t(tab.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3 h-px w-full bg-gradient-to-r from-white/15 via-white/8 to-transparent" />
        <p className={cn('mt-2 text-xs', textSub)}>{toneDescription(selectedTone, t)}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <SeoChips enabled={seoEnabled} aggressiveness={seoAggressiveness} keywords={seoKeywords} />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">{selectedTone}</Badge>
          <GuardrailStatusBadge warningsCount={guardrailWarnings.length} />
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/35 bg-red-500/12 p-3" data-testid="generate-error-box">
            <p className="text-sm font-medium text-red-200">{error.message}</p>
            {error.requestId && (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-red-200" data-testid="generate-error-request-id">ID: {error.requestId}</span>
                <button
                  type="button"
                  onClick={onCopyRequestId}
                  className="text-xs text-red-200 underline underline-offset-2 hover:text-red-100"
                  data-testid="generate-error-copy-id"
                >
                  {copiedRequestId ? t('dashboard.inbox.idCopied') : t('dashboard.inbox.copyId')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={t('dashboard.inbox.noReplyYet')}
            data-testid="review-response-editor"
            className="min-h-[240px] w-full resize-y bg-transparent text-sm leading-relaxed text-white/92 focus:outline-none"
          />
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
            <p className={cn('text-xs', textMuted)}>
              {t('dashboard.inbox.chars')}: {value.length}
            </p>
            <Badge variant="brand">{t(REPLY_TABS[activeTab]?.labelKey || REPLY_TABS[1].labelKey)}</Badge>
          </div>
        </div>

        {hasWarnings && (
          <div className={cn(glass, 'rounded-xl border-red-500/35 bg-red-500/12 p-4')}>
            <p className="text-sm font-semibold text-red-200">{t('dashboard.inbox.guardrailWarning')}</p>
            <ul className="mt-2 space-y-1">
              {guardrailWarnings.map((warning, index) => (
                <li key={`${warning.type}-${index}`} className="text-sm text-red-100">
                  • {warning.text}
                </li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 text-sm text-red-100">
              <input
                type="checkbox"
                checked={guardrailAcknowledged}
                onChange={(event) => onGuardrailAcknowledge(event.target.checked)}
                className="rounded border-red-300/40"
              />
              {t('dashboard.inbox.guardrailAcknowledge')}
            </label>
          </div>
        )}
      </div>

      <footer className="border-t border-white/10 px-4 py-3">
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
    </section>
  );
}
