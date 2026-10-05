'use client';

import { FolderTree, MoreHorizontal, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { AddKeywordsDialog, type ProjectDefaults } from './add-keywords/add-keywords-dialog';
import { useBulkActions } from './bulk/bulk-actions';
import { ManageGroupsDialog } from './groups/manage-groups-dialog';
import { DEFAULT_SORT, SORT_FIELDS, keywordText, rowId, useKeywordColumns } from './keyword-columns';
import { useKeywordFilterFields } from './keyword-filters';
import { KeywordInspector, type InspectorEditState } from './keyword-inspector/keyword-inspector';
import {
  PAGE_SIZE_CHOICES,
  keywordFilters,
  useKeywordList,
  useTrackedCount,
  type KeywordList,
  type ProjectScope,
} from './rankings-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import type { TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PageHeader } from '@/components/app/shell/page-header';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { DiscardChangesDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu } from '@/components/ui/menu';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger, formatList, formatRelative } from '@/lib/format';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';
import {
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

/** The server-mode search waits this long after the last keystroke (13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;
/** The id of the More actions item that opens Manage groups. */
const MANAGE_GROUPS = 'manage-groups';
const VIEW_STATE = {
  archived: parseAsBoolean.withDefault(false),
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
};

export interface RankingsScreenProps extends ProjectScope {
  /** The project's time zone, for the Added column. */
  timeZone: string;
  /** The project's location and language, which new keywords start with. */
  defaults: ProjectDefaults;
}

/**
 * SEO > Rankings for step 5 part 1 (20-frontend-specification.md section 5.3, 24-page-templates.md
 * section 9.3): the project's tracked keywords with their Labs metrics, filtered by chips, searched,
 * sorted, and switched between active and archived keywords, with the keyword inspector and Add keywords.
 * Every choice lives in the URL. Rank columns and the metric strip arrive with rank collection.
 */
export function RankingsScreen({ workspaceId, projectId, timeZone, defaults }: RankingsScreenProps): ReactNode {
  const t = useTranslations('rankings');
  const common = useTranslations('common');
  const errors = useTranslations('status.error');
  const locale = useLocale();
  const canWrite = useCan('keywords:write');
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  // Where focus returns to when Manage groups closes
  const moreButton = useRef<HTMLButtonElement>(null);
  const scope = useMemo((): ProjectScope => ({ workspaceId, projectId }), [workspaceId, projectId]);

  const fields = useKeywordFilterFields(scope);
  // A filter of a shared link that does not read is left out, and the person is told (13 section 5)
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedFilters.title', { count: dropped.length }),
        description: t('droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const columns = useKeywordColumns(timeZone);
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, SORT_FIELDS);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['keyword']), [view.cols, columnIds]);
  const density = parseDensity(view.density);
  const filters = useMemo(() => keywordFilters(values, view.archived), [values, view.archived]);
  const search = useDebouncedValue(view.q, SEARCH_DELAY_MS);

  const list = useKeywordList({ scope, filters, sort, search });
  const tracked = useTrackedCount(scope);

  // The chosen keywords, kept through sorting and a search in memory, and dropped when the list asked
  // for changes: other filters, the other view, or a search the API runs. Only the API's search goes with
  // "every matching keyword": in client mode the count and the filters sent leave a search in memory out.
  const bulkSearch = list.mode === 'server' ? search : '';
  const selectionKey = JSON.stringify([filters, bulkSearch]);
  const emptySelection = { key: selectionKey, ids: new Set<string>(), allMatching: false };
  const [selection, setSelection] = useState<{ key: string; ids: ReadonlySet<string>; allMatching: boolean }>(
    emptySelection,
  );
  // A change of what the list asks for drops the selection for good, so going back does not bring it back
  if (selection.key !== selectionKey) setSelection(emptySelection);
  const chosen = selection.key === selectionKey ? selection : emptySelection;
  // The table may set both in one event (untick a row: no longer all matching, and fewer ids), so each
  // setter changes its own part of the latest state
  const setChosenIds = (ids: ReadonlySet<string>): void => setSelection((current) => ({ ...current, ids }));
  const setAllMatching = (allMatching: boolean): void => setSelection((current) => ({ ...current, allMatching }));
  const clearSelection = (): void => setSelection(emptySelection);
  // "Select all N matching" is offered while the table holds fewer rows than match, and not while a
  // search in memory narrows what it shows
  const matchingTotal =
    list.total !== null && list.total > list.rows.length && (list.mode === 'server' || view.q.trim() === '')
      ? list.total
      : null;
  const bulk = useBulkActions({
    scope,
    filters,
    search: bulkSearch,
    archived: view.archived,
    matchingTotal: list.total,
    onDone: clearSelection,
  });
  const filtered = Object.keys(values).length > 0;
  const status = statusOf(list, filtered || view.archived || (list.mode === 'server' && search.trim() !== ''));
  const updated = newestFetch(list.rows);
  const updatedText = updated === null ? null : t('updated', { time: formatRelative(updated, timeZone) });
  const countText = tracked === null ? null : t('tracked', { count: tracked, formatted: formatInteger(tracked) });
  const meta =
    updatedText !== null && countText !== null
      ? t('meta', { updated: updatedText, tracked: countText })
      : (updatedText ?? countText ?? '');
  const errorId = isApiProblem(list.error) ? list.error.requestId : null;

  // The keyword inspector: opened from a row, stepping in the table's order, asking before it leaves a
  // keyword with unsaved changes (16-drawers-dialogs-popovers.md section 2.5)
  const inspector = useInspector();
  const openId = inspector.target?.type === 'keyword' ? inspector.target.id : null;
  const [order, setOrder] = useState<readonly string[]>([]);
  const [editState, setEditState] = useState<InspectorEditState>('clean');
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);
  const [discards, setDiscards] = useState(0);
  const leaveGuard = useLeaveGuard(editState !== 'clean');
  // A save on its way holds the inspector on its keyword; unsaved changes are asked about first
  const guarded = (run: () => void): void => {
    if (editState === 'saving') return;
    if (editState === 'dirty') setPendingLeave({ run });
    else run();
  };
  const at = inspector.position(order);
  const step = (direction: 'next' | 'previous'): void => {
    // A step past either end goes nowhere, so it asks nothing
    if (at === null || (direction === 'next' ? at.index === at.count - 1 : at.index === 0)) return;
    guarded(() => inspector.step(direction, order));
  };
  const openRow = openId === null ? null : (list.rows.find((row) => row.tracked_keyword_id === openId) ?? null);
  // Only a list that holds every match, read to its end, can tell that the filters or the search leave the
  // keyword out of the table
  const listComplete =
    list.mode === 'client' && !list.loading && !list.stale && list.loadProgress === null && list.incomplete === null;
  const hiddenByFilters = openId !== null && listComplete && !order.includes(openId);
  const onRowOpen = (row: TrackedKeywordRow, intent: 'inspector' | 'new-tab'): void => {
    const target = { type: 'keyword' as const, id: row.tracked_keyword_id };
    if (intent === 'new-tab') {
      const url = new URL(window.location.href);
      url.searchParams.set('inspect', formatInspectTarget(target));
      url.searchParams.delete('itab');
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (row.tracked_keyword_id === openId) return;
    guarded(() => inspector.open(target));
  };
  const onEditStateChange = useCallback((state: InspectorEditState) => setEditState(state), []);

  const setSort = (next: readonly SortKey[]): void => {
    void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) });
  };
  const setDensity = (next: Density): void => {
    void setView({ density: next === 'default' ? null : next });
  };
  const clearFilters = (): void => setValues({});
  // The search that found nothing: in server mode the one the API was sent, which lags the box by the delay
  const searched = (list.mode === 'server' ? search : view.q).trim();
  const activeFilters = Object.keys(values).length;
  const addButton = (
    <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
      {t('add.open')}
    </Button>
  );
  const headerActions = (
    <>
      <Menu
        align="end"
        trigger={<IconButton ref={moreButton} icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
        items={[
          {
            id: MANAGE_GROUPS,
            label: t('groups.manage.open'),
            icon: FolderTree,
            onSelect: () => setManaging(true),
          },
        ]}
      />
      {addButton}
    </>
  );
  const emptyState = (
    <EmptyState
      title={t('empty.title')}
      reason={t('empty.reason')}
      headingLevel={2}
      primaryAction={canWrite ? addButton : undefined}
    />
  );
  // A keyword tracked already opens in the inspector, in the archived view when it is archived; like any
  // other move of the inspector, it asks first about unsaved changes
  const showKeyword = (id: string, archived: boolean): void =>
    guarded(() => {
      if (archived !== view.archived) void setView({ archived: archived ? true : null });
      inspector.open({ type: 'keyword', id });
    });
  // The tracked count is of active keywords, so the Archived view does not quote it
  const noMatchesReason = view.archived
    ? t('noMatches.reasonArchived', { count: activeFilters })
    : tracked === null
      ? t('noMatches.reasonUnknown', { count: activeFilters })
      : t('noMatches.reason', { tracked: formatInteger(tracked), count: activeFilters });
  const filteredEmpty =
    searched !== '' ? (
      <EmptyState
        title={t('searchEmpty.title', { query: searched })}
        reason={t('searchEmpty.reason')}
        headingLevel={2}
        details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
        primaryAction={
          <Button variant="secondary" onClick={() => void setView({ q: null })}>
            {t('searchEmpty.clear')}
          </Button>
        }
      />
    ) : filtered ? (
      <EmptyState
        title={t('noMatches.title')}
        reason={noMatchesReason}
        headingLevel={2}
        details={<ReadOnlyFilterChips fields={fields} values={values} />}
        primaryAction={
          <Button variant="secondary" onClick={clearFilters}>
            {t('noMatches.clear')}
          </Button>
        }
      />
    ) : view.archived ? (
      <EmptyState title={t('archivedEmpty.title')} reason={t('archivedEmpty.reason')} headingLevel={2} />
    ) : (
      emptyState
    );

  const keywordInspector =
    openId === null ? null : (
      <KeywordInspector
        scope={scope}
        trackedKeywordId={openId}
        row={openRow}
        timeZone={timeZone}
        positionText={
          at === null
            ? null
            : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
        }
        navigation={
          at === null
            ? null
            : {
                onPrevious: () => step('previous'),
                onNext: () => step('next'),
                atFirst: at.index === 0,
                atLast: at.index === at.count - 1,
              }
        }
        onStep={at === null ? undefined : step}
        onClose={() => guarded(() => inspector.close())}
        onEditStateChange={onEditStateChange}
        discards={discards}
        hiddenByFilters={hiddenByFilters}
      />
    );

  return (
    <InspectorLayout inspector={keywordInspector}>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-4 px-3 pt-5 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          meta={meta === '' ? undefined : meta}
          actions={canWrite ? headerActions : undefined}
        />
        <FilterBar
          fields={fields}
          values={values}
          onChange={setValues}
          trailing={
            <SegmentedControl<'active' | 'archived'>
              semantics="view"
              label={t('view.label')}
              value={view.archived ? 'archived' : 'active'}
              onValueChange={(next) => void setView({ archived: next === 'archived' ? true : null })}
              items={[
                { value: 'active', label: t('view.active') },
                { value: 'archived', label: t('view.archived') },
              ]}
            />
          }
        />
        {list.incomplete === null ? null : (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('incomplete.message', {
              loaded: formatInteger(list.rows.length),
              total: formatInteger(list.total ?? list.rows.length),
            })}
            actions={
              <Button variant="secondary" size="sm" onClick={list.incomplete.retry} loading={list.incomplete.retrying}>
                {common('retry')}
              </Button>
            }
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<TrackedKeywordRow>
            caption={t('caption')}
            itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
            columns={columns}
            getRowId={rowId}
            rows={list.rows}
            total={list.total}
            server={
              list.server === null
                ? undefined
                : {
                    rangeText: t('range', {
                      from: formatInteger(list.server.offset + 1),
                      to: formatInteger(list.server.offset + list.rows.length),
                      total: formatInteger(list.total ?? 0),
                    }),
                    offset: list.server.offset,
                    hasPrevious: list.server.hasPrevious,
                    hasNext: list.server.hasNext,
                    onPrevious: list.server.previous,
                    onNext: list.server.next,
                    pageSize: list.server.pageSize,
                    onPageSizeChange: list.server.setPageSize,
                    pageSizes: PAGE_SIZE_CHOICES,
                  }
            }
            loadProgress={list.loadProgress}
            sort={sort}
            onSortChange={setSort}
            defaultSort={DEFAULT_SORT}
            density={density}
            onDensityChange={setDensity}
            columnState={{
              visible,
              onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
            }}
            search={view.q}
            onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
            searchPlaceholder={t('search')}
            searchText={list.mode === 'server' ? undefined : keywordText}
            rowName={keywordText}
            status={status}
            errorState={
              <InlineError
                title={t('error.title')}
                reason={t('error.reason')}
                errorId={
                  errorId === null
                    ? null
                    : {
                        id: errorId,
                        label: errors('errorId', { id: errorId }),
                        copyLabel: errors('copyErrorId'),
                        copiedLabel: errors('copied'),
                      }
                }
                onRetry={list.refetch}
                retrying={list.fetching}
                retryLabel={common('retry')}
                live
              />
            }
            emptyState={emptyState}
            filteredEmptyState={filteredEmpty}
            footerNote={updatedText ?? undefined}
            onRowOpen={onRowOpen}
            activeRowId={openId}
            onRowOrderChange={setOrder}
            selection={
              canWrite
                ? {
                    selectedIds: chosen.ids,
                    onChange: setChosenIds,
                    matchingTotal,
                    allMatching: chosen.allMatching,
                    onAllMatchingChange: setAllMatching,
                  }
                : undefined
            }
            bulkActions={canWrite ? bulk.actions : undefined}
          />
        </div>
      </div>
      {canWrite ? bulk.dialogs : null}
      {canWrite ? (
        <ManageGroupsDialog scope={scope} open={managing} onOpenChange={setManaging} finalFocus={moreButton} />
      ) : null}
      {canWrite ? (
        <AddKeywordsDialog
          scope={scope}
          defaults={defaults}
          open={adding}
          onOpenChange={setAdding}
          onShowKeyword={showKeyword}
        />
      ) : null}
      <DiscardChangesDialog
        open={pendingLeave !== null || leaveGuard.pending !== null}
        title={t('inspector.discard.title')}
        description={t('inspector.discard.description')}
        keepEditingLabel={t('inspector.discard.keepEditing')}
        discardLabel={t('inspector.discard.discard')}
        onKeepEditing={() => {
          setPendingLeave(null);
          leaveGuard.stay();
        }}
        onDiscard={() => {
          if (pendingLeave === null) {
            leaveGuard.leave();
            return;
          }
          setPendingLeave(null);
          // The inspector ends its edit, whether or not the action moves it to another keyword
          setDiscards((count) => count + 1);
          setEditState('clean');
          pendingLeave.run();
        }}
      />
    </InspectorLayout>
  );
}

/**
 * The table's state: the error and loading first, then empty or filtered to nothing. An empty answer to the
 * previous filters is not shown as this one's while the new rows load.
 */
function statusOf(list: KeywordList, narrowed: boolean): TableStatus {
  if (list.error !== null && list.rows.length === 0) return 'error';
  if (list.loading || (list.stale && list.total === 0)) return 'loading';
  if (list.total === 0) return narrowed ? 'filtered-empty' : 'empty';
  return list.fetching ? 'refetching' : 'ready';
}

/** When the newest metrics of the rows at hand were fetched, or `null` when none has metrics yet. */
function newestFetch(rows: readonly TrackedKeywordRow[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    const fetched = row.metrics?.fetched_at ?? null;
    if (fetched !== null && (newest === null || fetched > newest)) newest = fetched;
  }
  return newest;
}
