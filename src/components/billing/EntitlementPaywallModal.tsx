'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useT } from '@/components/i18n/I18nContext';
import { cn } from '@/lib/utils';
import { textMain, textSub } from '@/components/ui/glass';

export type EntitlementModalType = 'quota_exceeded' | 'feature_locked' | 'limit_reached';

type Props = {
  isOpen: boolean;
  type: EntitlementModalType;
  used?: number;
  limit?: number;
  onClose: () => void;
};

export default function EntitlementPaywallModal({
  isOpen,
  type,
  used,
  limit,
  onClose,
}: Props) {
  const t = useT();

  if (!isOpen) return null;

  const titleKey = `billing.entitlement.${type}_title` as const;
  const title = t(titleKey);

  let message: string;
  if (type === 'quota_exceeded' && typeof used === 'number' && typeof limit === 'number') {
    message = t('billing.entitlement.quota_exceeded_msg', {
      used: String(used),
      limit: String(limit),
    });
  } else if (type === 'quota_exceeded') {
    message = t('billing.entitlement.quota_exceeded_msg_simple');
  } else {
    message = t(`billing.entitlement.${type}_msg`);
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px]"
      onClick={onClose}
      data-testid="entitlement-paywall-backdrop"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/12 bg-zinc-900/92 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3 className={cn('text-lg font-semibold', textMain)}>{title}</h3>
        <p className={cn('mt-2 text-sm', textSub)}>{message}</p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('billing.entitlement.close')}
          </Button>
          <Link href="/dashboard/plans">
            <Button size="sm">{t('billing.entitlement.view_plans')}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
