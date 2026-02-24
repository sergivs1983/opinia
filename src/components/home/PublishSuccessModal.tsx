'use client';

import Button from '@/components/ui/Button';
import GlassCard from '@/components/ui/GlassCard';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

type PublishSuccessModalProps = {
  open: boolean;
  title: string;
  subtitle: string;
  benefitLine?: string;
  noAssetText: string;
  dismissLabel: string;
  downloadLabel: string;
  primaryLabel: string;
  assetUrl: string | null;
  assetLoading?: boolean;
  onDismiss: () => void;
  onPrimary: () => void;
  onDownload?: () => void;
};

export default function PublishSuccessModal({
  open,
  title,
  subtitle,
  benefitLine,
  noAssetText,
  dismissLabel,
  downloadLabel,
  primaryLabel,
  assetUrl,
  assetLoading = false,
  onDismiss,
  onPrimary,
  onDownload,
}: PublishSuccessModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close"
        onClick={onDismiss}
      />
      <GlassCard variant="strong" className="relative z-10 w-full max-w-2xl p-6 md:p-7">
        <h2 className={cn('text-xl font-semibold', textMain)}>{title}</h2>
        <p className={cn('mt-2 text-sm', textSub)}>{subtitle}</p>
        {benefitLine ? (
          <p className="mt-2 text-xs text-emerald-200/80">{benefitLine}</p>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/12 bg-black/25 p-2">
          {assetLoading ? (
            <div className="h-56 animate-pulse rounded-xl bg-white/8" />
          ) : assetUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={assetUrl} alt="Asset preview" className="h-56 w-full rounded-xl object-cover" />
          ) : (
            <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-white/14 bg-white/4 px-6 text-center text-sm text-white/70">
              {noAssetText}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-end">
          <Button variant="ghost" className="w-full text-white/65 hover:text-white/85 md:w-auto" onClick={onDismiss}>
            {dismissLabel}
          </Button>
          <Button
            variant="secondary"
            className="w-full md:w-auto"
            disabled={!assetUrl}
            onClick={onDownload}
          >
            {downloadLabel}
          </Button>
          <Button className="w-full md:w-auto md:min-w-[190px]" onClick={onPrimary}>
            {primaryLabel}
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
