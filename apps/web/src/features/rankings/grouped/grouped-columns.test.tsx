import { renderHook, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import { groupedRows, type GroupedRow } from './grouped-rows';
import { useGroupedColumns } from './grouped-columns';
import { pairRows, type PairedRow } from '../keyword-pairs';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { formatTableDateTime } from '@/lib/format';
import { renderWithProviders } from '@/test/render';

interface Options {
  groups?: readonly string[];
  rank?: number | null;
  volume?: number | null;
  cpc?: string | null;
  aio?: 'present_cited' | 'absent';
  seen?: string | null;
}

/** The fields of a row the columns and the model read; the one place the fixture is taken for the API's row. */
const tracked = (id: string, keyword: string, over: Options = {}): TrackedKeywordRow =>
  ({
    tracked_keyword_id: id,
    keyword: { keyword_id: `k-${keyword}`, text: keyword },
    device: 'desktop',
    location_id: 2356,
    language_code: 'en',
    search_engine: 'google',
    groups: (over.groups ?? []).map((group) => ({ group_id: group, name: group, path: `Path / ${group}` })),
    metrics: { search_volume: { value: over.volume ?? null }, cpc_usd: over.cpc ?? null },
    state: {
      current:
        over.rank === undefined || over.rank === null
          ? { state: 'not_checked', rank: null }
          : { state: 'ranked', rank: over.rank },
      aio: { state: over.aio ?? 'absent' },
      last_observed_at: over.seen ?? null,
    },
  }) as unknown as TrackedKeywordRow;

/** Stand-ins for the real keyword columns, with the ids and the types the real ones have. */
const KEYWORD_COLUMNS: readonly DataTableColumn<PairedRow>[] = [
  {
    ...col.keyword<PairedRow>('keyword', (row) => row.keyword.text, { header: 'Keyword' }),
    cellLabel: (row) => `Keyword ${row.keyword.text}`,
    cellTip: (row) => ({ content: `tip ${row.keyword.text}` }),
  },
  { ...col.text<PairedRow>('country', () => 'Germany', { header: 'Country' }), cellLabel: () => 'Country Germany' },
  col.rank<PairedRow>('current_rank', (row) => (row.state.current.state === 'ranked' ? row.state.current.rank : null), {
    header: 'Rank',
    cell: (row) => <span>rank {String(row.state.current.state === 'ranked' ? row.state.current.rank : null)}</span>,
  }),
  {
    ...col.volume<PairedRow>('search_volume', (row) => row.metrics?.search_volume.value ?? null, { header: 'Volume' }),
    cellLabel: (row) => `Volume of ${row.keyword.text}`,
  },
  col.count<PairedRow>('keyword_difficulty', () => 42, { header: 'KD' }),
  col.currency<PairedRow>('cpc_usd', () => 1, { header: 'CPC (USD)' }),
  col.aiOverview<PairedRow>('aio', () => null, { header: 'AI Overview', cell: () => <span>row aio</span> }),
  col.date<PairedRow>('last_observed_at', (row) => row.state.last_observed_at, { header: 'Updated', timeZone: 'UTC' }),
  col.date<PairedRow>('created_at', () => '2026-10-01T00:00:00Z', { header: 'Added', timeZone: 'UTC' }),
];

const rowsOf = (
  rows: readonly TrackedKeywordRow[],
  over: { expanded?: string[]; showAll?: string[] } = {},
): GroupedRow[] =>
  groupedRows({
    rows: pairRows(rows, 'desktop'),
    notGroupedLabel: 'Not grouped',
    expanded: new Set(over.expanded ?? []),
    showAll: new Set(over.showAll ?? []),
  });

const CRM = [
  tracked('t1', 'crm pricing', {
    groups: ['crm'],
    rank: 2,
    volume: 1000,
    cpc: '2.00',
    aio: 'present_cited',
    seen: '2026-10-29T10:00:00Z',
  }),
  tracked('t2', 'crm demo', { groups: ['crm'], rank: 14, volume: 200, cpc: '4.00', seen: '2026-10-30T08:00:00Z' }),
];

function intl({ children }: { children: ReactNode }): ReactElement {
  return (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

const columnsOf = (onShowAll = vi.fn()): readonly DataTableColumn<GroupedRow>[] =>
  renderHook(() => useGroupedColumns(KEYWORD_COLUMNS, { timeZone: 'UTC', onShowAll }), { wrapper: intl }).result
    .current;

function columnById(id: string, columns = columnsOf()): DataTableColumn<GroupedRow> {
  const found = columns.find((column) => column.id === id);
  if (found === undefined) throw new Error(`No column ${id}`);
  return found;
}

function renderCell(id: string, row: GroupedRow, onShowAll = vi.fn()): ReturnType<typeof renderWithProviders> {
  function Cell(): ReactElement {
    const columns = useGroupedColumns(KEYWORD_COLUMNS, { timeZone: 'UTC', onShowAll });
    return <div data-testid="cell">{columnById(id, columns).cell(row)}</div>;
  }
  return renderWithProviders(<Cell />);
}

const groupRow = (): GroupedRow => {
  const row = rowsOf(CRM)[0];
  if (row?.kind !== 'group') throw new Error('Expected a group row');
  return row;
};
const keywordRow = (): GroupedRow => {
  const row = rowsOf(CRM, { expanded: ['crm'] })[1];
  if (row?.kind !== 'keyword') throw new Error('Expected a keyword row');
  return row;
};
const moreRow = (): GroupedRow => {
  const many = Array.from({ length: 11 }, (_, index) =>
    tracked(`m${String(index)}`, `kw ${String(index)}`, { groups: ['crm'] }),
  );
  const row = rowsOf(many, { expanded: ['crm'] }).at(-1);
  if (row?.kind !== 'more') throw new Error('Expected a more row');
  return row;
};

describe('useGroupedColumns', () => {
  it('keeps the columns, their order and their headers', () => {
    expect(columnsOf().map((column) => [column.id, column.header])).toEqual(
      KEYWORD_COLUMNS.map((column) => [column.id, column.header]),
    );
    expect(columnById('keyword').identity).toBe(true);
  });

  it('sizes each column as the All keywords view does: same type, width, minimum and priority', () => {
    const sizing = (column: DataTableColumn<GroupedRow> | DataTableColumn<PairedRow>) => [
      column.id,
      column.type,
      column.width,
      column.minWidth,
      column.priority,
      column.defaultVisible,
    ];
    expect(columnsOf().map(sizing)).toEqual(KEYWORD_COLUMNS.map(sizing));
  });

  it('sorts by none of them: the table is in group order', () => {
    expect(columnsOf().every((column) => column.sortValue === undefined)).toBe(true);
  });

  describe('a keyword row', () => {
    it('shows the keyword column’s own cell, name and tooltip', () => {
      const row = keywordRow();
      const rank = renderCell('current_rank', row);
      expect(screen.getByTestId('cell')).toHaveTextContent('rank 2');
      rank.unmount();
      renderCell('aio', row);
      expect(screen.getByTestId('cell')).toHaveTextContent('row aio');
      expect(columnById('keyword').cellLabel?.(row)).toBe('Keyword crm pricing');
      expect(columnById('keyword').cellTip?.(row)).toEqual({ content: 'tip crm pricing' });
    });
  });

  describe('the name of a cell that has one', () => {
    it('is the keyword column’s on a keyword row, the figure on a group row, and none where the cell is empty', () => {
      const volume = columnById('search_volume');
      expect(volume.cellLabel?.(keywordRow())).toBe('Volume of crm pricing');
      expect(volume.cellLabel?.(groupRow())).toBe('1,200');
      expect(volume.cellLabel?.(moreRow())).toBe('');
      const country = columnById('country');
      expect(country.cellLabel?.(keywordRow())).toBe('Country Germany');
      expect(country.cellLabel?.(groupRow())).toBe('');
    });

    it('is not set on a column that has none', () => {
      expect(columnById('current_rank').cellLabel).toBeUndefined();
    });
  });

  describe('a group row', () => {
    it('names the group and counts its keywords, with no disclosure button of its own', () => {
      renderCell('keyword', groupRow());
      const cell = screen.getByTestId('cell');
      expect(cell).toHaveTextContent('Path / crm');
      expect(cell).toHaveTextContent('2 keywords');
      expect(within(cell).queryByRole('button')).toBeNull();
      expect(columnById('keyword').cellLabel?.(groupRow())).toBe('Path / crm, 2 keywords');
      expect(columnById('keyword').cellTip?.(groupRow())).toBeUndefined();
    });

    it('counts one keyword in the singular', () => {
      const [only] = CRM;
      if (only === undefined) throw new Error('No fixture');
      const row = rowsOf([only])[0];
      if (row === undefined) throw new Error('No row');
      renderCell('keyword', row);
      expect(screen.getByTestId('cell')).toHaveTextContent('1 keyword');
      expect(screen.getByTestId('cell')).not.toHaveTextContent('1 keywords');
    });

    it('says how many keywords are in the top 10, muted at zero', () => {
      const shown = renderCell('current_rank', groupRow());
      expect(screen.getByTestId('cell')).toHaveTextContent('1 in top 10');
      expect(screen.getByText('1 in top 10')).not.toHaveClass('text-foreground-tertiary');
      shown.unmount();
      const none = rowsOf([tracked('t9', 'unranked', { groups: ['crm'] })])[0];
      if (none === undefined) throw new Error('No row');
      renderCell('current_rank', none);
      expect(screen.getByText('0 in top 10')).toHaveClass('text-foreground-tertiary');
    });

    it('sums the volume with the column’s own formatting', () => {
      renderCell('search_volume', groupRow());
      expect(screen.getByTestId('cell')).toHaveTextContent('1,200');
    });

    it('shows the mean CPC as money, and Unknown when no keyword has one', () => {
      const shown = renderCell('cpc_usd', groupRow());
      expect(screen.getByTestId('cell')).toHaveTextContent('$3.00');
      shown.unmount();
      const none = rowsOf([tracked('t9', 'free', { groups: ['crm'] })])[0];
      if (none === undefined) throw new Error('No row');
      renderCell('cpc_usd', none);
      expect(screen.getByTestId('cell')).toHaveTextContent('Unknown');
    });

    it('counts the keywords the site is cited for in the AI Overview', () => {
      renderCell('aio', groupRow());
      expect(screen.getByTestId('cell')).toHaveTextContent('1 cited');
    });

    it('shows the newest check time, and n/a when none was checked', () => {
      const shown = renderCell('last_observed_at', groupRow());
      expect(screen.getByTestId('cell')).toHaveTextContent(formatTableDateTime('2026-10-30T08:00:00Z', 'UTC'));
      shown.unmount();
      const none = rowsOf([tracked('t9', 'never', { groups: ['crm'] })])[0];
      if (none === undefined) throw new Error('No row');
      renderCell('last_observed_at', none);
      expect(screen.getByTestId('cell')).toHaveTextContent('n/a');
    });

    it('leaves every other column empty, the Country column too', () => {
      for (const id of ['country', 'keyword_difficulty', 'created_at']) {
        const shown = renderCell(id, groupRow());
        expect(screen.getByTestId('cell')).toBeEmptyDOMElement();
        shown.unmount();
      }
    });
  });

  describe('a Show all row', () => {
    it('is a button that asks to show the group’s keywords', async () => {
      const onShowAll = vi.fn();
      const { user } = renderCell('keyword', moreRow(), onShowAll);
      await user.click(screen.getByRole('button', { name: 'Show 3 more' }));
      expect(onShowAll).toHaveBeenCalledWith('crm');
      expect(columnById('keyword').cellLabel?.(moreRow())).toBe('Show 3 more');
    });

    it('leaves the other columns empty', () => {
      for (const id of ['current_rank', 'search_volume', 'last_observed_at']) {
        const shown = renderCell(id, moreRow());
        expect(screen.getByTestId('cell')).toBeEmptyDOMElement();
        shown.unmount();
      }
    });
  });
});
