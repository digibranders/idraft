'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { DEFAULT_MIN_SUPPORT, DEFAULT_SORT } from './citation-scope';
import {
  CitationEmptyState,
  CitationFilteredEmptyState,
  CitationTableNotes,
  resolveTableStatus,
} from './citation-table-states';
import type { CitationTabContext } from './citation-tabs';
import type { ExportSource } from './citations-export';
import { useRegisterExport } from './export-button';
import { MinSupportSelect } from './min-support-select';
import { NoOwnPage } from './no-own-page';
import { pageRowId, usePageColumns } from './page-columns';
import { SortSelect } from './sort-select';
import { DataTable } from '@/components/app/data-table/data-table';
import { Banner } from '@/components/app/status/banner';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { useErrorId } from '@/lib/api/use-error-id';
import { entitiesQuery } from '@/lib/citations/entities-query';
import { sourceDomainsQuery, sourcePagesQuery } from '@/lib/citations/source-queries';
import type { SourcePageRow } from '@/lib/citations/types';
import { DEFAULT_DENSITY, formatColumns, parseColumns, type Density, type SortKey } from '@/lib/tables/table-state';

/** The page stands on the 200 most cited pages of one read (plan D7); the table has no server pager. */
const PAGE_LIMIT = 200;
/** The domains a page's Cited with is joined from (plan Q6): the 200 most cited, as the Domains tab lists. */
const CITED_WITH_LIMIT = 200;
const NO_PAGES: readonly SourcePageRow[] = [];
const NO_SORT: readonly SortKey[] = [];
const nothing = (): void => undefined;
const rowName = (row: SourcePageRow): string => row.url;

/** Whether a row is the project's own: its tint, besides the Own badge that says so in words. */
const ownRow = (row: SourcePageRow): 'own' | undefined => (row.domain_role === 'own' ? 'own' : undefined);

export interface PagesTabProps {
  context: CitationTabContext;
}

/**
 * The Pages tab (DS 9.7, WB-CIT-10 and 11): the cited pages of the scope, narrowed to one domain by the `domain`
 * key. The server sorts (one select) and leaves out the rows below the minimum; shares are always of the whole
 * scope. "Cited with" is the domain's, read from the domains route, since the pages route has no such block. A row
 * click does nothing: the page inspector is WP-22's.
 */
