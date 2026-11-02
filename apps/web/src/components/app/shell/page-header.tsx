import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The padding and rhythm of a page that scrolls with the window: the gutters grow at 768 and 1024 px (19 section 3). */
export const PAGE_CLASS = 'flex flex-col gap-3 px-3 pt-3 pb-8 md:px-4 lg:px-5';

export interface PageHeaderProps {
  /** The page's only `h1`. It never truncates and wraps to two lines at most. */
  title: string;
  /** The meta line under the title: freshness first, then one scope fact. */
  meta?: ReactNode | undefined;
  /** At most two secondary actions, then the one primary action, right-aligned. */
  actions?: ReactNode | undefined;
  /** Local tabs (`Tabs` or `TabNav`), under the title row. */
  tabs?: ReactNode | undefined;
  /**
   * A summary and the filters, on the title row between the title and the actions. The meta line then sits
   * beside the title instead of under it, so a table page spends one row above its table.
   */
  toolbar?: ReactNode | undefined;
  /** The id the skip link and route focus use; the heading takes focus when a route changes. */
  headingId?: string | undefined;
}

/**
 * The title block of a page (23-application-patterns.md section 3, 25 section 5.11): the title in
 * `type-page-title` with the meta line 4 px below it, the actions right-aligned on the title block, and
 * the local tabs below. Below 768 px the actions go on their own row under the title. It has no bottom
 * border: page blocks are 16 px apart. The saved view menu, the More menu and the filter bar join it with
 * the screens that have them.
 */
export function PageHeader({ title, meta, actions, tabs, toolbar, headingId }: PageHeaderProps): ReactElement {
  const compact = toolbar !== undefined;
  return (
    <div data-slot="page-header" className="@container flex flex-col gap-3">
      <div className={cn('flex flex-wrap gap-x-4 gap-y-3', compact ? 'items-center' : 'items-start')}>
        <div
          className={cn(
            'flex min-w-0 basis-full md:basis-auto',
            compact ? 'order-1 items-baseline gap-3 md:flex-1 @6xl:flex-none' : 'flex-col gap-1 md:flex-1',
          )}
        >
          <h1 id={headingId} tabIndex={-1} className="type-page-title outline-none">
            {title}
          </h1>
          {meta === undefined ? null : <p className="type-meta">{meta}</p>}
        </div>
        {toolbar === undefined ? null : (
          // Narrow: its own row under the title and actions. Wide (the header's own width, so a docked inspector counts): between them
          <div className="order-3 min-w-0 basis-full @6xl:order-2 @6xl:flex-1 @6xl:basis-80">{toolbar}</div>
        )}
        {actions === undefined ? null : (
          <div className={cn('flex items-center gap-3 md:ml-auto', compact && 'order-2 @6xl:order-3')}>{actions}</div>
        )}
      </div>
      {tabs}
    </div>
  );
}
