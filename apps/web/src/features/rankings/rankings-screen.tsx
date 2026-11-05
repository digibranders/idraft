'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FolderTree, MoreHorizontal, Plus, Upload, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { AddKeywordsDialog, type ProjectDefaults } from './add-keywords/add-keywords-dialog';
import { useBulkActions } from './bulk/bulk-actions';
import { ManageGroupsDialog } from './groups/manage-groups-dialog';
import type { GroupedRow } from './grouped/grouped-rows';
import { keywordActions, useGroupedTable, viewToShow } from './grouped/use-grouped-table';
import type { KeywordsView } from './grouped/view-columns';
import { ViewSwitch } from './grouped/view-switch';
import { ImportProgress } from './import/import-progress';
import { forgetWritingImport, useWritingImport } from './import/import-queries';
import {
  COUNTRY_COLUMN,
  DEFAULT_SORT,
  SORT_FIELDS,
  keywordText,
  rowId,
  useKeywordColumns,
  useKeywordRowName,
} from './keyword-columns';
import { useKeywordCountries } from './keyword-countries';
import { useKeywordFilterFields } from './keyword-filters';
import { expandIds, memberIds, memberRows, pairRows, type PairedRow } from './keyword-pairs';
import { ALL_COUNTRIES, KeywordScopeControls, useCountries, useKeywordScope } from './keyword-scope';
import { KeywordInspector, type InspectorEditState } from './keyword-inspector/keyword-inspector';
import { isProjectCompetitor, projectEntitiesQuery } from './keyword-inspector/inspector-queries';
import {
  PAGE_SIZE_CHOICES,
  hasPendingCheck,
  keywordFilters,
  readAllKeywords,
  useKeywordList,
  useTrackedCount,
  type KeywordList,
  type ProjectScope,
} from './rankings-queries';
import { usePendingMetrics } from './refresh/pending-metrics';
import { useMetricsRefresh } from './refresh/use-metrics-refresh';
import { useCheckNow } from './check-now/use-check-now';
import { useKeywordGroups } from './taxonomy-queries';
import { RankStrip } from './strip/rank-strip';
import { DataTable } from '@/components/app/data-table/data-table';
import type { RecordAction, TableStatus } from '@/components/app/data-table/types';
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
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { SplitButton } from '@/components/ui/split-button';
import { buildCsv, buildWorkbook, download, fileName, type ExportFormat } from './export/export-file';
import { readWorkbookColors } from './export/export-colors';
import { buildExport } from './export/export-model';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { useErrorId } from '@/lib/api/use-error-id';
import type { EntityRef, TrackedKeywordRow } from '@/lib/api/types';
import { useDebouncedValue } from '@/lib/dom/use-debounced-value';
import { formatInteger, formatList, formatRelative } from '@/lib/format';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { useLeaveGuard } from '@/lib/navigation/use-leave-guard';
import { useCan } from '@/lib/permissions';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';

// The import dialog (the upload and the review of a file) loads on its first opening, and a member who
// cannot import never loads it: it is one of the larger chunks of the page. Hovering or focusing the button
// starts the load, so the dialog is usually there when it is pressed.
const loadImportDialog = (): Promise<typeof import('./import/import-dialog')> => import('./import/import-dialog');
const ImportDialog = dynamic(() => loadImportDialog().then((module) => module.ImportDialog), { ssr: false });

/** The server-mode search waits this long after the last keystroke (13-filters-search.md section 6). */
const SEARCH_DELAY_MS = 250;
/** The id of the More actions item that opens Manage groups. */
const MANAGE_GROUPS = 'manage-groups';
const SHOW_ARCHIVED = 'show-archived';
const EXPORT_XLSX = 'export-xlsx';
const EXPORT_CSV = 'export-csv';
/** The list as the table shows it: one row for each keyword, with the rows of its devices behind it. */
type PairedList = Omit<KeywordList, 'rows'> & { rows: readonly PairedRow[] };