export function PagesTab({ context }: PagesTabProps): ReactElement {
  const {
    source,
    workspaceSlug,
    projectSlug,
    timeZone,
    scope,
    filters,
    enabledEngines,
    labelOf,
    previousMeta,
    setSearch,
  } = context;
  const { filterBar } = context;
  const tt = useTranslations('citations.table');
  const t = useTranslations('citations');
  const common = useTranslations('common');
  const locale = useLocale();
  // The tab asks nothing while another one is shown, or before the engines are known: with none listed the scope
  // drops the link's `engine`, and the read would be of every engine
  const active = scope.tab === 'pages' && enabledEngines.length > 0;

  const read = useQuery({
    ...sourcePagesQuery(source, filters, {
      limit: PAGE_LIMIT,
      offset: 0,
      sort: scope.sort,
      minSupport: scope.minSupport,
      compare: scope.compare,
      ...(scope.domain === null ? {} : { registrableDomain: scope.domain }),
    }),
    placeholderData: keepPreviousData,
    enabled: active,
  });
  const errorId = useErrorId(read.error);
  const meta = read.data?.meta;
  const pages = read.data?.data ?? NO_PAGES;
  const total = read.data?.page.total ?? 0;

  // Cited with is the domain's: the domains read says it, joined to each page by its domain and role entity
  const cited = useQuery({
    ...sourceDomainsQuery(source, filters, { limit: CITED_WITH_LIMIT, include: ['cited_with'] }),
    placeholderData: keepPreviousData,
    enabled: active,
  });

  // The search finds a listed page by its address or its title; the API has no search, so it never looks past the listed rows
  const [query, setQuery] = useState('');
  const listed = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return needle === ''
      ? pages
      : pages.filter((row) => `${row.url}\n${row.title ?? ''}`.toLocaleLowerCase(locale).includes(needle));
  }, [pages, query, locale]);

  const engines = useMemo(
    () => (scope.engines.length > 0 ? scope.engines : enabledEngines).map((code) => ({ code, label: labelOf(code) })),
    [scope.engines, enabledEngines, labelOf],
  );
  const entities = useQuery({ ...entitiesQuery(source), placeholderData: keepPreviousData }).data?.data;
  const columns = usePageColumns({
    engines,
    meta,
    previousMeta: previousMeta.data?.meta,
    entities,
    citedWith: { rows: cited.data?.data, failed: cited.isError },
    timeZone,
    t: tt,
    locale,
  });
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visible = useMemo(() => parseColumns(scope.columns, columnIds, ['page']), [scope.columns, columnIds]);

  const filtering = Object.keys(filterBar.values).length > 0 || query !== '';
  // A minimum other than the default can be what left no row: Clear filters puts it back
  const clearFilters = useCallback((): void => {
    filterBar.onClear();
    setQuery('');
    if (scope.minSupport !== DEFAULT_MIN_SUPPORT) setSearch({ min: null });
  }, [filterBar, scope.minSupport, setSearch]);

  const status = resolveTableStatus({
    read: {
      isError: read.isError,
      isPending: read.isPending,
      isFetching: read.isFetching,
      hasData: read.data !== undefined,
    },
    listed: listed.length,
    filtering,
    meta,
  });

  // The page's Export button gets the rows listed, never the last scope's rows that stand in while a new one is read
  const exportSource = useMemo(
    (): ExportSource | null =>
      meta === undefined || read.isPlaceholderData ? null : { rows: { tab: 'pages', rows: listed }, total, meta },
    [meta, read.isPlaceholderData, listed, total],
  );
  useRegisterExport(context.registerExport, exportSource);

  // The tab scrolls as a whole when the card above the table and the notes leave it under 20rem, so the table is never squeezed away
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <NoOwnPage context={context} />
      <CitationTableNotes
        meta={meta}
        compare={scope.compare}
        // A refresh that failed leaves the rows of the last read on screen: say so, with a way to ask again
        refreshFailed={read.isError && read.data !== undefined}
        refetching={read.isFetching}
        onRetry={() => void read.refetch()}
        truncated={
          read.data !== undefined && total > pages.length ? tt('truncatedPages', { shown: pages.length, total }) : null
        }
      >
        {cited.isError ? (
          <Banner
            tone="warning"
            placement="region"
            live
            message={tt('citedWithFailed')}
            actions={
              <Button variant="secondary" size="sm" loading={cited.isFetching} onClick={() => void cited.refetch()}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
      </CitationTableNotes>
      <div className="flex min-h-80 flex-1 flex-col">
        <DataTable<SourcePageRow>
          caption={tt('pagesCaption')}
          itemNoun={{ one: tt('pageNoun.one'), other: tt('pageNoun.other') }}
          columns={columns}
          getRowId={pageRowId}
          rows={listed}
          total={listed.length}
          // The server sorts (the select)
          sort={NO_SORT}
          onSortChange={nothing}
          defaultSort={NO_SORT}
          compactToolbar
          columnGroups
          toolbarEnd={
            <>
              <SortSelect
                sort={scope.sort}
                onSortChange={(next) => setSearch({ sort: next === DEFAULT_SORT ? null : next })}
              />
              <MinSupportSelect
                minSupport={scope.minSupport}
                onMinSupportChange={(next) => setSearch({ min: next === null ? null : String(next) })}
              />
            </>
          }
          density={scope.density}
          onDensityChange={(next: Density) => setSearch({ density: next === DEFAULT_DENSITY ? null : next })}
          columnState={{
            visible,
            onChange: (next) => setSearch({ cols: next === null ? null : formatColumns(next) }),
          }}
          search={query}
          onSearchChange={setQuery}
          searchPlaceholder={tt('searchPages')}
          rowName={rowName}
          rowTone={ownRow}
          status={status}
          errorState={
            <InlineError
              title={t('empty.failedTitle')}
              reason={t('empty.failedReason')}
              errorId={errorId}
              onRetry={() => void read.refetch()}
              retrying={read.isFetching}
              retryLabel={common('retry')}
              live
            />
          }
          emptyState={<CitationEmptyState meta={meta} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />}
          filteredEmptyState={
            <CitationFilteredEmptyState
              filterBar={filterBar}
              minSupport={scope.minSupport}
              filtering={filtering}
              onClear={clearFilters}
            />
          }
        />
      </div>
    </div>
  );
}
