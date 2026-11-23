'use client';

import { Workflow } from 'lucide-react';
import type { ReactNode } from 'react';

import { extraColumns } from './page-extras-cells';
import { PAGE_SORTS } from '../url-state';
import type { LinksTranslate } from '../tabs';
import { ShareBarCell, type ShareColor } from '@/components/app/chart/stacked-share-bar';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { TierBadge } from '@/components/app/tier/tier-badge';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { formatInteger } from '@/lib/format';
import type { Comparison } from '@/lib/internal-links/page-extras';
import { pageFlags } from '@/lib/internal-links/page-flags';
import type { LinkScope } from '@/lib/internal-links/scopes';
import { tierPosition } from '@/lib/internal-links/tiers';
import type { PageRow, PageSort, PageTier } from '@/lib/internal-links/types';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';

/** Column id to the API's sort field (decision W5); the Tier column does not sort (gap G1), and equity is never a sort. */
export const SORT_FIELD: Readonly<Record<string, string>> = {
  page: 'path',
  status: 'status_code',
  depth: 'click_depth',
  linking: 'linking_pages',
  outlinks: 'outlinks',
  change: 'change',
  rank: 'rank',
  citations: 'citations',
  anchors: 'anchor',
};

/** The sort the table's first key asks for, or `null` for a column the server cannot sort. */
export function sortOfKeys(keys: readonly { id: string; desc: boolean }[]): PageSort | null {
  const [first] = keys;
  const field = first === undefined ? undefined : SORT_FIELD[first.id];
  if (first === undefined || field === undefined) return null;
  const wanted = `${first.desc ? '-' : ''}${field}`;
  return PAGE_SORTS.find((sort) => sort === wanted) ?? null;
}

/** The table's sort keys for a sort of the address. */
export function keysOfSort(sort: PageSort): { id: string; desc: boolean }[] {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  const id = Object.entries(SORT_FIELD).find(([, value]) => value === field)?.[0];
  return id === undefined ? [] : [{ id, desc }];
}

type Column = DataTableColumn<PageRow>;

const TIER_COLORS: readonly ShareColor[] = [
  'tier-1',
  'tier-2',
  'tier-3',
  'tier-4',
  'tier-5',
  'tier-6',
  'tier-7',
  'tier-8',
];

/** The flags shown in full; the rest are one "+N" whose names are the cell's tooltip. */
const FLAGS_SHOWN = 2;

/** A column whose cell this screen draws (a tier badge, a bar, flags), with the type's width rules. */
const custom = (
  id: string,
  type: Column['type'],
  header: string,
  cell: (row: PageRow) => ReactNode,
  extra: Partial<Column> = {},
): Column => ({ id, type, header, cell, priority: 1, defaultVisible: true, ...extra });

/**
 * The Pages columns of spec 7.2 and the mock (`il-pages.js` `COLUMNS`), without equity (decision W4): Page (path,
 * title below, Open in journey), Tier, Status, Depth, Linking pages, Linked from tiers, Outlinks and Flags by
 * default; the chooser holds tags, indexability reason, in sitemap, outlinks to T1, broken outlinks, links to
 * redirects, links to non-indexable pages and the top anchor.
 */
