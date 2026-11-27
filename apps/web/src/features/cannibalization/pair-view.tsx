'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { CannPanel } from './cann-panel';
import { pairMatches, sortRows, type CannState } from './cann-model';
import { PageChip, PageMark } from './cann-parts';
import type { CannRead } from './cann-reads';
import { ReadError, ViewSwitch } from './cann-view-parts';
import { EmptyState } from '@/components/app/status/empty-state';
import { BoardTable, BoardTableSkeleton, type BoardColumn, type BoardSort } from '@/components/app/table/board-table';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { CannPair, CannPairList } from '@/lib/api/types';
import { EMPTY_VALUE, formatBusinessDate, formatInteger, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PairViewProps {
  read: CannRead<CannPairList>;
  state: CannState;
  set: (patch: Partial<CannState>) => void;
  tabs: ReactNode;
  search: string;
  onSearchChange: (search: string) => void;
}

const FLEX_MIN = 200;
const DEFAULT_SORT: BoardSort = { key: 'volume', dir: 'desc' };
const NO_ROWS: readonly CannPair[] = [];
export const pairId = (pair: CannPair): string => `${pair.a.url_id}|${pair.b.url_id}`;

const SORT_VALUE: Readonly<Record<string, (pair: CannPair) => string | number>> = {
  pages: (pair) => pair.a.path,
  keywords: (pair) => pair.keywords,
  volume: (pair) => pair.volume,
  likely: (pair) => pair.likely,
  overlap: (pair) => pair.title_overlap ?? -1,
};

const byVolume = (a: CannPair, b: CannPair): number => b.volume - a.volume || pairId(a).localeCompare(pairId(b));

/** By page pair (docs/33 section 7.2): the pairs of your pages that compete, to fix at page level. */
export function PairView({ read, state, set, tabs, search, onSearchChange }: PairViewProps): ReactElement {
  const t = useTranslations('cannibalization');
  const [sort, setSort] = useState<BoardSort>(DEFAULT_SORT);
  const list = read.data;
  const all = list?.items ?? NO_ROWS;
  const visible = useMemo(() => {
    const matching = all.filter((pair) => pairMatches(pair, state.search));
    const value = SORT_VALUE[sort.key];
    return value === undefined ? matching : sortRows(matching, sort.dir, value, byVolume);
  }, [all, state.search, sort]);

  const columns = useMemo(
    (): BoardColumn<CannPair>[] => [
      {
        id: 'pages',
        header: t('columns.pair'),
        width: 300,
        sortKey: 'pages',
        cell: (pair) => (
          <span className="flex min-w-0 flex-col gap-0.5 py-1">
            <PageChip page={{ ...pair.a, letter: 'A' }} strong />
            <PageChip page={{ ...pair.b, letter: 'B' }} />
          </span>
        ),
      },
      {
        id: 'keywords',
        header: t('columns.pairKeywords'),
        tip: t('tips.pairKeywords'),
        width: 100,
        sortKey: 'keywords',
        cellClassName: 'num text-foreground',
        cell: (pair) => formatInteger(pair.keywords),
      },
      {
        id: 'volume',
        header: t('columns.pairVolume'),
        tip: t('tips.pairVolume'),
        width: 100,
        sortKey: 'volume',
        cellClassName: 'num text-foreground-secondary',
        cell: (pair) => formatInteger(pair.volume),
      },
      {
        id: 'likely',
        header: t('columns.pairLikely'),
        tip: t('tips.pairLikely'),
        width: 88,
        sortKey: 'likely',
        cellClassName: 'num',
        cell: (pair) => (
          <span className={cn(pair.likely > 0 ? 'text-warning-text' : 'text-foreground-tertiary')}>
            {formatInteger(pair.likely)}
          </span>
        ),
      },
      {
        id: 'lead',
        header: t('columns.lead'),
        tip: t('tips.lead'),
        width: null,
        cell: (pair) => <LeadCell pair={pair} />,
      },
      {
        id: 'overlap',
        header: t('columns.overlap'),
        tip: t('tips.overlap'),
        width: 116,
        sortKey: 'overlap',
        cellClassName: 'num text-foreground-secondary',
        cell: (pair) =>
          pair.title_overlap === null ? EMPTY_VALUE : formatPercent(pair.title_overlap, { decimals: 0 }),
      },
    ],
    [t],
  );

  let body: ReactNode;
  if (read.status === 'loading') {
    body = <BoardTableSkeleton columns={columns} flexMin={FLEX_MIN} />;
  } else if (read.status === 'error') {
    body = <ReadError read={read} />;
  } else if (all.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pairTable.emptyTitle')}
        reason={t('pairTable.emptyReason')}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        variant="table"
        headingLevel={2}
        title={t('pairTable.noMatchTitle')}
        reason={t('pairTable.noMatchReason', { query: state.search })}
        primaryAction={
          <Button variant="secondary" size="sm" onClick={() => onSearchChange('')}>
            {t('keywordTable.clearSearch')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <BoardTable<CannPair>
        caption={t('pairTable.caption')}
        columns={columns}
        rows={visible}
        rowId={pairId}
        rowLabel={(pair) => t('pairTable.rowLabel', { a: pair.a.path, b: pair.b.path })}
        // A pair opens the By keyword table narrowed to the keywords where both pages rank
        onOpen={(pair) => set({ view: 'keywords', show: 'all', pair: pairId(pair) })}
        activeId={null}
        sort={sort}
        onSortChange={setSort}
        flexMin={FLEX_MIN}
        busy={read.refetching}
      />
    );
  }

  return (
    <CannPanel
      tabs={tabs}
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder={t('search.pages')}
      controls={<ViewSwitch tab="cannibalization" view={state.view} onChange={(view) => set({ view, pair: '' })} />}
      summary={<p className="type-meta md:whitespace-nowrap">{t('pairTable.hint')}</p>}
      refetching={read.refetching}
      footerText={list === undefined ? null : t('pairTable.footer', { count: visible.length })}
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

/** Which page of the pair ranks better, on how many of the keywords: two segments and the counts under them. */
function LeadCell({ pair }: { pair: CannPair }): ReactElement {
  const t = useTranslations('cannibalization.cells');
  const total = pair.a_leads + pair.b_leads;
  const share = total === 0 ? 0.5 : pair.a_leads / total;
  const tip = t('leadsTip', {
    a: pair.a.path,
    b: pair.b.path,
    aCount: pair.a_leads,
    bCount: pair.b_leads,
  });
  return (
    <Tooltip content={tip} purpose="label">
      <span className="block min-w-0">
        <span className="flex h-2 w-full overflow-hidden rounded-full bg-surface-subtle">
          <span className="h-full bg-chart-1" style={{ width: `${String(share * 100)}%` }} />
          <span className="h-full flex-1 bg-chart-2" />
        </span>
        <span className="mt-1 flex num type-meta">
          <span className="inline-flex items-center gap-1">
            <PageMark letter="A" />
            {formatInteger(pair.a_leads)}
            <span className="sr-only">{t('leadSide', { letter: 'A' })}</span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <PageMark letter="B" />
            {formatInteger(pair.b_leads)}
            <span className="sr-only">{t('leadSide', { letter: 'B' })}</span>
          </span>
        </span>
      </span>
    </Tooltip>
  );
}
