'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type InspectorSectionStatus = 'loading' | 'ready' | 'error' | 'empty';

export interface InspectorSectionProps {
  /** h3 in the card header. */
  title: string;
  /** 16 px, naming the kind of content: `ChartLine` for a trend, `History` for events. Left out in the Citations drawers (WP-77). */
  icon?: LucideIcon | undefined;
  /** A short fact after the title, in meta type: "31 prompts · cited in 76 answers" (aiov-parts.js `cardFrame`). */
  meta?: string | undefined;
  /** The ready body has no padding, for a table or a list whose rows draw their own 16 px edges. */
  flush?: boolean | undefined;
  /** At most one control, right-aligned: "View all", a `Select`, a badge or Edit. */
  action?: ReactNode;
  status: InspectorSectionStatus;
  /** An `InlineError` with Retry, shown for `error`. */
  error?: ReactNode;
  /** An inline `EmptyState`, shown for `empty`. */
  empty?: ReactNode;
  /** A skeleton shaped like the content; three text lines by default. */
  skeleton?: ReactNode;
  children?: ReactNode;
}

/**
 * One card of the inspector's body (16-drawers-dialogs-popovers.md section 2.4): `surface`, 1 px border,
 * 8 px radius, a 48 px header with an icon, the title and one control. Each card loads and fails on its
 * own, so one error never blanks the others. Cards are never nested and never collapse.
 */
export function InspectorSection({
  title,
  icon,
  meta,
  flush,
  action,
  status,
  error,
  empty,
  skeleton,
  children,
}: InspectorSectionProps): ReactElement {
  return (
    <section
      aria-busy={status === 'loading' ? true : undefined}
      // A flush table's header band runs to the card's edge, so the 8 px corners clip it
      className={cn('rounded-lg border border-border bg-surface', flush === true && 'overflow-hidden')}
    >
      <div className="flex h-12 items-center gap-2 px-4">
        {icon === undefined ? null : <Icon icon={icon} size="default" className="shrink-0 text-foreground-tertiary" />}
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h3 className="min-w-0 truncate type-subsection-title">{title}</h3>
          {meta === undefined ? null : <span className="min-w-0 truncate num type-meta">{meta}</span>}
        </div>
        {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
      </div>
      {/* Only the ready body is flush: a skeleton, an error and an empty state keep the 16 px edges */}
      <div className={flush === true && status === 'ready' ? undefined : 'px-4 pb-4'}>
        {status === 'loading'
          ? (skeleton ?? (
              <div className="flex flex-col gap-2">
                <Skeleton shape="text-13" widthPct={80} />
                <Skeleton shape="text-13" widthPct={72} />
                <Skeleton shape="text-13" widthPct={56} />
              </div>
            ))
          : status === 'error'
            ? error
            : status === 'empty'
              ? empty
              : children}
      </div>
    </section>
  );
}
