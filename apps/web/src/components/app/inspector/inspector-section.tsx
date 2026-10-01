'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';

export type InspectorSectionStatus = 'loading' | 'ready' | 'error' | 'empty';

export interface InspectorSectionProps {
  /** h3 in the card header. */
  title: string;
  /** 16 px, naming the kind of content: `ChartLine` for a trend, `History` for events. */
  icon: LucideIcon;
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
  action,
  status,
  error,
  empty,
  skeleton,
  children,
}: InspectorSectionProps): ReactElement {
  return (
    <section aria-busy={status === 'loading' ? true : undefined} className="rounded-lg border border-border bg-surface">
      <div className="flex h-12 items-center gap-2 px-4">
        <Icon icon={icon} size="default" className="shrink-0 text-foreground-tertiary" />
        <h3 className="min-w-0 flex-1 truncate type-subsection-title">{title}</h3>
        {action === undefined || action === null ? null : <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-4 pb-4">
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
