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
  const hasStats = stats !== undefined && stats !== null;
  const hasRow2 =
    (tabs !== undefined && tabs !== null) ||
    (filters !== undefined && filters !== null) ||
    actions !== undefined ||
    (!hasStats && status !== undefined && status !== null);

  return (
    <div data-slot="page-toolbar" className={cn('@container flex min-w-0 flex-col gap-2', className)}>
      <h1 id={headingId} tabIndex={-1} lang={lang} className="sr-only outline-none">
        {title}
      </h1>
      {before}
      {hasStats ? (
        <div className="flex w-full max-w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
          <div
            className="scrollbar-none flex h-control-sm max-w-full min-w-0 items-center overflow-x-auto"
            style={{ contain: 'paint' }}
          >
            {stats}
          </div>
          {status !== undefined && status !== null ? (
            <div className="ml-auto flex min-h-control-sm shrink-0 items-center gap-3">{status}</div>
          ) : null}
        </div>
      ) : null}
      {hasRow2 ? (
        <div className="flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          {tabs !== undefined && tabs !== null ? (
            <div className="flex h-control-sm shrink-0 items-center">{tabs}</div>
          ) : null}
          {filters !== undefined && filters !== null ? <div className="min-w-0 shrink-0">{filters}</div> : null}
          {actions !== undefined || (!hasStats && status !== undefined && status !== null) ? (
            <div className="ml-auto flex min-h-control-sm max-w-full flex-wrap items-center gap-3">
              {!hasStats ? status : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
