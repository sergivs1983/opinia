import type { ReactNode } from 'react';

import { cx, tokens } from '@/lib/design/tokens';

type SectionProps = {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export default function Section({
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
}: SectionProps) {
  return (
    <section className={cx('space-y-3', className)}>
      {title || subtitle || action ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            {title ? <h2 className={cx('text-base font-semibold md:text-lg', tokens.text.primary)}>{title}</h2> : null}
            {subtitle ? <p className={cx('text-sm', tokens.text.secondary)}>{subtitle}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cx('space-y-3', contentClassName)}>{children}</div>
    </section>
  );
}
