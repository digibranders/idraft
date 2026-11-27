'use client';

import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import {
  changeTable,
  CHANGE_COLUMNS,
  exportFileName,
  headerWords,
  switchKeywordTable,
  SWITCH_KEYWORD_COLUMNS,
  type ExportSpec,
} from './cann-export';
import { useExportSpec } from './cann-export-button';
import { CannPanel } from './cann-panel';
import {
  filterSwitches,
  filterSwitchKeywords,
  SWITCH_SHOWS,
  sortRows,
  switchCounts,
  targetStatus,
  truncation,
  type CannState,
  type SwitchShow,
  type TargetStatus,
} from './cann-model';
import { HistoryStrip, KeywordCell, NoValue, PageChip } from './cann-parts';
import type { CannRead } from './cann-reads';
import { ReadError, useCannWidths, ViewSwitch } from './cann-view-parts';
import { SwitchChart } from './switch-chart';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import { EmptyState } from '@/components/app/status/empty-state';
import {
  BoardTable,
  BoardTableSkeleton,
  type BoardColumn,
  type BoardResize,
  type BoardSort,
} from '@/components/app/table/board-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Icon } from '@/components/ui/icon';
import { Truncate } from '@/components/ui/truncate';
import type { CannConflictList, CannKeyword, CannPage, CannSwitchList, CannSwitchRow } from '@/lib/api/types';
import { formatBusinessDate, formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface SwitchingViewProps {
  switches: CannRead<CannSwitchList>;
  /** The keywords with their pages and strips: the By keyword table, and the letters of the Changes table. */
  keywords: CannRead<CannConflictList>;
  state: CannState;
  set: (patch: Partial<CannState>) => void;
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  activeId: string | null;
  /** Opens the keyword's evidence on its Timeline tab. */
  onOpen: (keywordId: string, opener: HTMLElement | null, tab?: string) => void;
  onOrderChange: (ids: readonly string[]) => void;
  /** Tells the toolbar's Export button which table is in view. */
  onExportChange: (spec: ExportSpec | null) => void;
}

const FLEX_MIN = 132;
const NO_ROWS: readonly CannKeyword[] = [];
const CHANGE_SORT: BoardSort = { key: 'when', dir: 'desc' };
const KEYWORD_SORT: BoardSort = { key: 'switches', dir: 'desc' };
const OPEN_TAB = 'timeline';

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** One side of a switch as a page chip: with its letter when the keyword's own list has it, else a plain mark. */
function sidePage(
  row: CannSwitchRow,
  side: 'from' | 'to',
  pages: readonly CannPage[] | undefined,
): Pick<CannPage, 'letter' | 'path' | 'title'> {
  const id = side === 'from' ? row.event.from_url_id : row.event.to_url_id;
  const known = pages?.find((page) => page.url_id === id);
  if (known !== undefined) return known;
  return {
    letter: '+',
    path: pathOf(side === 'from' ? row.from_url : row.to_url),
    title: side === 'from' ? row.from_title : row.to_title,
  };
}

const switchId = (row: CannSwitchRow): string => `${row.tracked_keyword_id}|${row.event.date}`;

const CHANGE_SORT_VALUE: Readonly<Record<string, (row: CannSwitchRow) => string | number>> = {
  keyword: (row) => row.keyword,
  when: (row) => row.event.date,
  change: (row) => row.rank_change,
  held: (row) => row.event.held_days,
  type: (row) => (row.event.is_flip_flop ? 1 : 0),
};

const KEYWORD_SORT_VALUE: Readonly<Record<string, (row: CannKeyword) => string | number>> = {
  keyword: (row) => row.keyword,
  switches: (row) => row.switches.length,
  flipFlops: (row) => row.flip_flops,
  pages: (row) => row.pages.filter((page) => page.best_count > 0).length,
  held: (row) => row.held_now_days,
  longest: (row) => row.longest_hold_days,
};

type Translate = ReturnType<typeof useTranslations<'cannibalization'>>;

/** The Changes table's columns. `keywords` holds each keyword's pages and target, joined by the keyword's id. */
function changeColumns(t: Translate, keywords: ReadonlyMap<string, CannKeyword>): BoardColumn<CannSwitchRow>[] {
  return [
    {
      id: 'keyword',
      header: t('columns.keyword'),
      width: 216,
      sortKey: 'keyword',
      cell: (row) => {
        const known = keywords.get(row.tracked_keyword_id);
        return known === undefined ? (
          <Truncate text={row.keyword} className="text-foreground" />
        ) : (
          <KeywordCell row={known} />
        );
      },
    },
    {
      id: 'when',
      header: t('columns.when'),
      tip: t('tips.when'),
      width: 92,
      sortKey: 'when',
      cellClassName: 'whitespace-nowrap text-foreground-secondary',
      cell: (row) => formatBusinessDate(row.event.date, { withYear: false }),
    },
    {
      id: 'switch',
      header: t('columns.switch'),
      tip: t('tips.switch'),
      width: 300,
      cell: (row) => {
        const pages = keywords.get(row.tracked_keyword_id)?.pages;
        return (
          <span className="flex min-w-0 items-center gap-2">
            <PageChip page={sidePage(row, 'from', pages)} />
            <Icon icon={ChevronRight} size="sm" className="shrink-0 text-foreground-tertiary" />
            <PageChip page={sidePage(row, 'to', pages)} strong />
          </span>
        );
      },
    },
    {
      id: 'rank',
      header: t('columns.rankChange'),
      tip: t('tips.rankChange'),
      width: 128,
      sortKey: 'change',
      cellClassName: 'num',
      cell: (row) => <RankChange row={row} />,
    },
    {
      id: 'held',
      header: t('columns.held'),
      tip: t('tips.held'),
      width: 108,
      sortKey: 'held',
      cellClassName: 'num text-foreground-secondary',
      cell: (row) => t('cells.heldDays', { count: row.event.held_days }),
    },
    {
      id: 'type',
      header: t('columns.type'),
      tip: t('tips.type'),
      width: 116,
      sortKey: 'type',
      cell: (row) =>
        row.event.is_flip_flop ? (
          <Badge tone="warning">{t('cells.flipFlop')}</Badge>
        ) : (
          <Badge>{t('cells.moved')}</Badge>
        ),
    },
    {
      id: 'target',
      header: t('columns.target'),
      tip: t('tips.target'),
      width: null,
      cell: (row) => <TargetCell status={targetStatus(row, keywords.get(row.tracked_keyword_id))} />,
    },
  ];
}

/** What a switch did to the keyword's target page, in words. */
function TargetCell({ status }: { status: TargetStatus }): ReactElement {
  const t = useTranslations('cannibalization.cells');
  switch (status) {
    case 'left':
      return <Badge tone="warning">{t('leftTarget')}</Badge>;
    case 'back':
      return <Badge>{t('backOnTarget')}</Badge>;
    case 'none':
      return <NoValue kind="target" />;
    case 'other':
      return <span className="text-foreground-tertiary">{t('notInvolved')}</span>;
  }
}

function switchKeywordColumns(t: Translate): BoardColumn<CannKeyword>[] {
  return [
    {
      id: 'keyword',
      header: t('columns.keyword'),
      width: 216,
      sortKey: 'keyword',
      cell: (row) => <Truncate text={row.keyword} className="text-foreground" />,
    },
    {
      id: 'now',
      header: t('columns.now'),
      tip: t('tips.now'),
      width: 208,
      cell: (row) => {
        const page = row.pages.find((entry) => entry.url_id === row.current_url_id);
        return page === undefined ? <NoValue kind="page" /> : <PageChip page={page} strong />;
      },
    },
    {
      id: 'switches',
      header: t('columns.switchCount'),
      tip: t('tips.switches'),
      width: 92,
      sortKey: 'switches',
      cellClassName: 'num text-foreground',
      cell: (row) => formatInteger(row.switches.length),
    },
    {
      id: 'flipFlops',
      header: t('columns.flipFlops'),
      width: 100,
      sortKey: 'flipFlops',
      cellClassName: 'num',
      cell: (row) => (
        <span className={cn(row.flip_flops > 0 ? 'text-warning-text' : 'text-foreground-tertiary')}>
          {formatInteger(row.flip_flops)}
        </span>
      ),
    },
    {
      id: 'pages',
      header: t('columns.pageCount'),
      tip: t('tips.pagesCount'),
      width: 84,
      sortKey: 'pages',
      cellClassName: 'num text-foreground',
      cell: (row) => formatInteger(row.pages.filter((page) => page.best_count > 0).length),
    },
    {
      id: 'held',
      header: t('columns.heldNow'),
      tip: t('tips.heldNow'),
      width: 108,
      sortKey: 'held',
      cellClassName: 'num text-foreground-secondary',
      cell: (row) => t('cells.heldDays', { count: row.held_now_days }),
    },
    {
      id: 'longest',
      header: t('columns.longest'),
      tip: t('tips.longest'),
      width: 120,
      sortKey: 'longest',
      cellClassName: 'num text-foreground-secondary',
      cell: (row) => t('cells.heldDays', { count: row.longest_hold_days }),
    },
    {
      id: 'history',
      header: t('columns.history'),
      tip: t('tips.history'),
      width: null,
      cell: (row) => <HistoryStrip row={row} />,
    },
  ];
}

/** The Switching tab (docs/33 section 7.3): the weekly chart above the Changes or By keyword table. */
export function SwitchingView(props: SwitchingViewProps): ReactElement {
  const { state, set, tabs, search, onSearchChange, switches, keywords, onOrderChange, onExportChange } = props;
  const t = useTranslations('cannibalization');
  const byKeyword = state.view === 'keywords';
  const [changeSort, setChangeSort] = useState<BoardSort>(CHANGE_SORT);
  const [keywordSort, setKeywordSort] = useState<BoardSort>(KEYWORD_SORT);

  const switchRows = switches.data?.items;
  const changes = useMemo(() => {
    const filtered = filterSwitches(switchRows ?? [], state);
    const value = CHANGE_SORT_VALUE[changeSort.key];
    return value === undefined
      ? filtered
      : sortRows(
          filtered,
          changeSort.dir,
          value,
          (a, b) => b.event.date.localeCompare(a.event.date) || a.keyword.localeCompare(b.keyword),
        );
  }, [switchRows, state, changeSort]);
  const keywordRows = keywords.data?.items ?? NO_ROWS;
  const ranked = useMemo(() => keywordRows.filter((row) => row.verdict !== 'unranked'), [keywordRows]);
  const byKeywordRows = useMemo(() => {
    const filtered = filterSwitchKeywords(keywordRows, state);
    const value = KEYWORD_SORT_VALUE[keywordSort.key];
    return value === undefined
      ? filtered
      : sortRows(
          filtered,
          keywordSort.dir,
          value,
          (a, b) => (b.volume ?? 0) - (a.volume ?? 0) || a.keyword.localeCompare(b.keyword),
        );
  }, [keywordRows, state, keywordSort]);

  // The inspector's position and J and K follow the rows on screen
  useEffect(() => {
    onOrderChange(
      byKeyword
        ? byKeywordRows.map((row) => row.tracked_keyword_id)
        : [...new Set(changes.map((row) => row.tracked_keyword_id))],
    );
  }, [byKeyword, byKeywordRows, changes, onOrderChange]);

  const keywordsById = useMemo(
    (): ReadonlyMap<string, CannKeyword> => new Map(keywordRows.map((row) => [row.tracked_keyword_id, row])),
    [keywordRows],
  );
  const changeCols = useMemo(() => changeColumns(t, keywordsById), [t, keywordsById]);
  const keywordCols = useMemo(() => switchKeywordColumns(t), [t]);
  const changeWidths = useCannWidths('changes', changeCols);
  const keywordWidths = useCannWidths('switch-keywords', keywordCols);
  const widths = byKeyword ? keywordWidths : changeWidths;
  const keywordTotal = keywords.data?.meta.total;
  const switchTotal = switches.data?.meta.total;
  const cut = useMemo(
    () => (byKeyword ? truncation(keywordRows.length, keywordTotal) : truncation(switchRows?.length ?? 0, switchTotal)),
    [byKeyword, keywordRows.length, keywordTotal, switchRows?.length, switchTotal],
  );

  const exportSpec = useMemo((): ExportSpec | null => {
    const read = byKeyword ? keywords : switches;
    const rowsInView = byKeyword ? byKeywordRows.length : changes.length;
    if (read.status !== 'ready' || rowsInView === 0) return null;
    const dateTo = read.data?.meta.date_to;
    if (byKeyword) {
      return {
        table: 'switch-keywords',
        fileName: exportFileName('switch-keywords', state, dateTo),
        rows: rowsInView,
        truncated: cut,
        build: () =>
          switchKeywordTable(byKeywordRows, {
            header: headerWords(SWITCH_KEYWORD_COLUMNS, (key) => t(`export.switchKeywordColumns.${key}`)),
          }),
      };
    }
    return {
      table: 'changes',
      fileName: exportFileName('changes', state, dateTo),
      rows: rowsInView,
      truncated: cut,
      build: () =>
        changeTable(
          changes.map((row) => ({ row, target: targetStatus(row, keywordsById.get(row.tracked_keyword_id)) })),
          {
            header: headerWords(CHANGE_COLUMNS, (key) => t(`export.changeColumns.${key}`)),
            type: (flipFlop) => t(flipFlop ? 'cells.flipFlop' : 'cells.moved'),
            target: (status) =>
              t(
                status === 'left'
                  ? 'cells.leftTarget'
                  : status === 'back'
                    ? 'cells.backOnTarget'
                    : status === 'none'
                      ? 'unknown.target'
                      : 'cells.notInvolved',
              ),
          },
        ),
    };
  }, [byKeyword, keywords, switches, byKeywordRows, changes, keywordsById, state, cut, t]);
  useExportSpec(exportSpec, onExportChange);

  const counts = useMemo(
    () => (switchRows === undefined ? undefined : switchCounts(switchRows, state.search)),
    [switchRows, state.search],
  );
  const active = byKeyword ? keywords : switches;
  const footer = byKeyword
    ? keywords.data === undefined
      ? null
      : t('switchKeywordTable.footer', { count: byKeywordRows.length, total: formatInteger(ranked.length) })
    : switches.data === undefined
      ? null
      : [
          t('changesTable.footer', { count: changes.length }),
          ...(switches.data.items.length > 0 ? [t('changesTable.footerNote')] : []),
        ].join(' \u00b7 ');

  return (
    <CannPanel
      tabs={tabs}
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('search.keywords')}
      controls={
        <>
          <ViewSwitch tab="switching" view={state.view} onChange={(view) => set({ view })} />
          {byKeyword ? (
            <Checkbox
              checked={state.switchedOnly}
              onCheckedChange={(checked) => set({ switchedOnly: checked })}
              label={t('switched.only')}
            />
          ) : (
            <PressedGroup<SwitchShow>
              label={t('switchShow.label')}
              value={state.sw}
              onValueChange={(sw) => set({ sw })}
              items={SWITCH_SHOWS.map((value) => ({
                value,
                label: t(`switchShow.${value}`),
                count: counts === undefined ? undefined : formatInteger(counts[value]),
              }))}
            />
          )}
        </>
      }
      above={<SwitchChart read={switches} days={state.days} />}
      notice={
        cut === null
          ? null
          : t(byKeyword ? 'keywordTable.truncated' : 'changesTable.truncated', {
              read: formatInteger(cut.read),
              total: formatInteger(cut.total),
            })
      }
      onResetWidths={widths.onResetWidths}
      refetching={active.refetching}
      footerText={footer}
      updated={
        switches.data === undefined
          ? null
          : t('keywordTable.updated', { date: formatBusinessDate(switches.data.meta.date_to, { withYear: false }) })
      }
    >
      {byKeyword ? (
        <ByKeywordTable
          read={keywords}
          columns={keywordCols}
          resize={keywordWidths.resize}
          total={ranked.length}
          rows={byKeywordRows}
          sort={keywordSort}
          onSort={setKeywordSort}
          state={state}
          set={set}
          onSearchChange={onSearchChange}
          activeId={props.activeId}
          onOpen={props.onOpen}
        />
      ) : (
        <ChangesTable
          read={switches}
          columns={changeCols}
          resize={changeWidths.resize}
          total={switchRows?.length ?? 0}
          rows={changes}
          sort={changeSort}
          onSort={setChangeSort}
          state={state}
          set={set}
          onSearchChange={onSearchChange}
          onOpen={props.onOpen}
        />
      )}
    </CannPanel>
  );
}

