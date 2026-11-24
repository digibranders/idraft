'use client';

import type { LinksTranslate } from '../tabs';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { StatusBadge } from '../status-badge';
import { PLACEMENT_KEY } from '@/lib/internal-links/scopes';
import type { EdgeRow } from '@/lib/internal-links/types';

type Column = DataTableColumn<EdgeRow>;

/** The Added column: which rows the crawl added, and what the header says about the list that tells it. */
export interface AddedColumn {
  isAdded: (row: EdgeRow) => boolean;
  /** Said in the header when the list was cut short or could not be read; `null` when it is the whole answer. */
  note: string | null;
}

const badgeColumn = (id: string, header: string, cell: Column['cell']): Column => ({
  id,
  type: 'badge',
  header,
  cell,
  priority: 1,
  defaultVisible: true,
  width: 96,
});

/**
 * The Links columns of spec 7.3 and the mock (`il-links.js` `COLUMNS`). The server orders the rows (menu and footer
 * links first), so no column sorts. There is no equity column and no First seen or Lost on (slice 2).
 */
export function edgeColumns(t: LinksTranslate, added?: AddedColumn): Column[] {
  return [
    col.keyword<EdgeRow>('source', (row) => row.source.path, { header: t('links.columns.source'), sortable: false }),
    badgeColumn('sourceTier', t('links.columns.sourceTier'), (row) => <TierBadge tier={row.source.tier} />),
    col.text<EdgeRow>('target', (row) => row.target.path, {
      header: t('links.columns.target'),
      width: 240,
      sortable: false,
    }),
    badgeColumn('targetTier', t('links.columns.targetTier'), (row) => <TierBadge tier={row.target.tier} />),
    col.text<EdgeRow>(
      'anchor',
      (row) => (row.kind === 'image' ? t('links.columns.image', { alt: row.anchor }) : row.anchor),
      { header: t('links.columns.anchor'), width: 240, sortable: false },
    ),
    col.text<EdgeRow>('placement', (row) => t(`placement.${PLACEMENT_KEY[row.placement]}`), {
      header: t('links.columns.placement'),
      sortable: false,
    }),
    col.text<EdgeRow>('rel', (row) => (row.rel.length === 0 ? t('links.columns.follow') : row.rel.join(' ')), {
      header: t('links.columns.rel'),
      width: 104,
      sortable: false,
    }),
    {
      id: 'status',
      type: 'status',
      header: t('links.columns.status'),
      priority: 1,
      defaultVisible: true,
      width: 180,
      cell: (row) => {
        const status = row.target.status_code;
        if (status === null) {
          return <span className="type-table text-foreground-tertiary">{t('links.columns.notCrawled')}</span>;
        }
        if (status === 200) return <span className="num type-table text-foreground-secondary">200</span>;
        return (
          <StatusBadge
            status={status}
            label={
              row.target.redirect_url === null
                ? String(status)
                : t('links.columns.redirectsTo', { status, url: row.target.redirect_url })
            }
          />
        );
      },
    },
    col.text<EdgeRow>(
      'indexable',
      (row) =>
        row.target.is_indexable === null
          ? null
          : row.target.is_indexable
            ? t('links.columns.yes')
            : t('links.columns.no'),
      { header: t('links.columns.indexable'), width: 120, sortable: false },
    ),
    col.count<EdgeRow>('occurrences', (row) => row.occurrences, {
      header: t('links.columns.occurrences'),
      sortable: false,
    }),
    ...(added === undefined
      ? []
      : [
          col.text<EdgeRow>(
            'added',
            // Only a link the added list holds is marked; any other may still be new, so it says nothing
            (row) => (added.isAdded(row) ? t('links.columns.addedMark') : null),
            {
              header: t('links.columns.added'),
              width: 120,
              sortable: false,
              ...(added.note === null ? {} : { headerTooltip: added.note }),
            },
          ),
        ]),
  ];
}
