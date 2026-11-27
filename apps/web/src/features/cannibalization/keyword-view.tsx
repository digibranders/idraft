'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { exportFileName, headerWords, keywordTable, KEYWORD_COLUMNS, type ExportSpec } from './cann-export';
import { useExportSpec } from './cann-export-button';
import { CannPanel } from './cann-panel';
import {
  filterKeywords,
  GAP_WARNING,
  KEYWORD_SHOWS,
  pagesColumnWidth,
  SEVERITY,
  shownPages,
  sortRows,
  truncation,
  type CannState,
  type KeywordShow,
} from './cann-model';
import { HistoryStrip, KeywordCell, NoValue, PageChip, VerdictBadge } from './cann-parts';
import type { CannRead } from './cann-reads';
import { PairChip, ReadError, useCannWidths, ViewSwitch } from './cann-view-parts';
import { PagesPopover } from './pages-popover';
import { PressedGroup } from '@/components/app/filters/pressed-group';
import { EmptyState } from '@/components/app/status/empty-state';
import { BoardTable, BoardTableSkeleton, type BoardColumn, type BoardSort } from '@/components/app/table/board-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { CannConflictList, CannKeyword } from '@/lib/api/types';
import { formatBusinessDate, formatInteger, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface KeywordViewProps {
  read: CannRead<CannConflictList>;
  state: CannState;
  set: (patch: Partial<CannState>) => void;
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
  activeId: string | null;
  /** Opens the keyword's evidence; `opener` is where focus returns when it closes. `tab` is the drawer's first tab. */
  onOpen: (row: CannKeyword, opener: HTMLElement | null, tab?: string) => void;
  onOrderChange: (ids: readonly string[]) => void;
  /** Tells the toolbar's Export button which table is in view. */
  onExportChange: (spec: ExportSpec | null) => void;
  /** The Keywords page, for a project with no tracked keywords. */
  keywordsHref: Route;
}

const FLEX_MIN = 132;
/** The inspector's tab that lists the keyword's pages. */
const PAGES_TAB = 'pages';
const DEFAULT_SORT: BoardSort = { key: 'status', dir: 'desc' };
const NO_ROWS: readonly CannKeyword[] = [];

const SORT_VALUE: Readonly<Record<string, (row: CannKeyword) => string | number>> = {
  keyword: (row) => row.keyword,
  status: (row) => SEVERITY[row.verdict] * 1e7 + (row.volume ?? 0),
  rank: (row) => row.current_rank ?? 1000,
  gap: (row) => row.rank_gap,
  switches: (row) => row.switches.length,
  together: (row) => row.together_rate,
  volume: (row) => row.volume ?? 0,
};

const byVolume = (a: CannKeyword, b: CannKeyword): number =>
  (b.volume ?? 0) - (a.volume ?? 0) || a.keyword.localeCompare(b.keyword);

/** By keyword (docs/33 section 7.2): the keywords with the verdict, the pages, the figures and the history strip. */
export function KeywordView(props: KeywordViewProps): ReactElement {
  const t = useTranslations('cannibalization');
  const { read, state, set, onOrderChange, onOpen, onExportChange } = props;
  const [sort, setSort] = useState<BoardSort>(DEFAULT_SORT);
  const list = read.data;
  const rows = list?.items ?? NO_ROWS;
  const visible = useMemo(() => {
    const filtered = filterKeywords(rows, state);
    const value = SORT_VALUE[sort.key] ?? SORT_VALUE.status;
    return value === undefined ? filtered : sortRows(filtered, sort.dir, value, byVolume);
  }, [rows, state, sort]);
  useEffect(() => {
    onOrderChange(visible.map((row) => row.tracked_keyword_id));
  }, [visible, onOrderChange]);

  const pagesWidth = useMemo(() => pagesColumnWidth(rows), [rows]);
  const columns = useMemo(
    (): BoardColumn<CannKeyword>[] => [
      {
        id: 'keyword',
        header: t('columns.keyword'),
        width: 176,
        sortKey: 'keyword',
        cell: (row) => <KeywordCell row={row} />,
      },
      {
        id: 'status',
        header: t('columns.status'),
        tip: t('tips.status'),
        width: 100,
        sortKey: 'status',
        cell: (row) => <VerdictBadge verdict={row.verdict} />,
      },
      {
        id: 'pages',
        header: t('columns.pages'),
        tip: t('tips.pages'),
        width: pagesWidth,
        cell: (row) => <PagesCell row={row} days={state.days} onOpen={onOpen} />,
      },
      {
        id: 'rank',
        header: t('columns.rank'),
        tip: t('tips.rank'),
        width: 64,
        sortKey: 'rank',
        cellClassName: 'num text-foreground',
        cell: (row) => (row.current_rank === null ? <NoValue kind="rank" /> : formatInteger(row.current_rank)),
      },
      {
        id: 'gap',
        header: t('columns.gap'),
        tip: t('tips.gap'),
        width: 84,
        sortKey: 'gap',
        cellClassName: 'num',
        cell: (row) => <GapCell gap={row.rank_gap} />,
      },
      {
        id: 'switches',
        header: t('columns.switches'),
        tip: t('tips.switches'),
        width: 92,
        sortKey: 'switches',
        cellClassName: 'num text-foreground',
        cell: (row) => formatInteger(row.switches.length),
      },
      {
        id: 'together',
        header: t('columns.together'),
        tip: t('tips.together'),
        width: 104,
        sortKey: 'together',
        cellClassName: 'num',
        cell: (row) =>
          row.together_rate > 0 ? (
            <span className="text-foreground">{formatPercent(row.together_rate, { decimals: 0 })}</span>
          ) : (
            <span className="text-foreground-tertiary">{formatPercent(0, { decimals: 0 })}</span>
          ),
      },
      {
        id: 'volume',
        header: t('columns.volume'),
        tip: t('tips.volume'),
        width: 76,
        sortKey: 'volume',
        cellClassName: 'num text-foreground-secondary',
        cell: (row) => (row.volume === null ? <NoValue kind="volume" /> : formatInteger(row.volume)),
      },
      {
        id: 'history',
        header: t('columns.history'),
        tip: t('tips.history'),
        width: null,
        cell: (row) => <HistoryStrip row={row} />,
      },
    ],
    [t, pagesWidth, state.days, onOpen],
  );

  const { resize, onResetWidths } = useCannWidths('keywords', columns);
  const total = list?.meta.total;
  const cut = useMemo(() => truncation(rows.length, total), [rows.length, total]);
  const exportSpec = useMemo((): ExportSpec | null => {
    if (read.status !== 'ready' || visible.length === 0) return null;
    return {
      table: 'keywords',
      fileName: exportFileName('keywords', state, list?.meta.date_to),
      rows: visible.length,
      truncated: cut,
      build: () =>
        keywordTable(visible, {
          header: headerWords(KEYWORD_COLUMNS, (key) => t(`export.keywordColumns.${key}`)),
          status: (verdict) => t(`verdict.${verdict}.label`),
        }),
    };
  }, [read.status, visible, state, list?.meta.date_to, cut, t]);
  useExportSpec(exportSpec, onExportChange);

  const counts = list?.counts;
  const chipCount = (show: KeywordShow): string | undefined =>
    counts === undefined ? undefined : formatInteger(show === 'all' ? counts.all - counts.unranked : counts[show]);
  const controls = (
    <>
      <ViewSwitch tab="cannibalization" view={state.view} onChange={(view) => set({ view, pair: '' })} />
      <PressedGroup<KeywordShow>
        label={t('show.label')}
        value={state.show}
        onValueChange={(show) => set({ show })}
        items={KEYWORD_SHOWS.map((value) => ({ value, label: t(`show.${value}`), count: chipCount(value) }))}
      />
    </>
  );

  const pairIds = state.pair === '' ? [] : state.pair.split('|');
  const pairLabel = pairIds.map(
    (id) => rows.flatMap((row) => row.pages).find((page) => page.url_id === id)?.path ?? id,
  );
  const searching = state.search !== '';
  let body: ReactNode;
  if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} flexMin={FLEX_MIN} />;
  } else if (read.status === 'error') {
    body = <ReadError read={read} />;
  } else if ((counts?.all ?? 0) === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('states.noKeywordsTitle')}
        reason={t('states.noKeywordsReason')}
        primaryAction={
          <LinkButton render={<Link href={props.keywordsHref} />} size="sm">
            {t('states.addKeywords')}
          </LinkButton>
        }
      />
    );
  } else if (visible.length === 0) {
    const plain = !searching && state.pair === '' && state.show !== 'all';
    body = plain ? (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('keywordTable.emptyTitle')}
        reason={t('keywordTable.emptyReason', { days: state.days })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => set({ show: 'all' })}>
            {t('keywordTable.showAll')}
          </Button>
        }
      />
    ) : (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('keywordTable.noMatchTitle')}
        reason={
          state.pair === '' ? t('keywordTable.noMatchSearch', { query: state.search }) : t('keywordTable.noMatchPair')
        }
        primaryAction={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (state.pair === '' ? props.onSearchChange('') : set({ pair: '' }))}
          >
            {state.pair === '' ? t('keywordTable.clearSearch') : t('keywordTable.clearPair')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CannKeyword>
        caption={t('keywordTable.caption')}
        columns={columns}
        rows={visible}
        rowId={(row) => row.tracked_keyword_id}
        rowLabel={(row) => t('keywordTable.rowLabel', { keyword: row.keyword })}
        onOpen={(row, opener) => onOpen(row, opener)}
        activeId={props.activeId}
        sort={sort}
        onSortChange={setSort}
        flexMin={FLEX_MIN}
        busy={read.refetching}
        resize={resize}
      />
    );
  }

  const early = counts?.insufficient ?? 0;
  const footer =
    list === undefined
      ? null
      : [
          t('keywordTable.footer', { count: visible.length }),
          ...(early > 0 ? [t('keywordTable.early', { count: early })] : []),
        ].join(' · ');
  return (
    <CannPanel
      tabs={props.tabs}
      search={props.search}
      onSearchChange={props.onSearchChange}
      searchPlaceholder={t('search.keywords')}
      controls={controls}
      summary={
        <PairChip
          pair={state.pair}
          onClear={() => set({ pair: '' })}
          label={t('pairFilter.text', { a: pairLabel[0] ?? '', b: pairLabel[1] ?? '' })}
        />
      }
      notice={
        cut === null
          ? null
          : t('keywordTable.truncated', { read: formatInteger(cut.read), total: formatInteger(cut.total) })
      }
      onResetWidths={onResetWidths}
      refetching={read.refetching}
      footerText={footer}
      updated={
        list === undefined
          ? null
          : t('keywordTable.updated', { date: formatBusinessDate(list.meta.date_to, { withYear: false }) })
      }
    >
      {body}
    </CannPanel>
  );
}