interface ChangesTableProps {
  read: CannRead<CannSwitchList>;
  columns: readonly BoardColumn<CannSwitchRow>[];
  resize: BoardResize;
  /** Switches before the chip and the search. */
  total: number;
  rows: readonly CannSwitchRow[];
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  state: CannState;
  set: (patch: Partial<CannState>) => void;
  onSearchChange: (search: string) => void;
  onOpen: SwitchingViewProps['onOpen'];
}

function ChangesTable({
  read,
  columns,
  resize,
  total,
  rows,
  sort,
  onSort,
  state,
  set,
  onSearchChange,
  onOpen,
}: ChangesTableProps): ReactElement {
  const t = useTranslations('cannibalization');
  if (read.status === 'loading') return <BoardTableSkeleton columns={columns} flexMin={FLEX_MIN} />;
  if (read.status === 'error') return <ReadError read={read} />;
  if (total === 0) {
    return (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('changesTable.emptyTitle')}
        reason={t('changesTable.emptyReason', { days: state.days })}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('changesTable.noMatchTitle')}
        reason={t('changesTable.noMatchReason')}
        primaryAction={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              set({ sw: 'all' });
              onSearchChange('');
            }}
          >
            {t('changesTable.clearFilters')}
          </Button>
        }
      />
    );
  }
  return (
    <BoardTable<CannSwitchRow>
      caption={t('changesTable.caption')}
      columns={columns}
      rows={rows}
      rowId={switchId}
      rowLabel={(row) => t('keywordTable.rowLabel', { keyword: row.keyword })}
      onOpen={(row, opener) => onOpen(row.tracked_keyword_id, opener, OPEN_TAB)}
      // Several rows can belong to the open keyword: none is marked
      activeId={null}
      sort={sort}
      onSortChange={onSort}
      flexMin={FLEX_MIN}
      busy={read.refetching}
      resize={resize}
    />
  );
}

