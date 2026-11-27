'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, Layers, Tag as TagIcon, Tags, Workflow } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { BulkTagDialog } from './bulk-tag-dialog';
import { LinksDropped } from '../links-dropped';
import { isLinksDropped } from '@/lib/internal-links/contract-states';
import { BulkTierDialog } from './bulk-tier-dialog';
import { useCursorPaging, pageRange } from './cursor-paging';
import { keysOfSort, pageColumns, sortOfKeys } from './page-columns';
import { capTags, MAX_TAGS, pageExportQuery, pageFilterFields, pageQueryOf, UNTIERED_VALUE } from './page-filters';
import { useSearchDraft } from './search-draft';
import { TierKeys } from './tier-keys';
import { TierSuggestions } from './tier-suggestions';
import { usePageBulk, type BulkTarget } from './use-page-bulk';
import { activeViewId, useViewLabel, ViewMenu } from './view-menu';
import { ScopeMenu } from '../scope-menu';
import type { PagesContext } from './pages-context';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableProps, RecordAction } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { downloadApiFile } from '@/lib/api/download';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { isApiProblem } from '@/lib/api/problem';
import { formatInteger, formatList } from '@/lib/format';
import { formatIsoDate } from '@/lib/format/date';
import { useVocabularies } from '@/lib/keywords/taxonomy-reads';
import { comparisonOf } from '@/lib/internal-links/page-extras';
import {
  changesSummaryQuery,
  isPageRowPage,
  moreIncludes,
  overviewQuery,
  pagesPath,
  pagesQuery,
  withRun,
} from '@/lib/internal-links/queries';
import type { PageRow, PageRowPage, PageView, PageWorklist } from '@/lib/internal-links/types';
import { ISSUE_COLUMNS_AVAILABLE } from '@/lib/pages/issue-source';
import { TRACKING_AVAILABLE, useTrackedPages, useTrackPages } from '@/lib/pages/tracking';
import { useCan } from '@/lib/permissions';
import { formatColumns, parseColumns, parseDensity } from '@/lib/tables/table-state';

const TABLE_KEYS = { density: parseAsString, cols: parseAsString };
/** One empty list for every render, so the table does not see new rows while nothing has loaded. */
const NO_ROWS: readonly PageRow[] = [];
const REQUIRED_COLUMNS = ['page'];
const SCOPED_COLUMNS = ['linking', 'fromTiers', 'outlinks'];
const EXPORT_NAME = 'internal-links-pages.csv';
/** The request waits this long after the last keystroke (13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;

/** The answer as a page of rows (its generated type is `unknown`, see `isPageRowPage`). */
function readPage(data: unknown): PageRowPage {
  if (isPageRowPage(data)) return data;
  throw new Error('The pages answer is not a page of rows');
}
const EMPTY_KEY = {
  under_linked_t1: 'underLinkedT1',
  orphans: 'orphans',
  editorial_orphans: 'editorialOrphans',
  deep_only_through_auto: 'deepOnlyThroughAuto',
  lost_links_top: 'lostLinksTop',
  weak_outlinks: 'weakOutlinks',
} as const satisfies Record<PageWorklist, string>;

/** The names the empty sentences of the server views keep under `pages.viewEmpty.*` (the mock's EMPTY_WORKLIST). */
const VIEW_EMPTY_KEY = {
  live: 'live',
  indexable: 'indexable',
  not_indexable: 'notIndexable',
  redirects: 'redirects',
  errors: 'errors',
  client_errors: 'clientErrors',
  server_errors: 'serverErrors',
  blocked: 'blocked',
  other: 'other',
  variants: 'variants',
  in_sitemap_indexable: 'inSitemapIndexable',
  not_in_sitemap: 'notInSitemap',
  sitemap_not_live: 'sitemapNotLive',
  sitemap_not_indexable: 'sitemapNotIndexable',
  reachable: 'reachable',
  unreachable: 'unreachable',
} as const satisfies Record<PageView, string>;

/**
 * The Pages tab (spec 7.2, mock `il-pages.js`): the table, whose toolbar holds the View menu, the filter bar and the scope chip. The
 * server filters, sorts and pages (cursors, 100 or 200 rows a page, decision W6). The tab hands the page's Export the
 * server's CSV of the same filter. Equity share is never a column, a sort or an export column (decision W4).
 */
