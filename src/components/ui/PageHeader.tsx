import type { ReactNode } from 'react';

import { cx, tokens } from '@/lib/design/tokens';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({ title, subtitle, badge, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        {badge ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-[#ecebe7] bg-white px-3 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
            {badge}
          </div>
        ) : null}
        <h1 className={cx('text-[32px] font-semibold leading-[1.2] tracking-[-0.02em]', tokens.text.primary)} style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
          {title}
        </h1>
        {subtitle ? <p className={cx('text-sm leading-relaxed md:text-base', tokens.text.secondary)}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
