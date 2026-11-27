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
  /**
   * The title's size, still an `h3`. `default` is `type-subsection-title` (14/20); `section` is `type-section-title`
   * (16/24), which the Citations drawers use for every card (aiov-parts.js `cardFrame`).
   */
  titleSize?: 'default' | 'section' | undefined;
  /**
   * The ready and empty bodies have no padding, for a table or a list whose rows draw their own 16 px edges and an
   * empty state that pads itself. A skeleton and an error keep the 16 px edges.
   */
  flush?: boolean | undefined;
  /** At most one control, right-aligned: "View all", a `Select`, a badge or Edit. */
  action?: ReactNode;
  /**
   * The action sits on a second row under the title until the card is 24 rem wide, then beside it at the right (a
   * container query on the card). A card in the narrowest drawer (480 px) is wider than that, so only a narrow sheet
   * stacks it. Default `false`: the action stays on the title row.
   */
  stackAction?: boolean | undefined;
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
  titleSize = 'default',
  flush,
  action,
  stackAction = false,
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
      className={cn(
        'rounded-lg border border-border bg-surface',
        flush === true && 'overflow-hidden',
        stackAction && '@container',
      )}
    >
      {/* With a meta the header wraps as the preview's does (min 48 px, 12 px above and below, no cut text); without one it stays a 48 px line */}
      <div
        className={cn(
          'flex items-center gap-2 px-4',
          stackAction ? 'min-h-12 flex-wrap gap-y-2 py-3' : meta === undefined ? 'h-12' : 'min-h-12 py-3',
        )}
      >
        {icon === undefined ? null : <Icon icon={icon} size="default" className="shrink-0 text-foreground-tertiary" />}
        <div
          className={cn(
            'min-w-0 flex-1',
            meta === undefined ? 'flex items-baseline gap-2' : 'flex flex-wrap items-baseline gap-x-2 gap-y-0',
          )}
        >
          <h3
            className={cn(
              'min-w-0',
              meta === undefined ? 'truncate' : 'wrap-anywhere',
              titleSize === 'section' ? 'type-section-title' : 'type-subsection-title',
            )}
          >
            {title}
          </h3>
          {meta === undefined ? null : <span className="min-w-0 num type-meta wrap-anywhere">{meta}</span>}
        </div>
        {action === undefined || action === null ? null : (
          <div className={cn('shrink-0', stackAction && 'basis-full @sm:basis-auto')}>{action}</div>
        )}
      </div>
      {/* A flush card pads only a skeleton and an error: a table, a list and an empty state draw their own edges */}
      <div className={flush === true && (status === 'ready' || status === 'empty') ? undefined : 'px-4 pb-4'}>
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
