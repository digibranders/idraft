import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { col } from './columns';
import { useSortedRows } from './use-sorted-rows';
import type { SortKey } from '@/lib/tables/table-state';

interface Row {
  id: string;
  keyword: string;
  volume: number | null;
}

const ROWS: Row[] = [
  { id: 'a', keyword: 'crm pricing', volume: 880 },
  { id: 'b', keyword: 'Best CRM', volume: null },
  { id: 'c', keyword: 'agency crm', volume: 12_400 },
];
const COLUMNS = [
  col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
  col.volume<Row>('volume', (row) => row.volume, { header: 'Volume' }),
];

function Order({ rows, sort, manual = false }: { rows: Row[]; sort: SortKey[]; manual?: boolean }): ReactElement {
  const sorted = useSortedRows({ rows, columns: COLUMNS, sort, manual, getRowId: (row) => row.id });
  return <output>{sorted.map((row) => row.id).join(',')}</output>;
}

describe('useSortedRows', () => {
  it('sorts numbers both ways with unknown values last, and text ignoring case', () => {
    const { rerender } = render(<Order rows={ROWS} sort={[{ id: 'volume', desc: true }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('c,a,b');
    rerender(<Order rows={ROWS} sort={[{ id: 'volume', desc: false }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('a,c,b');
    rerender(<Order rows={ROWS} sort={[{ id: 'keyword', desc: false }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('c,b,a');
  });

  it('orders rows that tie on the sort by row id, whatever order they were loaded in and whichever way it runs', () => {
    // Thirty keywords with no rank (nulls tie) and a few that share a rank, loaded in no particular order
    const ids = Array.from({ length: 30 }, (_, index) => `row-${String((index * 7) % 30).padStart(2, '0')}`);
    const rows: Row[] = ids.map((id, index) => ({ id, keyword: id, volume: index % 10 === 0 ? 500 : null }));
    const byId = (a: string, b: string): number => (a < b ? -1 : 1);
    const tied = rows.filter((row) => row.volume === null).map((row) => row.id);
    const fixed = rows.filter((row) => row.volume !== null).map((row) => row.id);
    const expected = [...fixed.sort(byId), ...tied.sort(byId)].join(',');
    const { rerender } = render(<Order rows={rows} sort={[{ id: 'volume', desc: true }]} />);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
    // The API breaks ties by id ascending in both directions, so the descending sort does the same
    rerender(<Order rows={rows} sort={[{ id: 'volume', desc: false }]} />);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
    // A different load order gives the same result
    rerender(<Order rows={[...rows].reverse()} sort={[{ id: 'volume', desc: true }]} />);
    expect(screen.getByRole('status')).toHaveTextContent(expected);
  });

  it('keeps the loaded order when there is no sort, and the API order in server mode', () => {
    const loaded: Row[] = [
      { id: 'z', keyword: 'z', volume: null },
      { id: 'a', keyword: 'a', volume: null },
    ];
    const { rerender } = render(<Order rows={loaded} sort={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('z,a');
    rerender(<Order rows={loaded} sort={[{ id: 'volume', desc: true }]} manual />);
    expect(screen.getByRole('status')).toHaveTextContent('z,a');
  });

  it('sorts again only when the rows, the columns or the sort change, not on every render', () => {
    let reads = 0;
    const counted = [
      col.volume<Row>(
        'volume',
        (row) => {
          reads += 1;
          return row.volume;
        },
        { header: 'Volume' },
      ),
    ];
    const sort: SortKey[] = [{ id: 'volume', desc: true }];
    function Counted({ tick }: { tick: number }): ReactElement {
      const sorted = useSortedRows({ rows: ROWS, columns: counted, sort, manual: false, getRowId: (row) => row.id });
      return <output data-tick={tick}>{sorted.map((row) => row.id).join(',')}</output>;
    }
    const { rerender } = render(<Counted tick={0} />);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);
    rerender(<Counted tick={1} />);
    rerender(<Counted tick={2} />);
    expect(reads).toBe(afterFirst);
    expect(screen.getByRole('status')).toHaveTextContent('c,a,b');
  });

  it('follows new rows, keeps the order the API gave in server mode, and ignores unknown sort keys', () => {
    const { rerender } = render(<Order rows={ROWS} sort={[{ id: 'volume', desc: true }]} />);
    rerender(
      <Order rows={[...ROWS, { id: 'd', keyword: 'crm', volume: 99_000 }]} sort={[{ id: 'volume', desc: true }]} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('d,c,a,b');
    rerender(<Order rows={ROWS} sort={[{ id: 'volume', desc: true }]} manual />);
    expect(screen.getByRole('status')).toHaveTextContent('a,b,c');
    rerender(<Order rows={ROWS} sort={[{ id: 'rank', desc: true }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('a,b,c');
  });
});
