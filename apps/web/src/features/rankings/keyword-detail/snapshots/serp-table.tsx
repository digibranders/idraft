'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { SerpRow } from './serp-rows';
import { PathText } from '../../rank-cells';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn, TableStatus } from '@/components/app/data-table/types';
import { EntitySwatch } from '@/components/app/entity/entity-swatch';
import { EmptyState } from '@/components/app/status/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { Truncate } from '@/components/ui/truncate';
import { formatInteger, webHref } from '@/lib/format';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { DEFAULT_DENSITY, type Density } from '@/lib/tables/table-state';

export interface SerpTableProps {
  rows: readonly SerpRow[];
  status: TableStatus;
  /** Shown in the body when the results did not load. */
  errorState: ReactNode;
}

/** The results are in the order of the page, never the person's sort: no column sorts. */
const NO_SORT: readonly never[] = [];
const rowKey = (row: SerpRow): string => row.key;
const isOwn = (row: SerpRow): 'own' | undefined => (row.kind === 'own' ? 'own' : undefined);
/** What a result is called: its title, or its address where no title is kept. */
const nameOf = (row: SerpRow): string => row.title ?? `${row.host}${row.path}`;
const searchTextOf = (row: SerpRow): string =>
  [nameOf(row), row.host, row.path, row.entity?.canonical_name ?? ''].join(' ');

/** The result's address: its end stays in view, and it opens in a new tab (never for a scheme that is not the web's). */
function UrlCell({ row }: { row: SerpRow }): ReactElement {
  const t = useTranslations('keywordDetail.snapshots');
  const display = `${row.host}${row.path}`;
  const href = webHref(row.address);
  return (
    <span className="block min-w-0 font-mono text-foreground">
      {href === null ? (
        <PathText path={display} />
      ) : (
        <TextLink
          {...CELL_CONTROL}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={t('openResult', { address: display })}
          // The row around the cell opens nothing here; a click on the link is the link's own
          onClick={(event) => event.stopPropagation()}
          onAuxClick={(event) => event.stopPropagation()}
          className="block"
        >
          <PathText path={display} />
        </TextLink>
      )}
    </span>
  );
}

/** Who the result belongs to: the viewer's own site, a tracked competitor or watched entity, or no one tracked. */
function EntityCell({ row }: { row: SerpRow }): ReactElement {
  const t = useTranslations('keywordDetail.snapshots.entity');
  if (row.entity === null || row.kind === 'other') return <span className="sr-only">{t('notTracked')}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <EntitySwatch colorIndex={row.entity.color_index} own={row.kind === 'own'} />
      {row.kind === 'own' ? (
        <span className="text-foreground">{t('you')}</span>
      ) : (
        <Truncate text={row.entity.canonical_name} className="text-foreground" />
      )}
      {row.kind === 'watch' ? <Badge>{t('watch')}</Badge> : null}
    </span>
  );
}

/**
 * The results of one SERP (24-page-templates.md section 9.4): rank, result, address, entity and snippet, in
 * the SERP's order, with the own row on the accent tone and named "You" in words. The table is the house
 * `DataTable` in client mode, so it scrolls sideways at a narrow width with the result column pinned.
 */
export function SerpTable({ rows, status, errorState }: SerpTableProps): ReactElement {
  const t = useTranslations('keywordDetail.snapshots');
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);
  const [visible, setVisible] = useState<readonly string[] | null>(null);

  const columns = useMemo(
    (): DataTableColumn<SerpRow>[] => [
      col.rank<SerpRow>('rank', (row) => row.rank, {
        header: t('columns.rank'),
        sortable: false,
        cell: (row) => <span className="num text-foreground">{formatInteger(row.rank)}</span>,
        cellTip: (row) =>
          row.absolute !== null && row.absolute !== row.rank
            ? { content: t('absoluteRank', { absolute: formatInteger(row.absolute) }) }
            : undefined,
      }),
      col.keyword<SerpRow>('result', nameOf, { header: t('columns.result'), sortable: false }),
      col.url<SerpRow>('url', () => null, {
        header: t('columns.url'),
        sortable: false,
        hasControls: true,
        cell: (row) => <UrlCell row={row} />,
      }),
      col.competitor<SerpRow>('entity', {
        header: t('columns.entity'),
        cell: (row) => <EntityCell row={row} />,
      }),
      col.text<SerpRow>('snippet', (row) => row.snippet, { header: t('columns.snippet'), sortable: false, width: 240 }),
    ],
    [t],
  );

  return (
    <DataTable<SerpRow>
      caption={t('table.caption')}
      itemNoun={{ one: t('table.noun.one'), other: t('table.noun.other') }}
      columns={columns}
      getRowId={rowKey}
      rows={rows}
      total={rows.length}
      sort={NO_SORT}
      onSortChange={() => undefined}
      defaultSort={NO_SORT}
      density={density}
      onDensityChange={setDensity}
      columnState={{ visible, onChange: setVisible }}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder={t('table.search')}
      searchText={searchTextOf}
      rowName={nameOf}
      rowTone={isOwn}
      status={status}
      errorState={errorState}
      emptyState={
        <EmptyState variant="inline" title={t('table.empty.title')} reason={t('table.empty.reason')} headingLevel={3} />
      }
      filteredEmptyState={
        <EmptyState
          title={t('table.noMatch.title')}
          reason={t('table.noMatch.reason')}
          headingLevel={3}
          primaryAction={
            <Button variant="secondary" onClick={() => setSearch('')}>
              {t('table.noMatch.clear')}
            </Button>
          }
        />
      }
    />
  );
}
