'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { glassStrong, textMain, textSub } from '@/components/ui/glass';

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  children: ReactNode;
}

export default function Table({ className, children, ...props }: TableProps) {
  return (
    <div className={cn('w-full overflow-x-auto rounded-xl', glassStrong)}>
      <table className={cn('w-full min-w-[720px] border-collapse', textSub, className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('border-b border-white/10', textMain, className)} {...props}>
      {children}
    </thead>
  );
}

export function TableRow({ className, children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-white/10 transition-colors duration-[220ms] ease-premium hover:bg-white/5', className)} {...props}>
      {children}
    </tr>
  );
}

export function TableCell({ className, children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 text-sm', className)} {...props}>
      {children}
    </td>
  );
}

