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