export function PagesTab({ context }: { context: PagesContext }): ReactElement {
  const t = useTranslations('internalLinks');
  const common = useTranslations('common');
  const groups = useTranslations('pages.groups');
  const locale = useLocale();
  const { scope, setSearch, tiers, registerExport } = context;
  // The host may build its state afresh on every render; the effects below follow its values, not its identity
  const { scope: linkScope, view, worklist, sort, q, depth, variants } = context.state;
  const state = useMemo(
    () => ({ scope: linkScope, view, worklist, sort, q, depth, variants }),
    [linkScope, view, worklist, sort, q, depth, variants],
  );
  const vocabularies = useVocabularies(scope);
  const tags = useMemo(
    () =>
      vocabularies.loaded
        .filter((entry) => entry.vocabulary.kind === 'tag')
        .flatMap((entry) => entry.terms.map((term) => ({ termId: term.termId, name: term.path }))),
    [vocabularies.loaded],
  );
  // The sections of the Overview read (shared through the query cache) are the Folder filter's options
  const pagesWords = useTranslations('pages');
  const overview = useQuery(overviewQuery(scope, context.crawl.run));
  const sections = useMemo(() => overview.data?.data.sections.map((entry) => entry.section) ?? [], [overview.data]);
  const folderLabel = pagesWords('filters.folder');
  const fields = useMemo(
    () =>
      pageFilterFields(t, tiers, tags, vocabularies.pending || vocabularies.error, {
        sections,
        // A failed read has no sections to check the address against: keep its folder, as while loading
        loading: overview.isPending || overview.isError,
        label: folderLabel,
      }),
    [
      t,
      tiers,
      tags,
      vocabularies.pending,
      vocabularies.error,
      sections,
      overview.isPending,
      overview.isError,
      folderLabel,
    ],
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
  const filtersKey = JSON.stringify([
    state.scope,
    state.view,
    state.worklist,
    state.sort,
    state.q,
    state.depth,
    state.variants,
    values,
    chosenRun,
  ]);
  const paging = useCursorPaging(filtersKey);
  // The chooser decides which parts of a row are read (`include`); changing it reads the current page again once
  const [table, setTable] = useQueryStates(TABLE_KEYS, { history: 'replace' });
  const summary = useQuery(changesSummaryQuery(scope, chosenRun));
  // Until the summary has answered nothing is known of the comparison, so it reads as updating, not as a verdict
  const comparison = summary.isPending
    ? 'updating'
    : comparisonOf(summary.data?.data.state, context.crawl.crawl?.enrich_state);
  const linksAvailable = context.crawl.linksAvailable;
  // Rank and citations are today's numbers; beside an older crawl their headers say so, with that crawl's date
  const crawled = context.crawl.crawl;
  const olderCrawlDate =
    context.crawl.older && crawled !== null
      ? formatIsoDate(crawled.finished_at ?? crawled.created_at, context.timeZone)
      : null;
  // The Issues and Tracked columns exist only while their seams are filled (spec D10)
  const trackedRead = useTrackedPages(scope);
  const trackedIds = trackedRead.state === 'ready' ? trackedRead.data : null;
  const columnWords = useTranslations('pages.columns');
  const columns = useMemo(
    () =>
      pageColumns(t, groups, {
        tiers,
        scope: state.scope,
        openJourney: context.openJourney,
        comparison,
        linksAvailable,
        olderCrawlDate,
        seams: { issues: ISSUE_COLUMNS_AVAILABLE, tracked: trackedIds, t: columnWords },
      }),
    [
      t,
      groups,
      tiers,
      state.scope,
      context.openJourney,
      comparison,
      linksAvailable,
      olderCrawlDate,
      trackedIds,
      columnWords,
    ],
  );
  const known = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const visible = useMemo(
    () =>
      parseColumns(table.cols, known, REQUIRED_COLUMNS) ??
      columns.filter((column) => column.defaultVisible !== false).map((column) => column.id),
    [table.cols, known, columns],
  );
  const include = useMemo(() => moreIncludes(visible), [visible]);
  // The link scope only changes what these columns count
  const scopeShown = SCOPED_COLUMNS.some((id) => visible.includes(id));
  const query = { ...pageQueryOf(state, values, paging.cursor, paging.size, context.host), include };
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

  // The page's Export downloads the same filter as the server's CSV (decision W13)
  // A list the crawl cannot give (a hand typed link worklist of a crawl without its links) has nothing to export
  const gone = isLinksDropped(read.error);
  useEffect(() => {
    if (gone) return undefined;
    const wanted = withRun(pageExportQuery(pageQueryOf(state, values, null, paging.size, context.host)), chosenRun);
    registerExport(() => downloadApiFile(pagesPath(scope), wanted, EXPORT_NAME));
    return () => registerExport(null);
  }, [registerExport, scope, state, values, paging.size, chosenRun, gone, context.host]);

  const range = pageRange({ pageIndex: paging.pageIndex, rows: rows.length, limit: paging.size });
  const searched = state.q !== null;
  // While the rows of the last query stay on screen, the cursors in hand belong to it, not to the one loading
  const settled = !read.isPlaceholderData;
  const filtered = Object.keys(values).length > 0 || searched || state.worklist !== null || state.view !== null;
  const clear = (): void => {
    setValues({});
    setSearch({ q: null, view: null });
  };
  // The View menu: a view is a history entry; Untiered is the tier filter, not a view
  const tierNow = enumValuesOf(values.tier);
  const untieredActive = tierNow.length === 1 && tierNow[0] === UNTIERED_VALUE;
  const activeView = activeViewId({ view: state.view, worklist: state.worklist }, untieredActive);
  const viewWords = useTranslations('pages.view');
  const viewLabel = useViewLabel(scope);
  const viewTrigger = useRef<HTMLButtonElement>(null);
  const focusView = useCallback((): void => viewTrigger.current?.focus(), []);
  // The announcement is of the total the new view lists, so it waits for that read and speaks once per change
  const announcedView = useRef<string>(activeView);
  useEffect(() => {
    if (activeView === announcedView.current || !settled || total === null) return;
    announcedView.current = activeView;
    announce(viewWords('announce', { view: viewLabel(activeView), count: total }));
  }, [activeView, settled, total, viewLabel, viewWords]);
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
  const worklistEmpty = state.worklist === null ? null : EMPTY_KEY[state.worklist];
  const viewEmpty =
    state.view === null
      ? null
      : {
          title: pagesWords(`viewEmpty.${VIEW_EMPTY_KEY[state.view]}Title`),
          reason: pagesWords(`viewEmpty.${VIEW_EMPTY_KEY[state.view]}Reason`),
        };
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
  // Track in Monitoring: a chosen set of pages only, and the numbers and the limit are the seam's to report
  const trackPages = useTrackPages(scope);
  const trackSelected = async (): Promise<void> => {
    try {
      const outcome = await trackPages.track(target.ids);
      const notes = [
        outcome.alreadyTracked > 0 ? pagesWords('track.already', { count: outcome.alreadyTracked }) : null,
        outcome.notLive > 0 ? pagesWords('track.notLive', { count: outcome.notLive }) : null,
        outcome.overLimit > 0
          ? pagesWords('track.overLimit', { count: outcome.overLimit, limit: outcome.limit })
          : null,
      ].filter((note): note is string => note !== null);
      toast({
        type: 'success',
        title: pagesWords('track.done', { added: outcome.added }),
        ...(notes.length === 0 ? {} : { description: formatList(notes, locale) }),
      });
      clearSelection();
    } catch {
      toast({ type: 'error', title: pagesWords('track.failed') });
    }
  };
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
      icon: TagIcon,
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
    ...(TRACKING_AVAILABLE
      ? [
          {
            id: 'track',
            label: pagesWords('track.action'),
            icon: Eye,
            group: 'object' as const,
            disabledReason: chosen.all ? pagesWords('track.onlySelection') : null,
            onSelect: () => {
              if (!chosen.all && !trackPages.pending) void trackSelected();
            },
          },
        ]
      : []),
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DataTable<PageRow>
        caption={t('pages.caption')}
        columnGroups
        compactToolbar
        toolbarParts={{ sortNote: false }}
        toolbarStart={
          <ViewMenu
            scope={scope}
            run={chosenRun}
            linksAvailable={linksAvailable}
            state={{ view: state.view, worklist: state.worklist }}
            untieredActive={untieredActive}
            onView={(next) => {
              // Back to All pages also lets go of the Untiered choice, which is a filter and not a view
              if (next === null && untieredActive)
                setValues(Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'tier')));
              setSearch({ view: next }, { history: 'push' });
            }}
            onUntiered={() => {
              setValues({ ...values, tier: { kind: 'enum', values: [UNTIERED_VALUE] } });
              setSearch({ view: null }, { history: 'push' });
            }}
            onEdgeWorklist={context.openEdgeWorklist}
            triggerRef={viewTrigger}
          />
        }
        toolbarEnd={
          <>
            <TierSuggestions scope={scope} onEmptied={focusView} />
            <FilterBar compact fields={fields} values={values} onChange={setValues} />
            {state.depth === null ? null : (
              <Tag
                label={pagesWords('filters.depthChip', { depth: state.depth })}
                removeLabel={pagesWords('filters.remove', {
                  filter: pagesWords('filters.depthChip', { depth: state.depth }),
                })}
                onRemove={() => setSearch({ depth: null })}
              />
            )}
            {state.variants ? (
              <Tag
                label={pagesWords('filters.variantsChip')}
                removeLabel={pagesWords('filters.remove', { filter: pagesWords('filters.variantsChip') })}
                onRemove={() => setSearch({ variants: null })}
              />
            ) : null}
            {scopeShown ? (
              <ScopeMenu
                scope={state.scope}
                onChange={(next) => setSearch({ scope: next === 'editorial' ? null : next })}
              />
            ) : null}
          </>
        }
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
          setSearch({ sort: next === null || next === context.defaultSort ? null : next });
        }}
        defaultSort={keysOfSort(context.defaultSort)}
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
              // The words name "the important tiers" and not the tiers themselves, so they never change when the
              // alert setting arrives
              title={t(`worklistEmpty.${worklistEmpty}Title`, { tiers: t('worklists.importantTiers') })}
              reason={t(`worklistEmpty.${worklistEmpty}Reason`, { tiers: t('worklists.importantTiers') })}
              headingLevel={3}
              primaryAction={
                <Button variant="secondary" size="sm" onClick={() => setSearch({ view: null })}>
                  {t('pages.showAll')}
                </Button>
              }
            />
          ) : viewEmpty !== null && Object.keys(values).length === 0 && !searched ? (
            <EmptyState
              title={viewEmpty.title}
              reason={viewEmpty.reason}
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
        taxonomyHref={context.taxonomyHref}
        pending={bulk.pending}
        alert={bulk.error}
        onApply={(tag, add) => bulk.changeTag(target, tag, add, 'dialog')}
      />
    </div>
  );
}
