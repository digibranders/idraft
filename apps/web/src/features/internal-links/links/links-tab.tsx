'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useMemo, type ReactElement, type ReactNode } from 'react';

import { edgeColumns } from './edge-columns';
import { edgeExportQuery, edgeFilterFields, edgeQueryOf } from './edge-filters';
import { ADDED_READ_LIMIT, pairOf, useAddedMarks, useLinkComparison, type LinkComparison } from './link-comparison';
import { changesScopeOf, LostLinksTable } from './lost-links-table';
import { StatusMenu } from './status-menu';
import { SkeletonRows } from '../crawl-states';
import { pageRange, useCursorPaging } from '../pages/cursor-paging';
import { capTags, MAX_TAGS } from '../pages/page-filters';
import { useSearchDraft } from '../pages/search-draft';
import { ScopeMenu } from '../scope-menu';
import { LinksDropped } from '../links-dropped';
import type { LinksTabContext } from '../tabs';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps } from '@/components/app/data-table/types';
import { Banner } from '@/components/app/status/banner';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';
import { downloadApiFile } from '@/lib/api/download';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import {
  CHANGE_LIMIT,
  changeLinksExportQuery,
  changeLinksPath,
  edgesPath,
  edgesQuery,
  isEdgeRowPage,
  withRun,
} from '@/lib/internal-links/queries';
import type { EdgeRow, EdgeRowPage } from '@/lib/internal-links/types';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
/** One empty list for every render, so the table does not see new rows while nothing has loaded. */
const NO_EDGES: readonly EdgeRow[] = [];
const REQUIRED_COLUMNS = ['source'];
const EXPORT_NAME = 'internal-links-links.csv';
const LOST_EXPORT_NAME = 'internal-links-lost-links.csv';
/** The request waits this long after the last keystroke (13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;

/** The answer as a page of links (its generated type is `unknown`, see `isEdgeRowPage`). */
function readEdges(data: unknown): EdgeRowPage {
  if (isEdgeRowPage(data)) return data;
  throw new Error('The edges answer is not a page of links');
}

/**
 * The Links tab (spec 7.3, mock `il-links.js`): every link edge with the Pages filters plus source and target. A
 * page named in the address that is no url id is shown as not found, never read as no choice (that would list every
 * link). Equity share is never a column, a filter or an export column (decision W4).
 */
export function LinksTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks.links');
  const { invalid } = context.state;
  if (invalid.src !== null || invalid.tgt !== null) {
    return (
      <EmptyState
        title={t('notFoundTitle')}
        reason={t('notFoundReason')}
        headingLevel={3}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => context.setSearch({ src: null, tgt: null })}>
            {t('showAll')}
          </Button>
        }
      />
    );
  }
  // A crawl past the last four answers 410 to every links read: nothing is asked
  if (!context.crawl.linksAvailable) return <LinksDropped />;
  return <LinksByStatus context={context} />;
}

/**
 * The Status menu of the Links tab (Active, Lost since last crawl, All) exists only for a crawl with an earlier crawl
 * to compare with; for any other the address's `ls` reads as Active, and the Added column is not drawn.
 */
function LinksByStatus({ context }: { context: LinksTabContext }): ReactElement {
  const comparison = useLinkComparison(context);
  const { setSearch } = context;
  const compares = comparison.state === 'compares';
  const status = compares ? context.state.linkStatus : 'active';
  // A lost or all address waits for the answer that says whether it can be shown
  if (comparison.state === 'loading' && context.state.linkStatus !== 'active') return <SkeletonRows />;
  const statusMenu = compares ? (
    <StatusMenu status={status} onChange={(next) => setSearch({ ls: next === 'active' ? null : next })} />
  ) : null;
  if (status === 'lost') {
    return <LostView context={context} comparison={comparison} statusMenu={statusMenu} />;
  }
  return <LinksList context={context} comparison={comparison} statusMenu={statusMenu} showLost={status === 'all'} />;
}

/** The lost links of the crawl, or the neutral note when the earlier crawl kept no links to compare with. */
function LostSection({ context, comparison }: { context: LinksTabContext; comparison: LinkComparison }): ReactElement {
  const t = useTranslations('internalLinks.links');
  if (comparison.previousStored === false) {
    return <Banner tone="neutral" placement="region" message={t('previousDropped')} />;
  }
  return <LostLinksTable context={context} previousDate={comparison.previousDate} />;
}