/** The rank before and after a switch, with an arrow for what the new page did to it. */
function RankChange({ row }: { row: CannSwitchRow }): ReactElement {
  const t = useTranslations('cannibalization.cells');
  const change = row.rank_change;
  return (
    <span className="flex items-center gap-2">
      <span className="text-foreground-secondary">
        {t('rankBefore', { before: formatInteger(row.event.rank_before), after: formatInteger(row.event.rank_after) })}
      </span>
      {change === 0 ? null : (
        <span className={cn('inline-flex shrink-0', change > 0 ? 'text-positive-text' : 'text-negative-text')}>
          <Icon icon={change > 0 ? TrendingUp : TrendingDown} size="sm" />
          <span className="sr-only">{t(change > 0 ? 'improvedBy' : 'droppedBy', { count: Math.abs(change) })}</span>
        </span>
      )}
    </span>
  );
}

interface ByKeywordTableProps {
  read: CannRead<CannConflictList>;
  columns: readonly BoardColumn<CannKeyword>[];
  resize: BoardResize;
  /** Ranked keywords before the chip and the search. */
  total: number;
  rows: readonly CannKeyword[];
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  state: CannState;
  set: (patch: Partial<CannState>) => void;
  onSearchChange: (search: string) => void;
  activeId: string | null;
  onOpen: SwitchingViewProps['onOpen'];
}