const VIEW_STATE = {
  archived: parseAsBoolean.withDefault(false),
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
  view: parseAsStringLiteral(['groups', 'flat'] as const),
};
const NO_ROWS: readonly PairedRow[] = [];
export interface RankingsScreenProps extends ProjectScope {
  /** The project's time zone, for the Added column. */
  timeZone: string;
  /** The project's location and language, which new keywords start with. */
  defaults: ProjectDefaults;
  /** A country (or `ALL_COUNTRIES`) the table opens on instead of the project's own; the URL's `loc` wins. */
  scopeOpensOn?: number;
  /** A view the table opens on instead of the default (By group when the project has groups); the URL's `view` wins. */
  viewOpensOn?: KeywordsView;
  /** Whether the import dialog is open over the screen; the route says so (`/seo/rankings/import`). Default `false`. */
  importOpen?: boolean;
  /** Asks the route to open or close the import dialog. */
  onImportOpenChange?: (open: boolean) => void;
  /** The project's tracked depth (e.g. 100), used to label the beyond-depth filter bucket "Over 100". */
  depth?: number | undefined;
}

/**
 * SEO > Rankings for step 5 (20-frontend-specification.md section 5.3, 24-page-templates.md section 9.3):
 * the project's tracked keywords with their rank, its change, the URL that ranks and their Labs metrics,
 * filtered by chips, searched, sorted, and switched between active and archived keywords, with the keyword
 * inspector and Add keywords. Every choice lives in the URL. The metric strip, the sparkline and the other
 * rank columns of the template wait for their own plans.
 */