function GapCell({ gap }: { gap: number }): ReactElement {
  const t = useTranslations('cannibalization.cells');
  if (gap <= 0) return <span className="text-foreground-tertiary">{formatInteger(0)}</span>;
  const places = Math.round(gap);
  return (
    <Tooltip content={t('gapTip', { count: places })} purpose="label">
      <span className={cn(gap >= GAP_WARNING ? 'text-warning-text' : 'text-foreground-tertiary')}>
        {t('gapValue', { count: formatInteger(places) })}
      </span>
    </Tooltip>
  );
}

function PagesCell({
  row,
  days,
  onOpen,
}: {
  row: CannKeyword;
  days: number;
  onOpen: KeywordViewProps['onOpen'];
}): ReactElement {
  const t = useTranslations('cannibalization.cells');
  // A keyword whose pages all have fewer ranked checks than the table counts still lists them
  const counted = shownPages(row);
  const shown = counted.length > 0 ? counted : row.pages;
  const [first, second] = shown;
  if (first === undefined) return <NoValue kind="page" />;
  return (
    <PagesPopover
      row={row}
      days={days}
      triggerLabel={t('pagesLabel', {
        keyword: row.keyword,
        pages: shown.map((page) => t('pageLabel', { letter: page.letter, path: page.path })).join('; '),
      })}
      onDetails={() => onOpen(row, null, PAGES_TAB)}
      summary={
        <span className="flex min-w-0 items-center gap-3">
          <PageChip page={first} strong />
          {second === undefined ? null : <PageChip page={second} />}
          {shown.length > 2 ? <Badge>{t('more', { count: shown.length - 2 })}</Badge> : null}
        </span>
      }
    />
  );
}
