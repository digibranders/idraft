'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import type { Route } from 'next';
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
import { LoadFailed } from './citations-states';
import { rowNameOf, useDomainColumns } from './domain-columns';
import { buildRows, domainRowId, type CitationTableRow } from './domain-rows';
import { useRegisterExport } from './export-button';
import { MinSupportSelect } from './min-support-select';
import { SortSelect } from './sort-select';
import { useExpandedPages } from './use-expanded-pages';
import { DataTable } from '@/components/app/data-table/data-table';
import type { RowTree } from '@/components/app/data-table/types';
import { useErrorId } from '@/lib/api/use-error-id';
import { entitiesQuery } from '@/lib/citations/entities-query';
import { sourceDomainsQuery, type DomainInclude } from '@/lib/citations/source-queries';
import type { SourceDomainRow } from '@/lib/citations/types';
import { formatText } from '@/lib/filters/filter-values';
import { projectPath, withQuery } from '@/lib/routes/paths';
import { DEFAULT_DENSITY, formatColumns, parseColumns, type Density, type SortKey } from '@/lib/tables/table-state';

/** The page stands on the 200 most cited domains of one read (plan D7); the table has no server pager. */
const DOMAIN_LIMIT = 200;
const DOMAIN_INCLUDE: readonly DomainInclude[] = ['series', 'cited_with', 'by_role_by_engine'];
const NO_DOMAINS: readonly SourceDomainRow[] = [];
const NO_SORT: readonly SortKey[] = [];
const nothing = (): void => undefined;
const rowId = (row: CitationTableRow): string => row.id;

export interface DomainsTabProps {
  context: CitationTabContext;
}

/** Whether a row is the project's own: its tint, besides the Own badge that says so in words. */
const ownRow = (row: CitationTableRow): 'own' | undefined => {
  if (row.kind === 'domain') return row.domain.domain_role === 'own' ? 'own' : undefined;
  return row.kind === 'page' && row.page.domain_role === 'own' ? 'own' : undefined;
};

/**
 * The Domains tab (DS 9.7, WB-CIT-06 to 09): the cited domains of the scope as a tree. A domain opens onto its top
 * 10 pages, read only while it is open, and "View all N pages" goes to the Pages tab filtered to it. The server
 * sorts (one select) and leaves out the rows below the minimum; shares are always of the whole scope. A row click
 * opens or closes the row: the domain inspector is WP-22's, so no row opens one.
 */
