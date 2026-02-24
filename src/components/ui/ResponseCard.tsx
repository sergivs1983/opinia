'use client';

import { cn, toneLabel, toneIcon, toneBg, toneBadge, toneDescription } from '@/lib/utils';
import type { ReplyTone } from '@/types/database';
import { glass, textMuted, textSub } from '@/components/ui/glass';

interface ResponseCardProps {
  tone: ReplyTone;
  content: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onContentChange?: (content: string) => void;
}

export default function ResponseCard({ tone, content, isSelected, onSelect, onContentChange }: ResponseCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 transition-all cursor-pointer duration-[220ms] ease-premium',
        isSelected ? toneBg(tone) + ' shadow-float scale-[1.02]' : cn(glass, 'hover:border-white/20 hover:shadow-glass'),
      )}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold', toneBadge(tone))}>
          {toneIcon(tone)} {toneLabel(tone)}
        </span>
        {isSelected && (
          <svg className="w-5 h-5 text-brand-accent ml-auto" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        )}
      </div>

      {/* Content */}
      {onContentChange ? (
        <textarea
          value={content}
          onChange={e => onContentChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          className={cn('w-full min-h-[100px] text-sm leading-relaxed bg-transparent resize-y focus:outline-none', textSub)}
        />
      ) : (
        <p className={cn('text-sm leading-relaxed whitespace-pre-wrap', textSub)}>{content}</p>
      )}

      {/* Description */}
      <p className={cn('text-[11px] mt-3 italic', textMuted)}>{toneDescription(tone)}</p>
    </div>
  );
}