function LostView({
  context,
  comparison,
  statusMenu,
}: {
  context: LinksTabContext;
  comparison: LinkComparison;
  statusMenu: ReactNode;
}): ReactElement {
  const { scope, state, crawl, setSearch, registerExport } = context;
  const readable = comparison.previousStored !== false;
  // The page's Export downloads the lost links as the table shows them, every row (decision W13)
  useEffect(() => {
    if (!readable) return undefined;
    const query = changeLinksExportQuery(
      { change: 'lost', linkScope: changesScopeOf(state.scope), only: 'all', offset: 0, limit: CHANGE_LIMIT },
      crawl.run,
    );
    registerExport(() => downloadApiFile(changeLinksPath(scope), query, LOST_EXPORT_NAME));
    return () => registerExport(null);
  }, [readable, registerExport, scope, state.scope, crawl.run]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {statusMenu}
        <ScopeMenu
          scope={state.scope}
          onChange={(next) => setSearch({ scope: next === 'editorial' && state.edgeWorklist === null ? null : next })}
        />
      </div>
      <LostSection context={context} comparison={comparison} />
    </div>
  );
}

function LinksList({
  context,
  comparison,
  statusMenu,
  showLost,
}: {
  context: LinksTabContext;
  comparison: LinkComparison;
  statusMenu: ReactNode;
  showLost: boolean;
}): ReactElement {
  const t = useTranslations('internalLinks');
  const common = useTranslations('common');
  const { scope, state, setSearch, tiers, registerExport } = context;
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  const fields = useMemo(
    () => edgeFilterFields(t, tiers, tags, vocabularies.pending || vocabularies.error),
    [t, tiers, tags, vocabularies.pending, vocabularies.error],
  );
  const [values, setValues] = useUrlFilters(fields);
  // The API takes at most 50 tags; the chips are cut to what the request and the export ask for, and the person is told
  useEffect(() => {
    const capped = capTags(values);
    if (capped === null) return;
    setValues(capped);
    toast({
      type: 'info',
      title: t('pages.tagCap.title', { max: MAX_TAGS }),
      description: t('pages.tagCap.description', { max: MAX_TAGS }),
    });
  }, [values, setValues, t]);
  const { draft, setDraft } = useSearchDraft(state.lq, (lq) => setSearch({ lq }), SEARCH_DELAY_MS);
  // A new query starts again at the first page
  const chosenRun = context.crawl.run;
  const filtersKey = JSON.stringify([
    state.scope,
    state.edgeWorklist,
    state.lq,
    state.source,
    state.target,
    values,
    chosenRun,
  ]);
  const paging = useCursorPaging(filtersKey);
  const query = edgeQueryOf(state, values, paging.cursor, paging.size);
  const read = useQuery({
    ...edgesQuery(scope, query, chosenRun),
    placeholderData: keepPreviousData,
    // An answer that is not a page of links is a failed read, shown as one
    select: readEdges,
  });
  const rows = read.data?.data ?? NO_EDGES;
  const total = read.data?.meta.total ?? null;

  // A cursor belongs to one crawl: a refused one, or a page of another crawl, starts again at the first page
  const { reset: startAgain, noteRun } = paging;
  const refused = isApiProblem(read.error, 'invalid_cursor');
  useEffect(() => {
    if (refused) startAgain();
  }, [refused, startAgain]);
  const run = read.data?.meta.run_id ?? null;
  useEffect(() => {
    noteRun(run);
  }, [run, noteRun]);

  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  // The edge rows carry no added flag: the added links read (the first 200) marks them. With no earlier links to
  // compare with, no row could be marked, so the column is not drawn
  const showAdded = comparison.state === 'compares' && comparison.previousStored !== false;
  const marks = useAddedMarks(context, showAdded);
  const addedNote = marks.failed
    ? t('links.addedFailed')
    : marks.capped
      ? t('links.addedCapped', { read: formatInteger(ADDED_READ_LIMIT), total: formatInteger(marks.total) })
      : null;
  const columns = useMemo(
    () =>
      edgeColumns(
        t,
        showAdded
          ? {
              isAdded: (row) => marks.pairs.has(pairOf(row.source.url_id, row.target.url_id)),
              note: addedNote,
            }
          : undefined,
      ),
    [t, showAdded, marks.pairs, addedNote],
  );
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

  // The page's Export downloads the same filter as the server's CSV (decision W13)
  useEffect(() => {
    const wanted = withRun(edgeExportQuery(edgeQueryOf(state, values, null, paging.size)), chosenRun);
    registerExport(() => downloadApiFile(edgesPath(scope), wanted, EXPORT_NAME));
    return () => registerExport(null);
  }, [registerExport, scope, state, values, paging.size, chosenRun]);

  const notes = [
    ...(state.edgeWorklist === null
      ? []
      : [
          {
            key: 'lview' as const,
            label: t(
              state.edgeWorklist === 'broken_and_redirected'
                ? 'worklists.brokenAndRedirected'
                : 'worklists.linksToNonIndexable',
            ),
          },
        ]),
    ...(state.source === null ? [] : [{ key: 'src' as const, label: t('links.fromPage') }]),
    ...(state.target === null ? [] : [{ key: 'tgt' as const, label: t('links.toPage') }]),
  ];
  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: paging.size });
  // While the rows of the last query stay on screen, the cursors in hand belong to it, not to the one loading
  const settled = !read.isPlaceholderData;
  const filtered = Object.keys(values).length > 0 || notes.length > 0 || state.lq !== null;
  const status: DataTableProps<EdgeRow>['status'] =
    read.isError && read.data === undefined
      ? 'error'
      : read.isPending
        ? 'loading'
        : read.isFetching
          ? 'refetching'
          : rows.length === 0
            ? filtered
              ? 'filtered-empty'
              : 'empty'
            : 'ready';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar fields={fields} values={values} onChange={setValues} />
        {statusMenu}
        <ScopeMenu
          scope={state.scope}
          // With a worklist on, no scope key reads All links, so Editorial must be written out
          onChange={(next) => setSearch({ scope: next === 'editorial' && state.edgeWorklist === null ? null : next })}
        />
        {notes.map((note) => (
          <Tag
            key={note.key}
            label={note.label}
            removeLabel={t('links.remove', { label: note.label })}
            onRemove={() => setSearch({ [note.key]: null })}
          />
        ))}
      </div>
      {showLost ? <h2 className="type-subsection-title">{t('links.activeHeading')}</h2> : null}
      <DataTable<EdgeRow>
        caption={t('links.caption')}
        itemNoun={{ one: t('links.one'), other: t('links.other') }}
        columns={columns}
        getRowId={(row) => row.link_id}
        rows={rows}
        total={total}
        server={{
          rangeText: t('links.range', {
            from: formatInteger(range.from),
            to: formatInteger(range.to),
            total: formatInteger(total ?? 0),
          }),
          offset: range.offset,
          hasPrevious: settled && paging.pageIndex > 0,
          hasNext: settled && (read.data?.page.has_more ?? false),
          onPrevious: paging.previous,
          onNext: () => {
            const next = read.data?.page.next_cursor;
            if (settled && next !== null && next !== undefined) paging.next(next);
          },
          pageSize: paging.size,
          onPageSizeChange: paging.setSize,
          pageSizes: [100, 200],
        }}
        sort={[]}
        onSortChange={() => undefined}
        defaultSort={[]}
        density={parseDensity(table.density)}
        onDensityChange={(density) => void setTable({ density: density === 'compact' ? null : density })}
        columnState={{
          visible: parseColumns(table.cols, known, REQUIRED_COLUMNS),
          onChange: (visible) => void setTable({ cols: visible === null ? null : formatColumns(visible) }),
        }}
        search={draft}
        onSearchChange={setDraft}
        searchPlaceholder={t('links.search')}
        rowName={(row) => `${row.source.path} ${row.target.path}`}
        onRowOpen={(row) => context.inspect.open(row.target.url_id)}
        status={status}
        errorState={
          isLinksDropped(read.error) ? (
            <LinksDropped />
          ) : (
            <InlineError
              title={t('links.loadFailed')}
              reason={t('links.loadFailedReason')}
              errorId={null}
              onRetry={() => void read.refetch()}
              retrying={read.isFetching}
              retryLabel={common('retry')}
            />
          )
        }
        emptyState={<EmptyState title={t('links.emptyTitle')} reason={t('links.emptyReason')} headingLevel={3} />}
        filteredEmptyState={
          <EmptyState
            title={t('links.noMatchTitle')}
            reason={t('links.noMatchReason')}
            headingLevel={3}
            primaryAction={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setValues({});
                  setSearch({ lq: null, lview: null, src: null, tgt: null });
                }}
              >
                {t('links.clearFilters')}
              </Button>
            }
          />
        }
      />
      {showLost ? <LostSection context={context} comparison={comparison} /> : null}
    </div>
  );
}
