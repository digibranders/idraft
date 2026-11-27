import type { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import type { DataTableColumn } from '@/components/app/data-table/types';
import type { PageRow } from '@/lib/internal-links/types';
import { issueCountsOf } from '@/lib/pages/issue-source';

type Column = DataTableColumn<PageRow>;
export type PagesColumnWords = ReturnType<typeof useTranslations<'pages.columns'>>;

/** The column builder of `page-columns.tsx`, so both columns get the same width and priority rules. */
export type CustomColumn = (
  id: string,
  type: Column['type'],
  header: string,
  cell: (row: PageRow) => ReactNode,
  extra?: Partial<Column>,
) => Column;

const MUTED = 'type-table text-foreground-tertiary';

/**
 * The Issues column (spec 10.1): the counts of one row, read only through the Issues seam. A row the seam has no
 * numbers for, or whose numbers are all 0, says `none`.
 */
export function issuesColumn(t: PagesColumnWords, none: string, custom: CustomColumn): Column {
  return custom(
    'issues',
    'text',
    t('issues'),
    (row) => {
      const counts = issueCountsOf(row);
      if (counts === null || counts.error + counts.warning + counts.notice === 0) {
        return <span className={MUTED}>{none}</span>;
      }
      return <span className="num type-table">{t('issuesCount', counts)}</span>;
    },
    { headerTooltip: t('issuesTip'), width: 240 },
  );
}

/** The Tracked column (spec 10.2): whether the Monitoring seam lists the page. Not sortable on this branch. */
export function trackedColumn(t: PagesColumnWords, tracked: ReadonlySet<string>, custom: CustomColumn): Column {
  return custom(
    'tracked',
    'text',
    t('tracked'),
    (row) =>
      tracked.has(row.url_id) ? (
        <span className="type-table">{t('trackedYes')}</span>
      ) : (
        <span className={MUTED}>{t('trackedNo')}</span>
      ),
    { width: 120 },
  );
}