export function RankingsScreen({
  workspaceId,
  projectId,
  timeZone,
  defaults,
  scopeOpensOn,
  viewOpensOn,
  importOpen = false,
  onImportOpenChange,
  depth,
}: RankingsScreenProps): ReactNode {
  const t = useTranslations('rankings');
  const common = useTranslations('common');
  const discard = useTranslations('account.discard');
  const competitorT = useTranslations('rankings.competitor');
  const columnsT = useTranslations('rankings.columns');
  const rankT = useTranslations('rankings.rank');
  const exportColumnsT = useTranslations('rankings.export.columns');
  const stripT = useTranslations('rankings.strip');
  const locale = useLocale();
  const canWrite = useCan('keywords:write');
  const canImport = useCan('imports:write');
  // The import dialog is mounted from its first opening on, and stays so, keeping what it holds when closed
  const [importWanted, setImportWanted] = useState(importOpen);
  if (importOpen && !importWanted) setImportWanted(true);
  const canRefresh = useCan('runs:trigger');
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  // The imports whose writes the header follows: those Confirm started, and one a reload found under way.
  // An import that ended is remembered, so no later read of the writes under way brings it back.
  const [startedImports, setStartedImports] = useState<readonly string[]>([]);
  const [endedImports, setEndedImports] = useState<ReadonlySet<string>>(new Set());
  const queryClient = useQueryClient();
  // Where focus returns to when Manage groups closes
  const moreButton = useRef<HTMLButtonElement>(null);
  const scope = useMemo((): ProjectScope => ({ workspaceId, projectId }), [workspaceId, projectId]);

  const fields = useKeywordFilterFields(scope, depth);
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
  // Which devices show a rank column, and the country the keywords are tracked in
  const countries = useCountries();
  const inUse = useKeywordCountries(scope);
  const countriesInUse = inUse.countries;
  const keywordScope = useKeywordScope(defaults.location, inUse, scopeOpensOn, countries);
  const entitiesQuery = useQuery(projectEntitiesQuery(scope));
  const competitors = useMemo((): EntityRef[] => {
    if (entitiesQuery.data) {
      return entitiesQuery.data.data
        .filter(isProjectCompetitor)
        .map((pe) => ({ ...pe.entity, color_index: pe.entity.color_index ?? pe.color_index }));
    }
    // Retain competitor columns from URL cols while entities query is pending or if it failed,
    // so competitor IDs are not dropped on the next column toggle and no blank headers show.
    if (view.cols) {
      const parsedIds = view.cols.split(',').filter((colId) => colId.startsWith('competitor_'));
      return parsedIds.map((colId) => {
        const entityId = colId.replace(/^competitor_/, '');
        return {
          entity_id: entityId,
          canonical_name: entityId,
          color_index: null,
          entity_type: 'organization' as const,
          role: 'competitor' as const,
        };
      });
    }
    return [];
  }, [entitiesQuery.data, view.cols]);
  const allColumns = useKeywordColumns(timeZone, competitors, keywordScope.device, countriesInUse);
  const rowName = useKeywordRowName(defaults.languageCode);
  // The Country column is a known id even while it is not shown, so a person's choice of it stays in the URL
  const columnIds = useMemo(() => new Set(allColumns.map((column) => column.id)), [allColumns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, SORT_FIELDS);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['keyword']), [view.cols, columnIds]);
  const density = parseDensity(view.density);
  const filters = useMemo(
    () => ({
      ...keywordFilters(values, view.archived),
      ...(keywordScope.countryId === ALL_COUNTRIES ? {} : { 'filter[country_id]': keywordScope.countryId }),
    }),
    [values, view.archived, keywordScope.countryId],
  );
  // The summary counts the keywords of the device shown
  const stripFilters = useMemo(
    () => ({ ...filters, 'filter[device]': keywordScope.device }),
    [filters, keywordScope.device],
  );
  const search = useDebouncedValue(view.q, SEARCH_DELAY_MS);

  const loadedList = useKeywordList({ scope, filters, sort, search, enabled: keywordScope.ready });
  // New keywords wait for their first metrics: the poll lays what it hears over the rows, and only those
  const rows = usePendingMetrics({
    scope,
    filters,
    rows: loadedList.rows,
    mode: loadedList.mode,
    pageRequest: loadedList.pageRequest,
  });
  const rawList = useMemo(
    (): KeywordList => (rows === loadedList.rows ? loadedList : { ...loadedList, rows }),
    [loadedList, rows],
  );
  // A keyword is one row with the rank of the device shown, however many tracked keywords stand behind it
  const pairedRows = useMemo(() => pairRows(rawList.rows, keywordScope.device), [rawList.rows, keywordScope.device]);
  // The Country column shows only while more than one country is in view
  const severalCountries = useMemo(
    () => new Set(pairedRows.map((row) => row.location.country_iso)).size > 1,
    [pairedRows],
  );
  const columns = useMemo(
    () => (severalCountries ? allColumns : allColumns.filter((column) => column.id !== COUNTRY_COLUMN)),
    [allColumns, severalCountries],
  );
  const members = useMemo(() => memberIds(pairedRows), [pairedRows]);
  const list = useMemo(
    (): PairedList => ({
      ...rawList,
      rows: pairedRows,
      // A list read whole knows how many keywords it shows; the API's count is of tracked keywords
      total: rawList.mode === 'client' ? pairedRows.length : rawList.total,
    }),
    [rawList, pairedRows],
  );
  // By group reads every keyword, so a list in server mode is flat whatever the URL says; without a choice
  // in the URL, a project with groups opens on them, once its groups and the list's mode are known
  const projectGroups = useKeywordGroups(scope);
  const groupsAllowed = list.mode !== 'server';
  const shownView = viewToShow({
    chosen: view.view ?? viewOpensOn ?? null,
    mode: list.mode,
    groupCount: projectGroups.isPending ? null : (projectGroups.data?.data.length ?? 0),
  });
  const byGroup = shownView === 'groups';
  const tracked = useTrackedCount(scope);
  const writingNow = useWritingImport(scope, canImport).data?.import_id ?? null;
  const followedImports = [...startedImports, ...(writingNow === null ? [] : [writingNow])].filter(
    (importId, index, all) => !endedImports.has(importId) && all.indexOf(importId) === index,
  );
  const onImportConfirmed = useCallback(
    (importId: string): void => {
      setStartedImports((started) => (started.includes(importId) ? started : [...started, importId]));
      // The bar that shows the import says nothing when it first appears, only when it ends
      announce(t('import.started'));
    },
    [t],
  );
  const onImportSettled = useCallback(
    (importId: string): void => {
      setEndedImports((ended) => new Set(ended).add(importId));
      setStartedImports((started) => started.filter((candidate) => candidate !== importId));
      // The read of "the import being written" is kept for 30 seconds: it must not hold this one any longer
      forgetWritingImport(queryClient, scope, importId);
    },
    [queryClient, scope],
  );

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
  const setChosenIds = useCallback(
    (ids: ReadonlySet<string>): void => setSelection((current) => ({ ...current, ids })),
    [],
  );
  const setAllMatching = (allMatching: boolean): void => setSelection((current) => ({ ...current, allMatching }));
  // By group never stands for "every matching keyword": a choice there is of keywords, and so is the choice
  // that comes back from it
  const chooseInGroups = useCallback(
    (ids: ReadonlySet<string>): void => setSelection((current) => ({ ...current, ids, allMatching: false })),
    [],
  );
  const [selectionView, setSelectionView] = useState(shownView);
  if (selectionView !== shownView) {
    setSelectionView(shownView);
    if (selection.allMatching) setAllMatching(false);
  }
  const clearSelection = (): void => setSelection(emptySelection);
  // The chosen keywords with their other device's tracked keyword: what an action is asked about
  const reached = useMemo(
    () => ({ ids: expandIds(chosen.ids, members), allMatching: chosen.allMatching }),
    [chosen.ids, chosen.allMatching, members],
  );
  const dropChosen = useCallback((gone: ReadonlySet<string>): void => {
    setSelection((current) => ({ ...current, ids: new Set([...current.ids].filter((id) => !gone.has(id))) }));
  }, []);
  // "Select all N matching" is offered while the table holds fewer rows than match, and not while a
  // search in memory narrows what it shows
  // (counted in tracked keywords, which is what the API counts and an action sends)
  const matchingTotal =
    rawList.total !== null && rawList.total > rawList.rows.length && (rawList.mode === 'server' || view.q.trim() === '')
      ? rawList.total
      : null;
  // Only a list that holds every match, read to its end, can tell that the filters or the search leave a
  // keyword out of the table, and which groups the keywords a change reaches are in
  const listComplete =
    list.mode === 'client' && !list.loading && !list.stale && list.loadProgress === null && list.incomplete === null;
  const bulk = useBulkActions({
    scope,
    filters,
    search: bulkSearch,
    archived: view.archived,
    matchingTotal: rawList.total,
    rows: rawList.rows,
    rowsComplete: listComplete,
    onDone: clearSelection,
  });
  const filtered = Object.keys(values).length > 0;
  const refresh = useMetricsRefresh({
    scope,
    enabled: canRefresh,
    archived: view.archived,
    list: rawList,
    chosen: reached,
    narrowed: filtered,
    menuButton: moreButton,
    onDrop: dropChosen,
  });
  const pendingChecks = useMemo(
    (): ReadonlySet<string> => new Set(rawList.rows.filter(hasPendingCheck).map((row) => row.tracked_keyword_id)),
    [rawList.rows],
  );
  const checkNow = useCheckNow({
    scope,
    enabled: canRefresh,
    archived: view.archived,
    chosen: reached,
    pendingIds: pendingChecks,
    onDrop: dropChosen,
  });
  // Check now goes right before Refresh metrics, both ahead of the first destructive action
  const firstDestructive = bulk.actions.findIndex((action) => action.group === 'destructive');
  const insertAt = firstDestructive === -1 ? bulk.actions.length : firstDestructive;
  const nonDestructive = bulk.actions.slice(0, insertAt);
  const destructive = bulk.actions.slice(insertAt);
  const checkNowBar = checkNow.barAction === null ? [] : [checkNow.barAction];
  const refreshBar = refresh.barAction === null ? [] : [refresh.barAction];
  // An action reaches the keyword on both devices, whichever row was chosen
  const expandAction = (action: RecordAction<TrackedKeywordRow>): RecordAction<PairedRow> => ({
    ...action,
    onSelect: (chosenRows, actionScope) =>
      action.onSelect(memberRows(chosenRows), {
        ids: expandIds(actionScope.ids, members),
        allMatching: actionScope.allMatching,
      }),
  });
  const bulkActions = [...nonDestructive, ...checkNowBar, ...refreshBar, ...destructive].map(expandAction);
  const groupedBulkActions = keywordActions(bulkActions, pairedRows, chosen.ids);
  const menuItems: MenuItemDef[] = [
    ...(refresh.menuItem === null ? [] : [refresh.menuItem]),
    ...(canWrite
      ? [{ id: MANAGE_GROUPS, label: t('groups.manage.open'), icon: FolderTree, onSelect: () => setManaging(true) }]
      : []),
    {
      id: SHOW_ARCHIVED,
      kind: 'checkbox' as const,
      icon: Archive,
      label: t('view.showArchived'),
      checked: view.archived,
      onSelect: () => void setView({ archived: view.archived ? null : true }),
    },
  ];
  const updated = newestFetch(list.rows);
  const updatedText = updated === null ? null : t('updated', { time: formatRelative(updated, timeZone) });
  // The summary strip counts the keywords the table shows; the project's tracked keywords (a keyword on each
  // device is two) are quoted only where the strip is not, so two counts never stand side by side
  const showStrip = !view.archived && (list.total ?? list.rows.length) !== 0;
  const countText =
    tracked === null || showStrip ? null : t('tracked', { count: tracked, formatted: formatInteger(tracked) });
  const meta =
    updatedText !== null && countText !== null
      ? t('meta', { updated: updatedText, tracked: countText })
      : (updatedText ?? countText ?? '');
  const errorId = useErrorId(list.error);

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
  const openRow = openId === null ? null : (rawList.rows.find((row) => row.tracked_keyword_id === openId) ?? null);
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
  const setColumns = (next: readonly string[] | null): void => {
    // The table cannot offer a column that is out of view, so a change to the others keeps it chosen:
    // it is in the explicit list when the person had it there, and in the default one
    const kept =
      next !== null && !severalCountries && (visible === null || visible.includes(COUNTRY_COLUMN))
        ? [...next.slice(0, 1), COUNTRY_COLUMN, ...next.slice(1)]
        : next;
    void setView({ cols: kept === null ? null : formatColumns(kept) });
  };
  const grouped = useGroupedTable({
    rows: byGroup ? pairedRows : NO_ROWS,
    search,
    chosen: chosen.ids,
    onChosenChange: chooseInGroups,
    members,
    keywordColumns: columns,
    timeZone,
    visible,
    onColumnsChange: setColumns,
    keywordRowName: rowName,
    onKeywordOpen: onRowOpen,
    openId,
    onOrderChange: setOrder,
  });
  // In By group the keyword may sit in a closed group: it is hidden only when the search or filters leave it out
  const hiddenByFilters =
    openId !== null && listComplete && !(byGroup ? grouped.inView(openId) : order.includes(openId));
  const listStatus = statusOf(list, filtered || view.archived || (list.mode === 'server' && search.trim() !== ''));
  // The table waits for the view to be known; the tree does not search itself, so a search that leaves no
  // group is the search's empty state
  const status =
    shownView === null && listStatus !== 'error'
      ? 'loading'
      : byGroup && (listStatus === 'ready' || listStatus === 'refetching') && grouped.table.rows.length === 0
        ? 'filtered-empty'
        : listStatus;
  const onEditStateChange = useCallback((state: InspectorEditState) => setEditState(state), []);

  const setSort = (next: readonly SortKey[]): void => {
    void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) });
  };
  const setDensity = (next: Density): void => {
    void setView({ density: next === DEFAULT_DENSITY ? null : next });
  };
  const clearFilters = (): void => setValues({});
  // The search that found nothing: in server mode the one the API was sent, which lags the box by the delay
  const searched = (list.mode === 'server' ? search : view.q).trim();
  const activeFilters = Object.keys(values).length;
  const addButton = (
    <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
      {t('add.open')}
    </Button>
  );
  const [exporting, setExporting] = useState(false);
  // The table as it is filtered, read whole whatever its mode, with the counts of the strip above it
  const exportKeywords = async (format: ExportFormat): Promise<void> => {
    setExporting(true);
    try {
      const device = keywordScope.device;
      const rows = pairRows(await readAllKeywords(scope, filters, view.q, new AbortController().signal), device);
      const table = buildExport(rows, device, {
        keyword: exportColumnsT('keyword'),
        rank: rankT('rank'),
        desktop: columnsT('desktop'),
        mobile: columnsT('mobile'),
        url: exportColumnsT('url'),
        volume: exportColumnsT('volume'),
        difficulty: exportColumnsT('difficulty'),
        cpc: exportColumnsT('cpc'),
        intent: exportColumnsT('intent'),
        priority: exportColumnsT('priority'),
        groups: exportColumnsT('groups'),
        checked: exportColumnsT('checked'),
        keywords: stripT('tracked'),
        top3: stripT('top3'),
        top10: stripT('top10'),
        top20: stripT('top20'),
        intents: {
          informational: columnsT('intents.informational'),
          navigational: columnsT('intents.navigational'),
          commercial: columnsT('intents.commercial'),
          transactional: columnsT('intents.transactional'),
          local: columnsT('intents.local'),
        },
      });
      const now = new Date();
      const country =
        keywordScope.countryId === ALL_COUNTRIES
          ? t('scope.allCountries')
          : (countries.find((candidate) => candidate.location_id === keywordScope.countryId)?.name ?? '');
      const deviceText = columnsT(device);
      const filterText =
        activeFilters + (view.q.trim() === '' ? 0 : 1) === 0
          ? t('export.filtersNone')
          : t('export.filtersCount', { count: activeFilters + (view.q.trim() === '' ? 0 : 1) });
      const context = [
        [t('export.country'), country],
        [t('export.devices'), deviceText],
        [t('export.filters'), view.archived ? `${filterText}, ${t('export.archived')}` : filterText],
        [t('export.exported'), `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`],
      ] as const;
      const blob =
        format === 'xlsx'
          ? await buildWorkbook(t('export.sheet'), context, table, readWorkbookColors())
          : buildCsv(table);
      download(blob, fileName(format, now));
    } catch {
      toast({
        type: 'error',
        title: t('export.failed.title'),
        description: t('export.failed.description'),
      });
    } finally {
      setExporting(false);
    }
  };
  const exportMenu = (
    <Menu
      align="end"
      trigger={
        <Button variant="secondary" size="sm" icon={Download} disabled={exporting}>
          {t('export.open')}
        </Button>
      }
      items={[
        { id: EXPORT_XLSX, label: t('export.xlsx'), onSelect: () => void exportKeywords('xlsx') },
        { id: EXPORT_CSV, label: t('export.csv'), onSelect: () => void exportKeywords('csv') },
      ]}
    />
  );
  const importItem: MenuItemDef = {
    id: 'import',
    label: t('add.importFile'),
    icon: Upload,
    onSelect: () => onImportOpenChange?.(true),
  };
  // Import is another way to add keywords: one small button with the file import under its arrow
  const addControl =
    canWrite && canImport ? (
      <SplitButton
        variant="primary"
        size="sm"
        icon={Plus}
        groupLabel={t('add.options')}
        menuLabel={t('add.moreWays')}
        items={[importItem]}
        onMenuOpenChange={(open) => {
          if (open) void loadImportDialog();
        }}
        onClick={() => setAdding(true)}
      >
        {t('add.open')}
      </SplitButton>
    ) : canWrite ? (
      addButton
    ) : canImport ? (
      <Button variant="secondary" size="sm" icon={Upload} onClick={() => onImportOpenChange?.(true)}>
        {t('import.open')}
      </Button>
    ) : null;
  const headerActions = (
    <>
      <Menu
        align="end"
        trigger={<IconButton ref={moreButton} icon={MoreHorizontal} variant="secondary" label={t('moreActions')} />}
        items={menuItems}
        header={refresh.menuHeader}
        onOpenChange={refresh.onMenuOpenChange}
      />
      {exportMenu}
      {addControl}
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
        frequentAction={checkNow.inspectorAction}
      />
    );

  // What both views' tables share; the view switch is the same element in both, so switching keeps the table
  const tableProps = {
    caption: t('caption'),
    itemNoun: { one: t('noun.one'), other: t('noun.other') },
    loadProgress: list.loadProgress,
    sort,
    onSortChange: setSort,
    defaultSort: DEFAULT_SORT,
    density,
    onDensityChange: setDensity,
    search: view.q,
    onSearchChange: (next: string) => void setView({ q: next === '' ? null : next }),
    searchPlaceholder: t('search'),
    status,
    errorState: (
      <InlineError
        title={t('error.title')}
        reason={t('error.reason')}
        errorId={errorId}
        onRetry={list.refetch}
        retrying={list.fetching}
        retryLabel={common('retry')}
        live
      />
    ),
    emptyState,
    filteredEmptyState: filteredEmpty,
    toolbarStart: (
      <ViewSwitch
        view={shownView ?? 'flat'}
        onViewChange={(next) => void setView({ view: next })}
        groupsDisabled={!groupsAllowed}
        sort={grouped.sort}
        onSortChange={grouped.setSort}
      />
    ),
  };

  return (
    <InspectorLayout inspector={keywordInspector}>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-3 px-3 pt-3 pb-5 md:px-4 lg:px-5">
        <PageHeader
          title={t('title')}
          titleHidden
          meta={meta === '' ? undefined : meta}
          actions={headerActions}
          toolbar={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {showStrip ? (
                <div className="flex h-control-sm items-center">
                  <RankStrip
                    scope={scope}
                    filters={stripFilters}
                    total={list.total ?? list.rows.length}
                    enabled={keywordScope.ready}
                  />
                </div>
              ) : null}
              <KeywordScopeControls scope={keywordScope} inUse={countriesInUse} countries={countries} />
              {view.archived ? (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={X}
                  onClick={() => void setView({ archived: null })}
                  aria-label={t('view.backToActive')}
                >
                  {t('view.archivedChip')}
                </Button>
              ) : null}
              <div className="min-w-0 flex-1 basis-24">
                <FilterBar fields={fields} values={values} onChange={setValues} />
              </div>
            </div>
          }
        />
        {followedImports.map((importId) => (
          <ImportProgress
            key={importId}
            scope={scope}
            importId={importId}
            timeZone={timeZone}
            onSettled={onImportSettled}
          />
        ))}
        {checkNow.progress}
        {refresh.progress}
        {entitiesQuery.isError ? (
          <Banner
            tone="negative"
            placement="region"
            message={competitorT('failed')}
            actions={
              <Button variant="secondary" size="sm" onClick={() => void entitiesQuery.refetch()}>
                {common('retry')}
              </Button>
            }
          />
        ) : null}
        {list.incomplete === null ? null : (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('incomplete.message', {
              loaded: formatInteger(rawList.rows.length),
              total: formatInteger(rawList.total ?? rawList.rows.length),
            })}
            actions={
              <Button variant="secondary" size="sm" onClick={list.incomplete.retry} loading={list.incomplete.retrying}>
                {common('retry')}
              </Button>
            }
          />
        )}
        {byGroup && list.loadProgress !== null ? (
          <Banner
            tone="info"
            placement="region"
            message={t('grouped.loading', {
              loaded: formatInteger(list.loadProgress.loaded),
              total: formatInteger(list.loadProgress.total),
            })}
          />
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          {byGroup ? (
            <DataTable<GroupedRow>
              {...tableProps}
              {...grouped.table}
              selection={
                canWrite
                  ? {
                      ...grouped.selection,
                      matchingTotal: null,
                      allMatching: false,
                      onAllMatchingChange: setAllMatching,
                    }
                  : undefined
              }
              bulkActions={canWrite ? groupedBulkActions : undefined}
            />
          ) : (
            <DataTable<PairedRow>
              {...tableProps}
              columns={columns}
              getRowId={rowId}
              rows={list.rows}
              total={list.total}
              server={
                list.server === null
                  ? undefined
                  : {
                      rangeText: t('range', {
                        from: list.server.offset + 1,
                        to: list.server.offset + rawList.rows.length,
                        total: list.total ?? 0,
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
              columnState={{ visible, onChange: setColumns }}
              searchText={list.mode === 'server' ? undefined : keywordText}
              rowName={rowName}
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
              bulkActions={canWrite ? bulkActions : undefined}
            />
          )}
        </div>
      </div>
      {refresh.dialog}
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
      {canImport && importWanted ? (
        <ImportDialog
          scope={scope}
          open={importOpen}
          onOpenChange={(open) => onImportOpenChange?.(open)}
          onConfirmed={onImportConfirmed}
          defaults={defaults}
        />
      ) : null}
      <DiscardChangesDialog
        open={pendingLeave !== null || leaveGuard.pending !== null}
        title={discard('title')}
        description={t('inspector.discard.description')}
        keepEditingLabel={discard('keepEditing')}
        discardLabel={discard('discard')}
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