export function DomainsTab({ context }: DomainsTabProps): ReactElement {
  const { source, workspaceSlug, projectSlug, scope, filters, enabledEngines, labelOf, previousMeta, setSearch } =
    context;
  const { filterBar } = context;
  const tt = useTranslations('citations.table');
  const locale = useLocale();
  // The tab asks nothing while another one is shown, or before the engines are known: with none listed the scope
  // drops the link's `engine`, and the read would be of every engine
  const active = scope.tab === 'domains' && enabledEngines.length > 0;

  const read = useQuery({
    ...sourceDomainsQuery(source, filters, {
      limit: DOMAIN_LIMIT,
      offset: 0,
      sort: scope.sort,
      minSupport: scope.minSupport,
      include: DOMAIN_INCLUDE,
      compare: scope.compare,
    }),
    placeholderData: keepPreviousData,
    enabled: active,
  });
  const errorId = useErrorId(read.error);
  const meta = read.data?.meta;
  const domains = read.data?.data ?? NO_DOMAINS;
  const total = read.data?.page.total ?? 0;

  // The search finds a listed domain by its name; the API has no search, so it never looks past the listed rows
  const [query, setQuery] = useState('');
  const listed = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    return needle === ''
      ? domains
      : domains.filter((row) => row.registrable_domain.toLocaleLowerCase(locale).includes(needle));
  }, [domains, query, locale]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const open = useMemo(() => listed.filter((row) => expanded.has(domainRowId(row))), [listed, expanded]);
  const pages = useExpandedPages({
    source,
    filters,
    minSupport: scope.minSupport,
    compare: scope.compare,
    open,
    enabled: active,
  });
  const { rows, tree } = useMemo(() => buildRows(listed, expanded, pages.reads), [listed, expanded, pages.reads]);

  // The columns are rebuilt only when what they draw changes, so each of these keeps its identity
  const engines = useMemo(
    () => (scope.engines.length > 0 ? scope.engines : enabledEngines).map((code) => ({ code, label: labelOf(code) })),
    [scope.engines, enabledEngines, labelOf],
  );
  const entities = useQuery({ ...entitiesQuery(source), placeholderData: keepPreviousData }).data?.data;
  const address = useSearchParams().toString();
  const moreHref = useCallback(
    (registrable: string): Route => {
      const next = new URLSearchParams(address);
      next.set('tab', 'pages');
      next.set('domain', formatText({ operator: 'equals', text: registrable }));
      // The Domains columns are not the Pages columns
      next.delete('cols');
      return withQuery(projectPath(workspaceSlug, projectSlug, '/ai/citations'), next.toString());
    },
    [address, workspaceSlug, projectSlug],
  );
  const columns = useDomainColumns({
    engines,
    meta,
    previousMeta: previousMeta.data?.meta,
    entities,
    density: scope.density,
    t: tt,
    locale,
    moreHref,
    onRetryPages: pages.retry,
  });
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visible = useMemo(() => parseColumns(scope.columns, columnIds, ['domain']), [scope.columns, columnIds]);

  const rowName = useCallback((row: CitationTableRow): string => rowNameOf(row, tt), [tt]);
  const rowTree = useCallback(
    (row: CitationTableRow): RowTree | undefined => {
      const facts = tree.get(row.id);
      if (facts === undefined || row.kind !== 'domain') return facts;
      return {
        ...facts,
        label: tt(facts.expanded === true ? 'collapse' : 'expand', { domain: row.domain.registrable_domain }),
      };
    },
    [tree, tt],
  );
  const toggle = useCallback((row: CitationTableRow): void => {
    if (row.kind !== 'domain') return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, []);

  const filtering = Object.keys(filterBar.values).length > 0 || query !== '';
  // A minimum other than the default can be what left no row: Clear filters puts it back
  const clearFilters = (): void => {
    filterBar.onClear();
    setQuery('');
    if (scope.minSupport !== DEFAULT_MIN_SUPPORT) setSearch({ min: null });
  };

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
  // A refresh that failed leaves the rows of the last read on screen: say so, with a way to ask again
  const refreshFailed = read.isError && read.data !== undefined;

  // The page's Export button gets the rows listed, never the last scope's rows that stand in while a new one is read
  const exportSource = useMemo(
    (): ExportSource | null =>
      meta === undefined || read.isPlaceholderData ? null : { rows: { tab: 'domains', rows: listed }, total, meta },
    [meta, read.isPlaceholderData, listed, total],
  );
  useRegisterExport(context.registerExport, exportSource);

  const errorState = <LoadFailed errorId={errorId} onRetry={() => void read.refetch()} retrying={read.isFetching} />;

  return (
    <>
      <CitationTableNotes
        meta={meta}
        compare={scope.compare}
        refreshFailed={refreshFailed}
        refetching={read.isFetching}
        onRetry={() => void read.refetch()}
        truncated={
          read.data !== undefined && total > domains.length ? tt('truncated', { shown: domains.length, total }) : null
        }
      />
      <DataTable<CitationTableRow>
        caption={tt('domainsCaption')}
        itemNoun={{ one: tt('noun.one'), other: tt('noun.other') }}
        columns={columns}
        getRowId={rowId}
        rows={rows}
        total={listed.length}
        // The server sorts (the select), and a tree lists its rows as given
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
        searchPlaceholder={tt('search')}
        rowName={rowName}
        rowTree={rowTree}
        onToggleGroup={toggle}
        rowTone={ownRow}
        status={status}
        errorState={errorState}
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
    </>
  );
}
