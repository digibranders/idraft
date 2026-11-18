'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Layers, Tag, Tags, Workflow } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { BulkTagDialog } from './bulk-tag-dialog';
import { LinksDropped } from '../links-dropped';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { BulkTierDialog } from './bulk-tier-dialog';
import { useCursorPaging, pageRange } from './cursor-paging';
import { keysOfSort, pageColumns, sortOfKeys } from './page-columns';
import { capTags, MAX_TAGS, pageExportQuery, pageFilterFields, pageQueryOf } from './page-filters';
import { useSearchDraft } from './search-draft';
import { TierKeys } from './tier-keys';
import { usePageBulk, type BulkTarget } from './use-page-bulk';
import { WorklistChips } from './worklist-chips';
import { ScopeMenu } from '../scope-menu';
import { DEFAULT_SORT } from '../url-state';
import type { LinksTabContext } from '../tabs';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps, RecordAction } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { downloadApiFile } from '@/lib/api/download';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger, formatList } from '@/lib/format';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { isPageRowPage, pagesPath, pagesQuery, withRun } from '@/lib/internal-links/queries';
import type { EdgeWorklist, PageRow, PageRowPage, PageWorklist } from '@/lib/internal-links/types';
import { useCan } from '@/lib/permissions';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
/** One empty list for every render, so the table does not see new rows while nothing has loaded. */
const NO_ROWS: readonly PageRow[] = [];
const REQUIRED_COLUMNS = ['page'];
const EXPORT_NAME = 'internal-links-pages.csv';
/** Where the project's tag vocabularies are made (the bulk tag dialog's link when it has none). */
const TAXONOMY_PATH = '/settings/taxonomy';
/** The request waits this long after the last keystroke (13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;

/** The answer as a page of rows (its generated type is `unknown`, see `isPageRowPage`). */
function readPage(data: unknown): PageRowPage {
  if (isPageRowPage(data)) return data;
  throw new Error('The pages answer is not a page of rows');
}
// The two worklists of slice 2 (`lost_links_top`, `weak_outlinks`) have no chip or empty copy yet: the address
// allow-list (`url-state.ts`) does not let them in until the Pages additions (plan 05 Task 15) give them both
const EMPTY_KEY: Readonly<
  Partial<Record<PageWorklist, 'underLinkedT1' | 'orphans' | 'editorialOrphans' | 'deepOnlyThroughAuto'>>
> = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
};

/**
 * The Pages tab (spec 7.2, mock `il-pages.js`): worklist chips, the filter bar, the scope chip and the table. The
 * server filters, sorts and pages (cursors, 100 or 200 rows a page, decision W6). The tab hands the page's Export the
 * server's CSV of the same filter. Equity share is never a column, a sort or an export column (decision W4).
 */
