'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
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

function titleFor(type: EntitlementModalType): string {
  if (type === 'feature_locked') return 'Funció bloquejada pel pla';
  if (type === 'limit_reached') return 'Límit del pla assolit';
  return 'Quota mensual esgotada';
}

function messageFor(type: EntitlementModalType, used?: number, limit?: number): string {
  if (type === 'feature_locked') {
    return 'Aquesta funció és del pla Business.';
  }
  if (type === 'limit_reached') {
    return 'Has arribat al límit de locals/usuaris del teu pla.';
  }
  if (typeof used === 'number' && typeof limit === 'number') {
    return `Has esgotat els Drafts LITO d'aquest mes (${used}/${limit}).`;
  }
  return "Has esgotat els Drafts LITO d'aquest mes.";
}

export default function EntitlementPaywallModal({
  isOpen,
  type,
  used,
  limit,
  onClose,
}: Props) {
  if (!isOpen) return null;

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
        <h3 className={cn('text-lg font-semibold', textMain)}>{titleFor(type)}</h3>
        <p className={cn('mt-2 text-sm', textSub)}>{messageFor(type, used, limit)}</p>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Tancar</Button>
          <Link href="/dashboard/plans">
            <Button size="sm">Veure plans</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