function ByKeywordTable({
  read,
  columns,
  resize,
  total,
  rows,
  sort,
  onSort,
  state,
  set,
  onSearchChange,
  activeId,
  onOpen,
}: ByKeywordTableProps): ReactElement {
  const t = useTranslations('cannibalization');
  if (read.status === 'loading') return <BoardTableSkeleton columns={columns} flexMin={FLEX_MIN} />;
  if (read.status === 'error') return <ReadError read={read} />;
  if (total === 0) {
    return (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('switchKeywordTable.notEnoughTitle')}
        reason={t('switchKeywordTable.notEnoughReason')}
      />
    );
  }
  if (rows.length === 0) {
    const searching = state.search !== '';
    return (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={searching ? t('keywordTable.noMatchTitle') : t('switchKeywordTable.emptyTitle')}
        reason={
          searching
            ? t('keywordTable.noMatchSearch', { query: state.search })
            : t('switchKeywordTable.emptyReason', { days: state.days })
        }
        primaryAction={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (searching ? onSearchChange('') : set({ switchedOnly: false }))}
          >
            {searching ? t('keywordTable.clearSearch') : t('switchKeywordTable.showAll')}
          </Button>
        }
      />
    );
  }
  return (
    <BoardTable<CannKeyword>
      caption={t('switchKeywordTable.caption')}
      columns={columns}
      rows={rows}
      rowId={(row) => row.tracked_keyword_id}
      rowLabel={(row) => t('keywordTable.rowLabel', { keyword: row.keyword })}
      onOpen={(row, opener) => onOpen(row.tracked_keyword_id, opener, OPEN_TAB)}
      activeId={activeId}
      sort={sort}
      onSortChange={onSort}
      flexMin={FLEX_MIN}
      busy={read.refetching}
      resize={resize}
    />
  );
}
