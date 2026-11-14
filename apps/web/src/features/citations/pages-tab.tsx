'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';

import { DEFAULT_MIN_SUPPORT, DEFAULT_SORT } from './citation-scope';
import { CitationEmptyState, CitationFilteredEmptyState, resolveTableStatus } from './citation-table-states';
import { LoadFailed } from './citations-states';
import type { CitationTabContext } from './citation-tabs';
import type { ExportSource } from './citations-export';
import { useRegisterExport } from './export-button';
import { MinSupportSelect } from './min-support-select';
import { PageList, useCitationListLayout } from './mobile-rows';
import { NoOwnPage } from './no-own-page';
import { pageRowId, usePageColumns } from './page-columns';
import { SortSelect } from './sort-select';
import { DataTable } from '@/components/app/data-table/data-table';
import { ListTableSwitch } from '@/components/app/data-table/data-table-list';
import { Banner } from '@/components/app/status/banner';
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
 * opens the page's source inspector (a click, Enter), and so does its path, a link a middle click opens in a new
 * tab. The tab reports its pages in the order it lists them, which Previous, Next, J and K step through. Without an
 * inspector offered the path stays the outbound link and a row does nothing.
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
  const { filterBar, inspect } = context;
  const tt = useTranslations('citations.table');
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
  // The pages route returns no engine totals (its `include` takes `series` alone): the scope read has them
  const scopeEngines = context.meta.data?.meta.by_role_by_engine;
  const columnMeta = useMemo(
    () => (meta === undefined || scopeEngines === undefined ? meta : { ...meta, by_role_by_engine: scopeEngines }),
    [meta, scopeEngines],
  );
  const hrefOf = inspect?.hrefOf;
  const sourceHref = useMemo(
    () => (hrefOf === undefined ? undefined : (urlId: number): Route => hrefOf({ type: 'source', id: String(urlId) })),
    [hrefOf],
  );
  const columns = usePageColumns({
    engines,
    meta: columnMeta,
    previousMeta: previousMeta.data?.meta,
    entities,
    citedWith: { rows: cited.data?.data, failed: cited.isError },
    timeZone,
    sourceHref,
    t: tt,
    locale,
  });
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visible = useMemo(() => parseColumns(scope.columns, columnIds, ['page']), [scope.columns, columnIds]);

  // The pages in the order the table lists them, which Previous, Next, J and K step through (a page the API reads in
  // two roles is one step)
  const setOrder = inspect?.setOrder;
  useEffect(() => {
    if (setOrder === undefined || !active) return;
    setOrder('source', [...new Set(listed.map((row) => String(row.url_id)))]);
  }, [setOrder, active, listed]);
  const openInInspector = inspect?.open;
  const openRow = useCallback(
    (row: SourcePageRow, intent: 'inspector' | 'new-tab'): void =>
      openInInspector?.({ type: 'source', id: String(row.url_id) }, intent),
    [openInInspector],
  );
  // The open page's first row: a page read in two roles is two rows, and one is current
  const openSource = inspect?.target?.type === 'source' ? inspect.target.id : null;
  const activeRowId = useMemo(() => {
    const open = openSource === null ? undefined : listed.find((row) => String(row.url_id) === openSource);
    return open === undefined ? null : pageRowId(open);
  }, [listed, openSource]);

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

  const errorState = <LoadFailed errorId={errorId} onRetry={() => void read.refetch()} retrying={read.isFetching} />;
  const emptyState = <CitationEmptyState meta={meta} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />;
  const filteredEmptyState = (
    <CitationFilteredEmptyState
      filterBar={filterBar}
      minSupport={scope.minSupport}
      filtering={filtering}
      onClear={clearFilters}
    />
  );
  // Below 768 px the rows are a list; the server's order and minimum stay where they are, and the person may ask for
  // the table when the screen is not touch-primary
  const layout = useCitationListLayout();
  const toolbarEnd = (
    <>
      <SortSelect sort={scope.sort} onSortChange={(next) => setSearch({ sort: next === DEFAULT_SORT ? null : next })} />
      <MinSupportSelect
        minSupport={scope.minSupport}
        onMinSupportChange={(next) => setSearch({ min: next === null ? null : String(next) })}
      />
      {layout.canSwitch ? <ListTableSwitch mode={layout.mode} onModeChange={layout.onModeChange} /> : null}
    </>
  );

  const footerNote =
    read.data !== undefined && total > pages.length
      ? tt('truncatedPagesFooter', { shown: pages.length, total })
      : undefined;
  const refreshFailed = read.isError && read.data !== undefined;
  const citedWithFailed = cited.isError;

  // The tab scrolls as a whole when the card above the table and the notes leave it under 20rem, so the table is never squeezed away
  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
      <NoOwnPage context={context} />
      {refreshFailed ? (
        <Banner
          tone="warning"
          placement="region"
          live
          message={tt('refreshFailed')}
          actions={
            <Button variant="secondary" size="sm" loading={read.isFetching} onClick={() => void read.refetch()}>
              {common('retry')}
            </Button>
          }
        />
      ) : null}
      {citedWithFailed ? (
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
      <div className="flex h-96 min-h-80 flex-col lg:h-auto lg:flex-1">
        {layout.mode === 'list' ? (
          <PageList
            pages={listed}
            comparison={{ meta, previousMeta: previousMeta.data?.meta }}
            status={status}
            search={query}
            onSearchChange={setQuery}
            activeRowId={activeRowId}
            toolbarEnd={toolbarEnd}
            footerNote={footerNote}
            errorState={errorState}
            emptyState={emptyState}
            filteredEmptyState={filteredEmptyState}
            onOpenPage={(urlId) => openInInspector?.({ type: 'source', id: String(urlId) }, 'inspector')}
          />
        ) : (
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
            toolbarEnd={toolbarEnd}
            footerNote={footerNote}
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
            onRowOpen={openInInspector === undefined ? undefined : openRow}
            activeRowId={activeRowId}
            status={status}
            errorState={errorState}
            emptyState={emptyState}
            filteredEmptyState={filteredEmptyState}
          />
        )}
      </div>
    </div>
  );
}