export function pageColumns(
  t: LinksTranslate,
  {
    tiers,
    scope,
    openJourney,
    comparison,
    linksAvailable,
    olderCrawlDate = null,
  }: {
    tiers: readonly PageTier[];
    scope: LinkScope;
    openJourney: (urlId: string) => void;
    /** Where the comparison with the previous crawl stands, for the Change column. */
    comparison: Comparison;
    /** False for a crawl whose links were dropped: its anchors are not stored. */
    linksAvailable: boolean;
    /** The date of the crawl in view when it is not the latest: the Today columns say it differs from them. */
    olderCrawlDate?: string | null;
  },
): Column[] {
  const extras = extraColumns(t, { comparison, linksAvailable, olderCrawlDate }, custom);
  const segments = [
    ...tiers.map((tier) => ({
      id: tier.tier_id,
      name: tier.label,
      color: TIER_COLORS[tier.position - 1] ?? 'tier-none',
    })),
    { id: 'none', name: t('filters.untiered'), color: 'tier-none' as const },
  ];
  const flagNames = (row: PageRow): string[] => pageFlags(row, scope).map((flag) => t(`flags.${flag.key}`));
  const flagsTip = (row: PageRow): CellTip | undefined => {
    const names = flagNames(row);
    return names.length > FLAGS_SHOWN ? { content: names.join(', ') } : undefined;
  };
  const all: Column[] = [
    col.keyword<PageRow>('page', (row) => row.path, {
      header: t('columns.page'),
      detail: (row) => row.title ?? undefined,
      trailing: (row) => (
        <IconButton
          {...CELL_CONTROL}
          icon={Workflow}
          size="icon-xs"
          label={t('pages.openJourney', { path: row.path })}
          onClick={(event) => {
            event.stopPropagation();
            openJourney(row.url_id);
          }}
        />
      ),
    }),
    custom('tier', 'badge', t('columns.tier'), (row) => <TierBadge tier={row.tier} />, { width: 96 }),
    custom(
      'status',
      'status',
      t('columns.status'),
      (row) =>
        row.status_code === 200 ? (
          <span className="num type-table text-foreground-secondary">200</span>
        ) : (
          <Badge tone={(row.status_code ?? 0) >= 400 ? 'negative' : 'warning'}>{String(row.status_code ?? '')}</Badge>
        ),
      { width: 96, sortValue: (row) => row.status_code },
    ),
    custom(
      'depth',
      'count',
      t('columns.depth'),
      (row) =>
        row.click_depth === null ? (
          <span className="type-table text-foreground-tertiary">{t('columns.notReachable')}</span>
        ) : (
          <span className="num type-table">{formatInteger(row.click_depth)}</span>
        ),
      { headerTooltip: t('columns.depthTip'), width: 120, sortValue: (row) => row.click_depth },
    ),
    col.count<PageRow>('linking', (row) => row.linking_pages, {
      header: t('columns.linking'),
      headerTooltip: t('columns.linkingTip'),
      width: 120,
    }),
    custom(
      'fromTiers',
      'text',
      t('columns.fromTiers'),
      (row) => {
        const total = row.linked_from_tiers.reduce((sum, entry) => sum + entry.pages, 0);
        if (total === 0) return <span className="type-table text-foreground-tertiary">{t('columns.none')}</span>;
        const sorted = [...row.linked_from_tiers].sort((a, b) => tierPosition(a.tier) - tierPosition(b.tier));
        const list = sorted
          .map((entry) =>
            t('columns.fromTiersItem', { tier: entry.tier?.code ?? t('filters.untiered'), count: entry.pages }),
          )
          .join(', ');
        const cells = sorted.map((entry) => ({
          segmentId: entry.tier?.tier_id ?? 'none',
          share: entry.pages / total,
          shareText: formatInteger(entry.pages),
          countText: formatInteger(entry.pages),
        }));
        return (
          <ShareBarCell
            label={t('columns.fromTiersName', { list })}
            segments={segments}
            cells={cells}
            denominatorText={t('columns.fromTiersOf', { count: total })}
          />
        );
      },
      { headerTooltip: t('columns.fromTiersTip'), width: 128 },
    ),
    col.count<PageRow>('outlinks', (row) => row.outlinks, {
      header: t('columns.outlinks'),
      headerTooltip: t('columns.outlinksTip'),
      width: 96,
    }),
    extras.change,
    custom(
      'flags',
      'text',
      t('columns.flags'),
      (row) => {
        const flags = pageFlags(row, scope);
        if (flags.length === 0) return <span className="type-table text-foreground-tertiary">{t('columns.none')}</span>;
        return (
          <span className="flex flex-wrap items-center gap-1 py-1">
            {flags.slice(0, FLAGS_SHOWN).map((flag) => (
              <Badge key={flag.key} tone={flag.tone}>
                {t(`flags.${flag.key}`)}
              </Badge>
            ))}
            {flags.length > FLAGS_SHOWN ? (
              <span className="num type-label text-foreground-tertiary">
                {t('columns.more', { count: flags.length - FLAGS_SHOWN })}
              </span>
            ) : null}
          </span>
        );
      },
      { width: 240, cellTip: flagsTip },
    ),
    col.text<PageRow>('tags', (row) => (row.tags.length === 0 ? null : row.tags.map((tag) => tag.name).join(', ')), {
      header: t('columns.tags'),
      defaultVisible: false,
      unknown: () => ({ label: t('columns.none') }),
    }),
    col.text<PageRow>(
      'reason',
      (row) => row.non_indexable_reason ?? (row.is_indexable ? t('columns.indexableValue') : null),
      {
        header: t('columns.reason'),
        defaultVisible: false,
      },
    ),
    col.text<PageRow>('sitemap', (row) => (row.in_sitemap ? t('columns.yes') : t('columns.no')), {
      header: t('columns.sitemap'),
      defaultVisible: false,
    }),
    col.count<PageRow>('toT1', (row) => row.outlinks_to_t1, { header: t('columns.toT1'), defaultVisible: false }),
    col.count<PageRow>('broken', (row) => row.broken_outlinks, { header: t('columns.broken'), defaultVisible: false }),
    col.count<PageRow>('redirects', (row) => row.redirect_outlinks, {
      header: t('columns.redirects'),
      defaultVisible: false,
    }),
    col.count<PageRow>('nonIndexable', (row) => row.non_indexable_outlinks, {
      header: t('columns.nonIndexable'),
      defaultVisible: false,
    }),
    col.text<PageRow>(
      'topAnchor',
      (row) => (row.top_anchor === null ? null : t('columns.anchor', { anchor: row.top_anchor })),
      {
        header: t('columns.topAnchor'),
        defaultVisible: false,
      },
    ),
    ...extras.optional,
  ];
  // Only the columns of SORT_FIELD sort: the server sorts, so a column without a server field must not offer it
  return all.map((column) => (SORT_FIELD[column.id] === undefined ? { ...column, sortValue: undefined } : column));
}
