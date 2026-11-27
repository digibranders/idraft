import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardTable, BoardTableSkeleton, type BoardColumn } from './board-table';
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
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0], screen.getByRole('button', { name: 'Open Alpha' }));
    // A click on the row hands over the row's button, which is focusable: focus returns there when the drawer closes
    await user.click(screen.getByText('9'));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[1], screen.getByRole('button', { name: 'Open Beta' }));
    onOpen.mockClear();
    await user.click(screen.getByRole('button', { name: 'More of Beta' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('ignores a click inside a portaled child of a row, which React bubbles to the row', async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const columns: readonly BoardColumn<Row>[] = [
      ...COLUMNS.slice(0, 2),
      {
        id: 'popover',
        header: 'Popover',
        width: null,
        cell: (row) => createPortal(<p>{`Popover of ${row.name}`}</p>, document.body),
      },
    ];
    render(
      <TooltipProvider delay={0}>
        <BoardTable<Row>
          caption="Cited pages"
          columns={columns}
          rows={ROWS}
          rowId={(row) => row.id}
          rowLabel={(row) => `Open ${row.name}`}
          onOpen={onOpen}
          activeId={null}
          sort={{ key: 'citations', dir: 'desc' }}
          onSortChange={vi.fn()}
        />
      </TooltipProvider>,
    );
    await user.click(screen.getByText('Popover of Alpha'));
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(screen.getByText('3'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('scrolls back to the first row when the sort changes', () => {
    const table = (dir: 'asc' | 'desc'): ReactElement => (
      <TooltipProvider delay={0}>
        <BoardTable<Row>
          caption="Cited pages"
          columns={COLUMNS}
          rows={ROWS}
          rowId={(row) => row.id}
          rowLabel={(row) => `Open ${row.name}`}
          onOpen={vi.fn()}
          activeId={null}
          sort={{ key: 'citations', dir }}
          onSortChange={vi.fn()}
        />
      </TooltipProvider>
    );
    const { container, rerender } = render(table('desc'));
    const scroller = container.firstElementChild as HTMLElement;
    scroller.scrollTop = 120;
    rerender(table('desc'));
    expect(scroller.scrollTop).toBe(120);
    rerender(table('asc'));
    expect(scroller.scrollTop).toBe(0);
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

  it('stretches a header tip over the whole cell and leaves headers without one alone', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Citations' })).toHaveClass('after:absolute', 'after:inset-0');
    expect(screen.getByRole('button', { name: 'Page' })).not.toHaveClass('after:absolute');
    const cell = screen.getByRole('columnheader', { name: /Citations/ });
    expect(cell).toHaveClass('sticky');
    expect(cell).not.toHaveClass('relative');
  });
});

/** An IntersectionObserver the test drives by hand. */
class StubObserver {
  static all: StubObserver[] = [];
  disconnected = false;
  constructor(private readonly callback: IntersectionObserverCallback) {
    StubObserver.all.push(this);
  }
  observe(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  /** What a real observer does on observe: it reports the sentinel's state once. */
  report(isIntersecting: boolean): void {
    act(() => {
      this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    });
  }
}

describe('BoardTableSkeleton', () => {
  it('draws the real headers over eight rows of pulsing bars, hidden from assistive technology', () => {
    const { container } = render(<BoardTableSkeleton columns={[{ id: 'a', header: 'Page', width: 280 }]} />);
    expect(container.querySelectorAll('th')).toHaveLength(1);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(8);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('BoardTable paging', () => {
  beforeEach(() => {
    StubObserver.all = [];
    vi.stubGlobal('IntersectionObserver', StubObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function paged(rows: readonly Row[], onEndReached: () => void): ReactElement {
    return (
      <TooltipProvider delay={0}>
        <BoardTable<Row>
          caption="Cited pages"
          columns={COLUMNS}
          rows={rows}
          rowId={(row) => row.id}
          rowLabel={(row) => `Open ${row.name}`}
          onOpen={vi.fn()}
          activeId={null}
          sort={{ key: 'citations', dir: 'desc' }}
          onSortChange={vi.fn()}
          onEndReached={onEndReached}
        />
      </TooltipProvider>
    );
  }

  it('asks for the next page when the sentinel is in view, and again after the rows change (D-6)', () => {
    const onEndReached = vi.fn();
    const { rerender } = render(paged(ROWS, onEndReached));
    const first = StubObserver.all.at(-1);
    first?.report(false);
    expect(onEndReached).not.toHaveBeenCalled();
    first?.report(true);
    expect(onEndReached).toHaveBeenCalledTimes(1);

    // The page that loaded did not push the sentinel out of view, so only a fresh observation can ask again
    rerender(paged([...ROWS, { id: 'c', name: 'Gamma', count: 1 }], onEndReached));
    expect(first?.disconnected).toBe(true);
    const second = StubObserver.all.at(-1);
    expect(second).not.toBe(first);
    second?.report(true);
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });
});

describe('BoardTable resizing', () => {
  function setupResize(resizeOn = true) {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <BoardTable<Row>
          caption="Cited pages"
          columns={COLUMNS}
          rows={ROWS}
          rowId={(row) => row.id}
          rowLabel={(row) => `Open ${row.name}`}
          onOpen={vi.fn()}
          activeId={null}
          sort={{ key: 'citations', dir: 'desc' }}
          onSortChange={vi.fn()}
          resize={
            resizeOn
              ? {
                  widths: { count: 140 },
                  onChange,
                  label: (header) => `Resize the ${header} column`,
                  valueText: (width) => `${String(width)} pixels wide`,
                }
              : undefined
          }
        />
      </TooltipProvider>,
    );
    return { onChange, user };
  }

  it('has no separators unless the table opts in', () => {
    setupResize(false);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('gives each column with a width a separator that has a value, and none to the flexible column', () => {
    setupResize();
    const separators = screen.getAllByRole('separator');
    expect(separators).toHaveLength(2);
    const count = screen.getByRole('separator', { name: 'Resize the Citations column' });
    expect(count).toHaveAttribute('aria-valuenow', '140');
    expect(count).toHaveAttribute('aria-valuemin', '62');
    expect(count).toHaveAttribute('aria-valuemax', '360');
    expect(count).toHaveAttribute('aria-valuetext', '140 pixels wide');
    expect(screen.queryByRole('separator', { name: 'Resize the Prompts column' })).toBeNull();
  });

  it('sets the col width from the saved width', () => {
    setupResize();
    const cols = document.querySelectorAll('col');
    expect(cols[0]).toHaveStyle({ width: '280px' });
    expect(cols[1]).toHaveStyle({ width: '140px' });
  });

  it('moves with the arrow keys, 48 px with Shift, and Home, End and Enter', async () => {
    const { onChange, user } = setupResize();
    screen.getByRole('separator', { name: 'Resize the Citations column' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('count', 156);
    await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith('count', 92);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('count', 62);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('count', 360);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('count', null);
  });

  it('goes back to the default on a double click and does not sort', async () => {
    const { onChange, user } = setupResize();
    await user.dblClick(screen.getByRole('separator', { name: 'Resize the Citations column' }));
    expect(onChange).toHaveBeenLastCalledWith('count', null);
  });
});
