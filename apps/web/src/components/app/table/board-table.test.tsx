import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BoardTable, type BoardColumn } from './board-table';
import { TooltipProvider } from '@/components/ui/tooltip';
import { axe } from '@/test/axe';

interface Row {
  id: string;
  name: string;
  count: number;
}
const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', count: 3 },
  { id: 'b', name: 'Beta', count: 9 },
];
const COLUMNS: readonly BoardColumn<Row>[] = [
  { id: 'name', header: 'Page', width: 280, sortKey: 'page', cell: (row) => row.name },
  {
    id: 'count',
    header: 'Citations',
    width: 104,
    sortKey: 'citations',
    tip: 'Answers whose list includes this URL',
    cell: (row) => String(row.count),
    cellClassName: 'num',
  },
  {
    id: 'more',
    header: 'Prompts',
    width: null,
    cell: (row) => (
      <button type="button" data-cell-action="">
        {`More of ${row.name}`}
      </button>
    ),
  },
];

function setup(onSortChange = vi.fn(), onOpen = vi.fn()) {
  const user = userEvent.setup();
  const view = render(
    <TooltipProvider delay={0}>
      <BoardTable<Row>
        caption="Cited pages"
        columns={COLUMNS}
        rows={ROWS}
        rowId={(row) => row.id}
        rowLabel={(row) => `Open ${row.name}`}
        onOpen={onOpen}
        activeId="b"
        sort={{ key: 'citations', dir: 'desc' }}
        onSortChange={onSortChange}
      />
    </TooltipProvider>,
  );
  return { user, onSortChange, onOpen, ...view };
}

describe('BoardTable', () => {
  it('fixes the column widths, one flexible down to 280 px, and sizes the table to their sum', () => {
    const { container } = setup();
    const widths = [...container.querySelectorAll('col')].map((col) => col.style.width);
    expect(widths).toEqual(['280px', '104px', '']);
    expect(container.querySelector('table')?.style.minWidth).toBe('664px');
  });

  it('marks the sorted header and sorts descending first, then ascending (C 341 to 354)', async () => {
    const { user, onSortChange } = setup();
    expect(screen.getByRole('columnheader', { name: /Citations/ })).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getByRole('columnheader', { name: /Page/ })).toHaveAttribute('aria-sort', 'none');
    await user.click(screen.getByRole('button', { name: 'Citations' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'citations', dir: 'asc' });
    await user.click(screen.getByRole('button', { name: 'Page' }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'page', dir: 'desc' });
  });

  it('opens a row from its first cell button or a click, but not from a cell action (C 396 to 408)', async () => {
    const { user, onOpen } = setup();
    await user.click(screen.getByRole('button', { name: 'Open Alpha' }));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], expect.any(HTMLElement));
    await user.click(screen.getByText('9'));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], expect.any(HTMLElement));
    onOpen.mockClear();
    await user.click(screen.getByRole('button', { name: 'More of Beta' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the open row and layers the pinned corner above the other headers (C 334 to 338)', () => {
    setup();
    const rows = screen.getAllByRole('row');
    expect(rows[2]).toHaveAttribute('data-active');
    const [corner, other] = within(rows[0] ?? document.body).getAllByRole('columnheader');
    expect(corner?.className).toContain('z-(--z-sticky)');
    expect(other?.className).toContain('z-(--z-table-header)');
  });

  it('is accessible', async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });
});
