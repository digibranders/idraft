'use client';

import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface PageToolbarProps {
  /** The page title, rendered as a visually hidden h1 for accessibility and screen readers. */
  title: string;
  /** Language of the title if different from interface. */
  lang?: string | undefined;
  /** Heading element ID for skip links and focus management. */
  headingId?: string | undefined;
  /** Content placed right after h1 and before the toolbar row, for example setup slots. */
  before?: ReactNode | undefined;
  /** Inline stat chips (label + value + delta + tooltip), or MetricStrip size="inline". */
  stats?: ReactNode | undefined;
  /** Page navigation tabs rendered as a segmented control or tab nav inline in the toolbar. */
  tabs?: ReactNode | undefined;
  /** Filters, scope controls, and search in the primary flowing row. */
  filters?: ReactNode | undefined;
  /** Small inline status chips (for example Schedules paused, Updated 2h ago). */
  status?: ReactNode | undefined;
  /** Trailing actions: Export, more menu (...), and primary action button. */
  actions?: ReactNode | undefined;
  /** Optional secondary content, such as an inline setup message. */
  children?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Unified sleek page toolbar component (04-spacing-density.md, 24-page-templates.md).
 * Collapses page chrome into a single dense 36 to 40 px toolbar row directly under the top bar.
 */
export function PageToolbar({
  title,
  lang,
  headingId,
  before,
  stats,
  tabs,
  filters,
  status,
  actions,
  children,
  className,
}: PageToolbarProps): ReactElement {
  return (
    <div data-slot="page-toolbar" className={cn('@container flex min-w-0 flex-col gap-2', className)}>
      <h1 id={headingId} tabIndex={-1} lang={lang} className="sr-only outline-none">
        {title}
      </h1>
      {before}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap">
          {stats !== undefined && stats !== null ? (
            <div className="scrollbar-none flex h-control-sm max-w-full min-w-0 shrink items-center overflow-x-auto">
              {stats}
            </div>
          ) : null}
          {tabs !== undefined && tabs !== null ? (
            <div className="flex h-control-sm shrink-0 items-center">{tabs}</div>
          ) : null}
          {filters !== undefined && filters !== null ? <div className="min-w-0 shrink-0">{filters}</div> : null}
        </div>
        {status !== undefined || actions !== undefined ? (
          <div className="ml-auto flex h-control-sm shrink-0 items-center gap-3">
            {status}
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