export function PagesTab({ context }: { context: LinksTabContext }): ReactElement {
  const t = useTranslations('internalLinks');
  const common = useTranslations('common');
  const locale = useLocale();
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
    () => pageFilterFields(t, tiers, tags, vocabularies.pending || vocabularies.error),
    [t, tiers, tags, vocabularies.pending, vocabularies.error],
  );
  // A filter of a shared link that does not read is left out, and the person is told (13 section 5)
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('pages.droppedFilters.title', { count: dropped.length }),
        description: t('pages.droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });
  // The box keeps what is typed; the address and so the request follow once typing pauses (13 section 6)
  const { draft, setDraft } = useSearchDraft(state.q, (q) => setSearch({ q }), SEARCH_DELAY_MS);
  // The API takes at most 50 tags; the chips are cut to what the request asks for, and the person is told
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
  // A new query starts again at the first page
  const chosenRun = context.crawl.run;
  const filtersKey = JSON.stringify([state.scope, state.worklist, state.sort, state.q, values, chosenRun]);
  const paging = useCursorPaging(filtersKey);
  const query = pageQueryOf(state, values, paging.cursor, paging.size);
  // The rows stay while new filters load: no skeleton flash (12-tables.md section 7)
  const read = useQuery({
    ...pagesQuery(scope, query, chosenRun),
    placeholderData: keepPreviousData,
    // An answer that is not a page of rows is a failed read, shown as one
    select: readPage,
  });
  const rows = read.data?.data ?? NO_ROWS;
  const total = read.data?.meta.total ?? null;
  // A cursor belongs to one crawl. When a crawl ends, the page open is read again with its old cursor and the API
  // refuses it: start again at the first page (the retry would send the same cursor for ever). A page of another crawl
  // that is answered all the same does the same.
  const { reset: startAgain, noteRun } = paging;
  const refused = isApiProblem(read.error, 'invalid_cursor');
  useEffect(() => {
    if (refused) startAgain();
  }, [refused, startAgain]);
  const run = read.data?.meta.run_id ?? null;
  useEffect(() => {
    noteRun(run);
  }, [run, noteRun]);

  // Leaving the tab takes its rows with it: another tab's inspector must not step through a list it does not show
  const { setOrder } = context.inspect;
  useEffect(() => () => setOrder([]), [setOrder]);

  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  const columns = useMemo(
    () => pageColumns(t, { tiers, scope: state.scope, openJourney: context.openJourney }),
    [t, tiers, state.scope, context.openJourney],
  );
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);

  // The page's Export downloads the same filter as the server's CSV (decision W13)
  useEffect(() => {
    const wanted = withRun(pageExportQuery(pageQueryOf(state, values, null, paging.size)), chosenRun);
    registerExport(() => downloadApiFile(pagesPath(scope), wanted, EXPORT_NAME));
    return () => registerExport(null);
  }, [registerExport, scope, state, values, paging.size, chosenRun]);

  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: paging.size });
  const searched = state.q !== null;
  // While the rows of the last query stay on screen, the cursors in hand belong to it, not to the one loading
  const settled = !read.isPlaceholderData;
  const filtered = Object.keys(values).length > 0 || searched || state.worklist !== null;
  const clear = (): void => {
    setValues({});
    setSearch({ q: null, view: null });
  };
  const status: DataTableProps<PageRow>['status'] =
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
  const worklistEmpty = state.worklist === null ? null : (EMPTY_KEY[state.worklist] ?? null);
  // The link worklists count links of every scope, so the Links tab opens on All links (whatever scope is chosen
  // here) and lists as many rows as the chip counts
  const openEdgeWorklist = (worklist: EdgeWorklist): void =>
    setSearch({ tab: 'links', lview: worklist, scope: 'all' }, { history: 'push' });
  const openRow = (row: PageRow, intent: 'inspector' | 'new-tab'): void => {
    if (intent === 'inspector') {
      context.inspect.open(row.url_id);
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.set('inspect', `page:${row.url_id}`);
    window.open(`${window.location.pathname}?${next.toString()}`, '_blank', 'noopener');
  };

  // Bulk changes: the person may write; the selection belongs to the query, so a new query starts with none
  const bulkWords = useTranslations('internalLinks.bulk');
  const canWrite = useCan('projects:write');
  const [picked, setPicked] = useState<{ key: string; ids: ReadonlySet<string>; all: boolean }>({
    key: filtersKey,
    ids: new Set(),
    all: false,
  });
  // A choice is of one query. Another query discards it for good (changing back does not bring it back), by
  // setting the state while rendering, which React runs again at once with the empty choice
  if (picked.key !== filtersKey) setPicked({ key: filtersKey, ids: new Set(), all: false });
  const chosen = picked.key === filtersKey ? picked : { key: filtersKey, ids: new Set<string>(), all: false };
  const clearSelection = (): void => setPicked({ key: filtersKey, ids: new Set(), all: false });
  const bulk = usePageBulk(scope, query, clearSelection);
  const target: BulkTarget = { ids: [...chosen.ids], allMatching: chosen.all };
  const targetCount = chosen.all ? (total ?? 0) : chosen.ids.size;
  const [tierDialog, setTierDialog] = useState(false);
  const [tagDialog, setTagDialog] = useState<'add' | 'remove' | null>(null);
  // The journey opens from a loaded row: one chosen page that is on another page of the list has none to open from
  const [onlyId] = chosen.all || chosen.ids.size !== 1 ? [] : [...chosen.ids];
  const journeyReady = onlyId !== undefined && rows.some((row) => row.url_id === onlyId);
  const bulkActions: RecordAction<PageRow>[] = [
    {
      id: 'set-tier',
      label: bulkWords('setTier'),
      icon: Layers,
      group: 'object',
      onSelect: () => {
        bulk.clearError();
        setTierDialog(true);
      },
    },
    {
      id: 'add-tag',
      label: bulkWords('addTag'),
      icon: Tag,
      group: 'object',
      onSelect: () => {
        bulk.clearError();
        setTagDialog('add');
      },
    },
    {
      id: 'remove-tag',
      label: bulkWords('removeTag'),
      icon: Tags,
      group: 'object',
      onSelect: () => {
        bulk.clearError();
        setTagDialog('remove');
      },
    },
    {
      id: 'open-journey',
      label: bulkWords('openJourney'),
      icon: Workflow,
      group: 'open',
      disabledReason: journeyReady ? null : bulkWords('openJourneyOne'),
      onSelect: (rowsOf) => {
        const [first] = rowsOf;
        if (first !== undefined) context.openJourney(first.url_id);
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <WorklistChips
        scope={scope}
        run={chosenRun}
        current={state.worklist}
        onPick={(worklist) => setSearch({ view: worklist })}
        onPickEdges={openEdgeWorklist}
      />
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar fields={fields} values={values} onChange={setValues} />
        <ScopeMenu scope={state.scope} onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })} />
      </div>
      <DataTable<PageRow>
        caption={t('pages.caption')}
        itemNoun={{ one: t('pages.one'), other: t('pages.other') }}
        columns={columns}
        getRowId={(row) => row.url_id}
        rows={rows}
        total={total}
        server={{
          rangeText: t('pages.range', {
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
        sort={keysOfSort(state.sort)}
        // The default sort is not written to the address, as the scope and the density are not
        onSortChange={(keys) => {
          const next = sortOfKeys(keys);
          setSearch({ sort: next === null || next === DEFAULT_SORT ? null : next });
        }}
        defaultSort={keysOfSort(DEFAULT_SORT)}
        density={parseDensity(table.density)}
        onDensityChange={(density) => void setTable({ density: density === 'compact' ? null : density })}
        columnState={{
          visible: parseColumns(table.cols, known, REQUIRED_COLUMNS),
          onChange: (visible) => void setTable({ cols: visible === null ? null : formatColumns(visible) }),
        }}
        search={draft}
        onSearchChange={setDraft}
        searchPlaceholder={t('pages.search')}
        rowName={(row) => row.path}
        onRowOpen={openRow}
        onRowOrderChange={setOrder}
        activeRowId={context.inspect.urlId}
        selection={
          canWrite
            ? {
                selectedIds: chosen.ids,
                onChange: (ids) => setPicked({ key: filtersKey, ids, all: false }),
                matchingTotal: total,
                allMatching: chosen.all,
                onAllMatchingChange: (all) => setPicked({ key: filtersKey, ids: chosen.ids, all }),
              }
            : undefined
        }
        bulkActions={canWrite ? bulkActions : undefined}
        status={status}
        errorState={
          // A list that needs the links (a worklist of links) of a crawl past the last four answers 410
          isLinksDropped(read.error) ? (
            <LinksDropped />
          ) : (
            <InlineError
              title={t('pages.loadFailed')}
              reason={t('pages.loadFailedReason')}
              errorId={null}
              onRetry={() => void read.refetch()}
              retrying={read.isFetching}
              retryLabel={common('retry')}
            />
          )
        }
        emptyState={<EmptyState title={t('pages.emptyTitle')} reason={t('pages.emptyReason')} headingLevel={3} />}
        filteredEmptyState={
          worklistEmpty !== null && Object.keys(values).length === 0 && !searched ? (
            <EmptyState
              title={t(`worklistEmpty.${worklistEmpty}Title`)}
              reason={t(`worklistEmpty.${worklistEmpty}Reason`)}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={() => setSearch({ view: null })}>
                  {t('pages.showAll')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('pages.noMatchTitle')}
              reason={t('pages.noMatchReason')}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={clear}>
                  {t('pages.clearFilters')}
                </Button>
              }
            />
          )
        }
      />
      <TierKeys
        tiers={tiers}
        listed={canWrite}
        enabled={canWrite && (chosen.all || chosen.ids.size > 0) && !bulk.pending}
        onTier={(tier) => void bulk.setTier(target, tier, 'key')}
      />
      <BulkTierDialog
        open={tierDialog}
        onOpenChange={setTierDialog}
        count={targetCount}
        tiers={tiers}
        pending={bulk.pending}
        alert={bulk.error}
        onSetTier={(tier) => bulk.setTier(target, tier, 'dialog')}
        onReset={() => bulk.resetToRule(target, 'dialog')}
      />
      <BulkTagDialog
        mode={tagDialog}
        onClose={() => setTagDialog(null)}
        count={targetCount}
        tags={tags}
        vocabularies={vocabularies}
        taxonomyHref={context.hrefOf(TAXONOMY_PATH)}
        pending={bulk.pending}
        alert={bulk.error}
        onApply={(tag, add) => bulk.changeTag(target, tag, add, 'dialog')}
      />
    </div>
  );
}
