import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { col } from './columns';
import { DataTable } from './data-table';
import type {
  ColumnGroup,
  DataTableColumn,
  RecordAction,
  RowActions,
  RowTree,
  Selection,
  ServerPaging,
  TableStatus,
} from './types';
import { CopyButton } from '@/components/app/cells/copy-button';
import { InspectorOverlayContext } from '@/components/app/inspector/inspector-layout';
import { CELL_CONTROL } from '@/lib/tables/grid-focus';
import { parseDensity, type Density, type SortKey } from '@/lib/tables/table-state';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

interface Row {
  id: string;
  keyword: string;
  volume: number | null;
  difficulty: number;
}

const rowsOf = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `k${String(index)}`,
    keyword: `keyword ${String(index).padStart(3, '0')}`,
    volume: index === 1 ? null : (index * 37) % 1000,
    difficulty: index % 100,
  }));

const COLUMNS = [
  col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
  col.volume<Row>('volume', (row) => row.volume, { header: 'Volume', priority: 2 }),
  col.count<Row>('difficulty', (row) => row.difficulty, { header: 'KD', priority: 3, headerTooltip: 'Difficulty' }),
];
const DEFAULT_SORT: SortKey[] = [{ id: 'volume', desc: true }];

const onOpen = vi.fn();
const archive = vi.fn();
const ACTIONS: RecordAction<Row>[] = [
  { id: 'archive', label: 'Archive', group: 'destructive', onSelect: archive },
  { id: 'open', label: 'Open', group: 'open', onSelect: vi.fn() },
];

const rowId = (row: Row): string => row.id;
const keywordOf = (row: Row): string => row.keyword;

/** A page of 100 rows at rows 201 to 300 of 4,812. */
const SERVER_PAGE: ServerPaging = {
  rangeText: 'Showing 201 to 300 of 4,812 keywords',
  offset: 200,
  hasPrevious: true,
  hasNext: true,
  onPrevious: () => undefined,
  onNext: () => undefined,
  pageSize: 100,
  onPageSizeChange: () => undefined,
};

function Harness({
  rows,
  status = 'ready',
  matchingTotal = null,
  server,
  onRowOrderChange,
  rowActions = ACTIONS,
  bulkActions = ACTIONS,
  rowName = keywordOf,
  columns = COLUMNS,
  loadProgress = null,
  rowTone,
  pinActions = false,
  columnGroups = false,
  startDensity,
  search: searchFromOutside,
}: {
  /** A search the page sets from outside (a link, the browser's Back), over what was typed in the table. */
  search?: string;
  pinActions?: boolean;
  columnGroups?: boolean;
  startDensity?: Density;
  rowTone?: (row: Row) => 'own' | undefined;
  loadProgress?: { loaded: number; total: number } | null;
  columns?: readonly DataTableColumn<Row>[];
  rows: Row[];
  status?: TableStatus;
  matchingTotal?: number | null;
  server?: ServerPaging;
  onRowOrderChange?: (ids: readonly string[]) => void;
  rowActions?: RowActions<Row>;
  bulkActions?: readonly RecordAction<Row>[];
  rowName?: (row: Row) => string;
}): ReactElement {
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(startDensity ?? parseDensity(null));
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [typed, setSearch] = useState('');
  const search = searchFromOutside ?? typed;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  return (
    <div className="flex h-200 flex-col">
      <DataTable<Row>
        caption="Keywords"
        itemNoun={{ one: 'keyword', other: 'keywords' }}
        columns={columns}
        pinActions={pinActions}
        columnGroups={columnGroups}
        getRowId={rowId}
        rows={rows}
        total={server === undefined ? rows.length : 4812}
        server={server}
        loadProgress={loadProgress}
        sort={sort}
        onSortChange={setSort}
        defaultSort={DEFAULT_SORT}
        density={density}
        onDensityChange={setDensity}
        columnState={{ visible, onChange: setVisible }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search keywords"
        searchText={keywordOf}
        selection={{
          selectedIds: selected,
          onChange: setSelected,
          matchingTotal,
          allMatching,
          onAllMatchingChange: setAllMatching,
        }}
        bulkActions={bulkActions}
        rowActions={rowActions}
        rowName={rowName}
        onRowOpen={onOpen}
        onRowOrderChange={onRowOrderChange}
        rowTone={rowTone}
        status={status}
        errorState={<p>The keywords did not load.</p>}
        emptyState={<p>No keywords yet.</p>}
        filteredEmptyState={<p>No keywords match.</p>}
      />
    </div>
  );
}

/** The width the bulk bar's action area is given. */
let actionsWidth = 1600;
/** The width the grid's region is given: 1600 px unless a test makes the table overflow. */
let regionWidth = 1600;

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const inBar = target instanceof HTMLElement && target.dataset.slot === 'bulk-actions';
    this.callback(
      [
        {
          target,
          contentRect: { width: inBar ? actionsWidth : regionWidth, height: 480 },
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  actionsWidth = 1600;
  regionWidth = 1600;
  onOpen.mockReset();
  archive.mockReset();
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  // jsdom has no Web Animations API; Base UI's scroll area in the column chooser asks for it
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

const grid = (): HTMLElement => screen.getByRole('grid', { name: 'Keywords' });
const bulkBar = (): HTMLElement => screen.getByRole('group', { name: /Bulk actions/ });
const tooltip = (): Element | null => document.querySelector('[data-slot="tooltip"]');
const bodyKeywords = (): string[] =>
  within(grid())
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent);

describe('DataTable house style (owner decisions of 2026-10-29)', () => {
  it('opens in compact density: 32 px rows, with the header row alone at the header height', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    const rows = within(grid()).getAllByRole('row');
    expect(rows[0]).toHaveClass('h-row-header');
    for (const row of rows.slice(1)) {
      expect(row).toHaveClass('h-row-compact');
      expect(row).not.toHaveClass('h-row');
    }
  });

  it('shows every default column at a narrow width, whatever its priority (owner decision of 2026-10-30)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    const headers = within(grid())
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers.join(' ')).toMatch(/Keyword.*Volume.*KD/);
    vi.unstubAllGlobals();
  });

  describe('the identity column width', () => {
    class RegionObserver {
      static width = 1200;
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        const entry = { target, contentRect: { width: RegionObserver.width, height: 600 } };
        this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    const handle = (): HTMLElement => {
      const edge = grid().querySelector<HTMLElement>('[data-resize-handle]');
      if (edge === null) throw new Error('The keyword header has no resize handle');
      return edge;
    };
    // The columns' widths sit in the colgroup: the selection column first, then the keyword column
    const keywordWidth = (): number => Number.parseFloat(grid().querySelectorAll('col')[1]?.style.width ?? '');
    const keywordHeader = (): HTMLElement => screen.getByRole('columnheader', { name: /^Keyword/ });
    beforeEach(() => vi.stubGlobal('ResizeObserver', RegionObserver));
    afterEach(() => {
      RegionObserver.width = 1200;
      vi.unstubAllGlobals();
    });

    it('is dragged by its edge within its limits, and reset with a double click', () => {
      renderWithProviders(<Harness rows={rowsOf(3)} />);
      const before = keywordWidth();
      const edge = handle();
      Object.assign(edge, { setPointerCapture: vi.fn() });
      fireEvent.pointerDown(edge, { clientX: 300, pointerId: 1 });
      fireEvent.pointerMove(edge, { clientX: 260, pointerId: 1 });
      expect(keywordWidth()).toBe(before - 40);
      fireEvent.pointerMove(edge, { clientX: -2000, pointerId: 1 });
      expect(keywordWidth()).toBe(120);
      fireEvent.pointerMove(edge, { clientX: 5000, pointerId: 1 });
      // Never wider than the region less the room kept beside it
      expect(keywordWidth()).toBe(RegionObserver.width - 160);
      fireEvent.pointerUp(edge, { pointerId: 1 });
      fireEvent.pointerMove(edge, { clientX: 300, pointerId: 1 });
      expect(keywordWidth()).toBe(RegionObserver.width - 160);
      fireEvent.doubleClick(edge);
      expect(keywordWidth()).toBe(before);
    });

    it('is widened, narrowed and reset from the column options menu, for the keyboard', async () => {
      renderWithProviders(<Harness rows={rowsOf(3)} />);
      const before = keywordWidth();
      const open = async (item: string): Promise<void> => {
        fireEvent.click(screen.getByRole('button', { name: 'Keyword column options' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: item }));
      };
      await open('Narrower');
      expect(keywordWidth()).toBe(before - 40);
      await open('Wider');
      await open('Wider');
      expect(keywordWidth()).toBe(before + 40);
      await open('Reset width');
      expect(keywordWidth()).toBe(before);
    });

    it('has no labelled control in the header, so the column keeps its plain name', () => {
      renderWithProviders(<Harness rows={rowsOf(3)} />);
      expect(within(keywordHeader()).queryAllByRole('separator')).toHaveLength(0);
      expect(keywordHeader()).toHaveAccessibleName(/^Keyword( |$)/);
      expect(keywordHeader()).not.toHaveAccessibleName(/resize|width/i);
    });

    it('stays pinned while it leaves room beside it, and scrolls away with the columns when it would not', () => {
      RegionObserver.width = 700;
      renderWithProviders(<Harness rows={rowsOf(3)} />);
      // The columns overflow a 700 px region and the keyword column is small: pinned
      expect(keywordHeader().style.left).toBe('40px');
      const edge = handle();
      Object.assign(edge, { setPointerCapture: vi.fn() });
      fireEvent.pointerDown(edge, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(edge, { clientX: 5000, pointerId: 1 });
      // Dragged out to 540 px it would leave 160 px of the 700: it scrolls with the rest
      expect(keywordHeader().style.left).toBe('');
    });
  });

  it('left aligns a numeric column in its header and its cells', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveClass('text-left');
    expect(screen.getByRole('columnheader', { name: /Volume/ })).not.toHaveClass('text-right');
    const [cell] = within(grid()).getAllByRole('gridcell', { name: /^\d+$/ });
    expect(cell).toHaveClass('text-left');
    expect(cell).not.toHaveClass('text-right');
    expect(cell?.firstElementChild).toHaveClass('num');
  });

  it('right aligns the row-actions column, in its header and its cells, and nothing else', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    const rightHeaders = within(grid())
      .getAllByRole('columnheader')
      .filter((header) => header.classList.contains('text-right'));
    expect(rightHeaders.map((header) => header.textContent)).toEqual(['Actions']);
    const rightCells = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => cell.classList.contains('text-right'));
    expect(rightCells).toHaveLength(3);
  });

  it('writes header labels in capitals through the table header style, and keeps the body at the table style', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    const label = within(screen.getByRole('columnheader', { name: /Volume/ })).getByText('Volume');
    expect(label).toHaveClass('type-table-header');
    expect(grid()).toHaveClass('type-table');
  });
});

describe('DataTable', () => {
  it('is a named grid with a hint, a row header per row and the sorted column marked', async () => {
    const { container } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    expect(grid()).toHaveAttribute('aria-rowcount', '6');
    expect(grid()).toHaveAccessibleDescription(/arrow keys/);
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveAttribute('aria-sort', 'descending');
    expect(bodyKeywords()).toHaveLength(5);
    expect(screen.getAllByText('5 keywords')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says one row in the singular and several in the plural, in the count, the select-all name and the load progress', () => {
    const { rerender } = renderWithProviders(<Harness rows={rowsOf(1)} />);
    expect(screen.getAllByText('1 keyword')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Select all 1 keyword loaded' })).toBeInTheDocument();
    rerender(<Harness rows={rowsOf(1)} loadProgress={{ loaded: 0, total: 1 }} />);
    expect(screen.getByText('Loading 0 of 1 keyword')).toBeInTheDocument();
    rerender(<Harness rows={rowsOf(2)} loadProgress={{ loaded: 1, total: 2 }} />);
    expect(screen.getByText('Loading 1 of 2 keywords')).toBeInTheDocument();
  });

  it('sorts from the header: the column default first, then reversed, then back to the table default', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    expect(bodyKeywords()).toEqual(['keyword 004', 'keyword 003', 'keyword 002', 'keyword 000', 'keyword 001']);
    await user.click(within(grid()).getByRole('button', { name: 'Keyword' }));
    expect(bodyKeywords()[0]).toBe('keyword 000');
    expect(screen.getByRole('columnheader', { name: /Keyword/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(grid()).getByRole('button', { name: 'Keyword' }));
    expect(bodyKeywords()[0]).toBe('keyword 004');
    await user.click(within(grid()).getByRole('button', { name: 'Keyword' }));
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('reports the order it shows: after a sort or a search, and not again for the same rows', async () => {
    const order = vi.fn();
    const rows = rowsOf(5);
    const { user, rerender } = renderWithProviders(<Harness rows={rows} onRowOrderChange={order} />);
    expect(order).toHaveBeenLastCalledWith(['k4', 'k3', 'k2', 'k0', 'k1']);
    await user.click(within(grid()).getByRole('button', { name: 'Keyword' }));
    expect(order).toHaveBeenLastCalledWith(['k0', 'k1', 'k2', 'k3', 'k4']);
    const calls = order.mock.calls.length;
    rerender(<Harness rows={[...rows]} onRowOrderChange={order} />);
    expect(order).toHaveBeenCalledTimes(calls);
    await user.type(screen.getByRole('searchbox', { name: /Search/ }), '003');
    await waitFor(() => expect(order).toHaveBeenLastCalledWith(['k3']));
  });

  it('moves one tab stop with the arrows, opens with Enter and selects with Space and Shift+Space', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    // Search, density and columns come first; the next Tab enters the grid at the first header
    for (let presses = 0; presses < 6 && !grid().contains(document.activeElement); presses += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(screen.getAllByRole('columnheader')[0]);
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(document.activeElement).toBe(within(grid()).getAllByRole('rowheader')[0]);
    expect(grid().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'k4' }), 'inspector');
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Shift>} {/Shift}');
    expect(within(bulkBar()).getByText('3 selected')).toBeInTheDocument();
    // Shift+Space on a row already in the range extends the selection rather than undoing it
    await user.keyboard('{ArrowUp}{Shift>} {/Shift}');
    expect(within(bulkBar()).getByText('3 selected')).toBeInTheDocument();
    await user.keyboard('{Control>}a{/Control}');
    expect(within(bulkBar()).getByText('5 selected')).toBeInTheDocument();
  });

  it('keeps a Shift click on a row checkbox as the one range it asks for, and a plain click as one toggle', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(6)} />);
    // The default sort is by volume, descending: k5 (185), k4 (148), k3 (111), k2 (74), k0 (0), k1 (none)
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 005' }));
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 002' }));
    await user.keyboard('{/Shift}');
    expect(within(bulkBar()).getByText('4 selected')).toBeInTheDocument();
    for (const name of ['005', '004', '003', '002']) {
      expect(screen.getByRole('checkbox', { name: `Select keyword ${name}` })).toBeChecked();
    }
    expect(screen.getByRole('checkbox', { name: 'Select keyword 000' })).not.toBeChecked();
  });

  it('offers every matching row only once every loaded row is selected, and runs a bulk action on it', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 000' }));
    expect(within(bulkBar()).queryByRole('button', { name: /matching/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    expect(within(bulkBar()).getByText('All 4,812 matching selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' })).toBeChecked();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'k0' })]),
      expect.objectContaining({ allMatching: true }),
    );
    // Unticking one row leaves the other loaded rows selected
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 002' }));
    expect(within(bulkBar()).getByText('4 selected')).toBeInTheDocument();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
  });

  it('keeps selected rows a filter hides: the header checkbox leaves them, and actions still get their ids', async () => {
    const all = rowsOf(5);
    const { user, rerender } = renderWithProviders(<Harness rows={all} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 003' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 004' }));
    rerender(<Harness rows={all.filter((row) => row.id !== 'k4')} />);
    expect(within(bulkBar()).getByText('1 selected row is hidden by filters')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' }));
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith([], { ids: new Set(['k4']), allMatching: false });
  });

  it('follows the focused row through a search, not its position', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    const second = within(grid()).getAllByRole('rowheader')[1];
    if (second === undefined) throw new Error('no row');
    expect(second).toHaveTextContent('keyword 003');
    act(() => second.focus());
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), '003');
    expect(bodyKeywords()).toEqual(['keyword 003']);
    expect(within(grid()).getByRole('rowheader')).toHaveAttribute('tabindex', '0');
  });

  it('hands Escape and the arrows from a control in a cell back to the grid', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 002' }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(within(grid()).getAllByRole('rowheader')[0]);
    await user.click(within(grid()).getByRole('button', { name: 'Keyword' }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('columnheader', { name: /Keyword/ }));
  });

  it('returns focus to the grid when the bulk bar closes', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
    expect(grid()).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    expect(document.activeElement).toHaveAttribute('tabindex', '0');
  });

  it('counts the header and the message row when a search matches nothing', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'nothing like this');
    expect(screen.getByText('No keywords match.')).toBeInTheDocument();
    expect(grid()).toHaveAttribute('aria-rowcount', '2');
  });

  it('numbers the rows of a server page by their place in the whole list', () => {
    renderWithProviders(<Harness rows={rowsOf(100)} server={SERVER_PAGE} />);
    expect(grid()).toHaveAttribute('aria-rowcount', '4813');
    const firstRow = within(grid()).getAllByRole('row')[1];
    expect(firstRow).toHaveAttribute('aria-rowindex', '202');
  });

  it('keeps focus on Next page when it has no page left to go to, and does not move on when pressed', async () => {
    const onNext = vi.fn();
    const { user, rerender } = renderWithProviders(<Harness rows={rowsOf(100)} server={{ ...SERVER_PAGE, onNext }} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    rerender(<Harness rows={rowsOf(100)} server={{ ...SERVER_PAGE, hasNext: false, onNext }} />);
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveFocus();
    await user.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('scrolls back to the top when the page of a server list changes, and not when the same page reloads', () => {
    const view = renderWithProviders(<Harness rows={rowsOf(100)} server={SERVER_PAGE} />);
    const region = grid().parentElement;
    if (region === null) throw new Error('no scroll region');
    fireEvent.scroll(region, { target: { scrollTop: 1_500 } });
    expect(region.scrollTop).toBe(1_500);
    // The same page read again keeps the place
    view.rerender(<Harness rows={rowsOf(100)} server={{ ...SERVER_PAGE, rangeText: 'Showing 201 to 300' }} />);
    expect(region.scrollTop).toBe(1_500);
    // The next page starts at its first row
    view.rerender(<Harness rows={rowsOf(100)} server={{ ...SERVER_PAGE, offset: 300 }} />);
    expect(region.scrollTop).toBe(0);
    expect(within(grid()).getAllByRole('row')[1]).toHaveAttribute('aria-rowindex', '302');
  });

  it('keeps the focused row when scrolled far away, without the rows between', () => {
    renderWithProviders(<Harness rows={rowsOf(500)} />);
    const first = within(grid()).getAllByRole('rowheader')[0];
    if (first === undefined) throw new Error('no row');
    act(() => first.focus());
    const region = grid().parentElement;
    if (region === null) throw new Error('no scroll region');
    fireEvent.scroll(region, { target: { scrollTop: 15_000 } });
    expect(first).toBeInTheDocument();
    expect(bodyKeywords().length).toBeLessThan(45);
  });

  it('hides, shows and moves columns, and searches the loaded rows', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('checkbox', { name: 'KD' }));
    expect(screen.queryByRole('columnheader', { name: /KD/ })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'KD' }));
    await user.click(screen.getByRole('button', { name: 'Move KD up' }));
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.indexOf('KD')).toBeLessThan(headers.indexOf('Volume'));
    await user.keyboard('{Escape}');
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), '003');
    expect(bodyKeywords()).toEqual(['keyword 003']);
  });

  it('renders only the rows near the view of a long table, and keeps the count of all', () => {
    renderWithProviders(<Harness rows={rowsOf(500)} />);
    expect(grid()).toHaveAttribute('aria-rowcount', '501');
    expect(bodyKeywords().length).toBeLessThan(40);
  });

  it('shows skeleton rows while loading, and the empty, filtered and error states', () => {
    const { rerender } = renderWithProviders(<Harness rows={[]} status="loading" />);
    expect(grid()).toHaveAttribute('aria-busy', 'true');
    rerender(<Harness rows={[]} status="empty" />);
    expect(screen.getByText('No keywords yet.')).toBeInTheDocument();
    rerender(<Harness rows={[]} status="filtered-empty" />);
    expect(screen.getByText('No keywords match.')).toBeInTheDocument();
    rerender(<Harness rows={[]} status="error" />);
    expect(screen.getByText('The keywords did not load.')).toBeInTheDocument();
  });

  it('opens a row menu from the keyboard, runs its action on that row only, and returns to the cell', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    const cell = within(grid()).getAllByRole('rowheader')[0];
    if (cell === undefined) throw new Error('no row');
    act(() => cell.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith([expect.objectContaining({ id: 'k2' })], {
      ids: new Set(['k2']),
      allMatching: false,
    });
    // The click on the portaled item reaches the row through React, and must not open it
    expect(onOpen).not.toHaveBeenCalled();
    const actionsCell = within(grid())
      .getAllByRole('gridcell')
      .find((candidate) => candidate.querySelector('[aria-haspopup]'));
    await waitFor(() => {
      expect(document.activeElement).toBe(actionsCell);
    });
  });

  it('gives a menu only to the rows the actions function names actions for', async () => {
    const onlyTheFirst = (row: Row): readonly RecordAction<Row>[] => (row.id === 'k2' ? ACTIONS : []);
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} rowActions={onlyTheFirst} />);
    expect(within(grid()).getAllByRole('button', { name: /^Actions for / })).toHaveLength(1);
    const cell = within(grid()).getAllByRole('rowheader')[1];
    if (cell === undefined) throw new Error('no row');
    act(() => cell.focus());
    // No menu for a row without actions: the key opens nothing
    await user.keyboard('{Shift>}{F10}{/Shift}');
    expect(screen.queryByRole('menuitem')).toBeNull();
    // Nor does Enter on that row's empty actions cell: the key is not taken for a menu that cannot open
    const emptyActions = within(grid())
      .getAllByRole('gridcell')
      .filter((candidate) => candidate.closest('tr') === cell.closest('tr'))
      .at(-1);
    if (emptyActions === undefined) throw new Error('no actions cell');
    act(() => emptyActions.focus());
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
    const first = within(grid()).getAllByRole('rowheader')[0];
    if (first === undefined) throw new Error('no row');
    act(() => first.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith([expect.objectContaining({ id: 'k2' })], expect.anything());
  });
});

/** Five bulk actions in the order the bar draws them; Archive is neutral and Delete is the one destructive. */
const MANY_ACTIONS: RecordAction<Row>[] = [
  { id: 'open', label: 'Open', group: 'open', onSelect: vi.fn() },
  { id: 'tags', label: 'Add tags', group: 'object', onSelect: vi.fn() },
  { id: 'priority', label: 'Set priority', group: 'object', onSelect: vi.fn() },
  { id: 'archive', label: 'Archive', group: 'destructive', tone: 'default', onSelect: archive },
  { id: 'delete', label: 'Delete', group: 'destructive', onSelect: vi.fn() },
];

describe('DataTable bulk bar width', () => {
  let width: MockInstance<() => number>;
  beforeEach(() => {
    // Every button and the More button measure 100 px
    width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
  });
  afterEach(() => width.mockRestore());

  const barButtons = (): string[] =>
    within(bulkBar())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent);

  it('keeps every action a button when the bar is wide', async () => {
    actionsWidth = 1000;
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    expect(barButtons()).toEqual(['Open', 'Add tags', 'Set priority', 'Archive', 'Delete', 'Clear selection']);
    expect(within(bulkBar()).queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('moves the actions that do not fit into a More actions menu, destructive ones last, and keeps all reachable', async () => {
    // Two buttons, a gap and the More button fit in 320 px; five buttons need 532
    actionsWidth = 320;
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    expect(barButtons()).toEqual(['Open', 'Add tags', 'More actions', 'Clear selection']);
    await user.click(within(bulkBar()).getByRole('button', { name: 'More actions' }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      'Set priority',
      'Archive',
      'Delete',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'k1' })],
      expect.objectContaining({ allMatching: false }),
    );
  });

  it('leaves only the More button when not even one action fits, and draws Archive neutral and Delete destructive', async () => {
    actionsWidth = 120;
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    expect(barButtons()).toEqual(['More actions', 'Clear selection']);
    await user.click(within(bulkBar()).getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toHaveClass('text-negative-text');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).not.toHaveClass('text-negative-text');
  });

  it('draws an action with a neutral tone as a secondary button even in the destructive group', async () => {
    actionsWidth = 1000;
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    expect(within(bulkBar()).getByRole('button', { name: 'Archive' }).className).not.toContain('negative');
    expect(within(bulkBar()).getByRole('button', { name: 'Delete' }).className).toContain('negative');
  });
});

describe('DataTable bulk bar beside an inspector laid over the list', () => {
  it('keeps clear of the card, whose left edge is where the actions must end', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 48,
      width: 1200,
      height: 48,
      toJSON: () => ({}),
    });
    try {
      const { user } = renderWithProviders(
        <InspectorOverlayContext value={900}>
          <Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />
        </InspectorOverlayContext>,
      );
      await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
      // The bar reaches 1200 px and the card begins at 900: 300 px are covered, besides the bar's own 12 px
      expect(bulkBar().style.paddingRight).toBe('312px');
    } finally {
      rect.mockRestore();
    }
  });

  it('leaves its padding alone when no inspector lays over the list', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} bulkActions={MANY_ACTIONS} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 001' }));
    expect(bulkBar().style.paddingRight).toBe('');
  });
});

describe('DataTable cell descriptions', () => {
  const DESCRIBED = [
    col.keyword<Row>('keyword', (row) => row.keyword, {
      header: 'Keyword',
      detail: (row) => `Berlin, desktop, Google, English for ${row.keyword}`,
    }),
    col.volume<Row>('volume', (row) => row.volume, {
      header: 'Volume',
      priority: 1,
      headerTooltip: 'Monthly searches, an estimate',
      unknown: () => ({ label: 'Pending', tooltip: 'Labs has not answered yet' }),
    }),
  ];

  it('describes a header by the header cell, which is what holds the focus', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} columns={DESCRIBED} />);
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveAccessibleDescription(
      'Monthly searches, an estimate',
    );
  });

  it('describes a row header and an unknown value by their cells', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} columns={DESCRIBED} />);
    const first = within(grid()).getAllByRole('rowheader')[0];
    expect(first).toHaveAccessibleDescription('Berlin, desktop, Google, English for keyword 002');
    const pending = within(grid())
      .getAllByRole('gridcell')
      .find((cell) => cell.textContent === 'Pending');
    expect(pending).toHaveAccessibleDescription('Labs has not answered yet');
  });

  it('keeps the text of a cell to its value, so the descriptions add nothing to what a cell reads', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} columns={DESCRIBED} />);
    expect(bodyKeywords()).toEqual(['keyword 002', 'keyword 000', 'keyword 001']);
  });

  it('opens the tooltip of a header and of a cell when the keyboard focuses it', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} columns={DESCRIBED} />);
    for (let presses = 0; presses < 6 && !grid().contains(document.activeElement); presses += 1) {
      await user.tab();
    }
    await user.keyboard('{ArrowRight}');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('columnheader', { name: /Volume/ })).toHaveFocus();
    await waitFor(() => expect(tooltip()).toHaveTextContent('Monthly searches, an estimate'));
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowLeft}');
    expect(within(grid()).getAllByRole('rowheader')[0]).toHaveFocus();
    await waitFor(() => expect(tooltip()).toHaveTextContent('Berlin, desktop, Google, English for keyword 002'));
  });

  it('gives two rows of one keyword the names their row name gives, in the checkbox and the row menu', () => {
    const rows = [
      { id: 'a', keyword: 'seo agency', volume: 10, difficulty: 1 },
      { id: 'b', keyword: 'seo agency', volume: 10, difficulty: 1 },
    ];
    renderWithProviders(
      <Harness rows={rows} rowName={(row) => `${row.keyword}, ${row.id === 'a' ? 'desktop' : 'mobile'}`} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select seo agency, desktop' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select seo agency, mobile' })).toBeInTheDocument();
  });
});

describe('DataTable rank, change and URL columns', () => {
  /** The rows' `volume` stands for a rank here: `null` is beyond the depth or never checked. */
  const RANKED = [
    col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
    col.rank<Row>('rank', (row) => row.volume, {
      header: 'Rank',
      headerTooltip: 'Organic rank at the latest check',
      cell: (row) => <span>{row.volume === null ? '>20' : String(row.volume)}</span>,
      cellTip: (row) => (row.volume === null ? { content: 'Not in the top 20' } : undefined),
    }),
    col.rankDelta<Row>('change', (row) => row.difficulty, {
      header: 'Change',
      cell: (row) => <span>{`move ${String(row.difficulty)}`}</span>,
    }),
    col.url<Row>('url', () => null, {
      header: 'Page URL',
      sortable: false,
      cell: (row) => <span>{`/page-${row.id}`}</span>,
    }),
  ];

  it('sizes each type as its spec says, and keeps a screen width between its minimum and maximum', () => {
    const wide = col.rank<Row>('rank', () => 1, { header: 'Rank', width: 500, cell: () => null });
    const narrow = col.url<Row>('url', () => null, { header: 'URL', width: 50, cell: () => null });
    const features = col.features<Row>('serp_features', () => null, {
      header: 'SERP features',
      priority: 3,
      width: 120,
      sortable: false,
      cell: () => 'x',
    });
    const aio = col.aiOverview<Row>('aio', () => null, {
      header: 'AI Overview',
      priority: 2,
      width: 104,
      sortable: false,
      cell: () => 'aio',
    });
    const spark = col.sparkline<Row>('trend', {
      header: 'Trend',
      priority: 2,
      width: 96,
      cell: () => 'spark',
    });
    const comp = col.competitor<Row>('competitor_1', {
      header: 'Brightwave',
      priority: 4,
      width: 120,
      cell: () => 'comp',
    });
    expect(RANKED.map((column) => column.type)).toEqual(['keyword', 'rank', 'rankDelta', 'url']);
    expect(wide.width).toBe(136);
    expect(narrow.width).toBe(160);
    expect(features.type).toBe('features');
    expect(features.width).toBe(120);
    expect(features.sortValue).toBeUndefined();
    expect(aio.type).toBe('aiOverview');
    expect(aio.width).toBe(104);
    expect(aio.sortValue).toBeUndefined();
    expect(spark.type).toBe('sparkline');
    expect(spark.width).toBe(96);
    expect(spark.sortValue).toBeUndefined();
    expect(comp.type).toBe('competitor');
    expect(comp.width).toBe(120);
    expect(comp.sortValue).toBeUndefined();
    // A header that needs more than its type's minimum names its own, and the width follows it
    const priority = col.count<Row>('priority', () => 1, { header: 'Priority', width: 50, minWidth: 100 });
    expect(priority.minWidth).toBe(100);
    expect(priority.width).toBe(100);
  });

  it('shows the cell the screen gives and sorts rank best first, with unknown ranks last both ways', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} columns={RANKED} />);
    expect(screen.getByText('/page-k3')).toBeInTheDocument();
    await user.click(within(grid()).getByRole('button', { name: 'Rank' }));
    expect(screen.getByRole('columnheader', { name: /Rank/ })).toHaveAttribute('aria-sort', 'ascending');
    // Ranks are 0, null, 74, 111 and 148 by index; the unknown one is last when ascending
    expect(bodyKeywords()).toEqual(['keyword 000', 'keyword 002', 'keyword 003', 'keyword 004', 'keyword 001']);
    await user.click(within(grid()).getByRole('button', { name: 'Rank' }));
    expect(screen.getByRole('columnheader', { name: /Rank/ })).toHaveAttribute('aria-sort', 'descending');
    expect(bodyKeywords()).toEqual(['keyword 004', 'keyword 003', 'keyword 002', 'keyword 000', 'keyword 001']);
  });

  it('sorts when clicking the header label and opens the column menu from the chevron', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} columns={RANKED} />);
    const rankHeader = screen.getByRole('columnheader', { name: /Rank/ });
    await user.click(within(rankHeader).getByRole('button', { name: 'Rank' }));
    expect(rankHeader).toHaveAttribute('aria-sort', 'ascending');

    const chevron = within(rankHeader).getByRole('button', { name: 'Rank column options' });
    await user.click(chevron);
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sort descending' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });

  it('sorts a change with the biggest improvement first, and leaves a URL column unsortable', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} columns={RANKED} />);
    await user.click(within(grid()).getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('columnheader', { name: /Change/ })).toHaveAttribute('aria-sort', 'descending');
    expect(bodyKeywords()[0]).toBe('keyword 004');
    expect(within(grid()).queryByRole('button', { name: 'Page URL' })).not.toBeInTheDocument();
  });

  it('puts a marker before a date, and says why a row has none in the cell and its description', () => {
    // Rows 0 and 2 have a date; row 1 has none, and row 2 is marked
    const dated = (row: Row): string | null => (row.id === 'k1' ? null : '2026-10-06T02:00:00Z');
    const columns = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.date<Row>('checked', dated, {
        header: 'Updated',
        timeZone: 'UTC',
        marker: (row) => (row.id === 'k2' ? <span>Stale</span> : null),
        cellTip: (row) => (row.id === 'k2' ? { content: 'No recent successful check' } : undefined),
        unknown: () => ({ label: 'Pending', tooltip: 'The first check has not run yet' }),
      }),
    ];
    renderWithProviders(<Harness rows={rowsOf(3)} columns={columns} />);
    const cells = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => /Oct 6|Pending/.test(cell.textContent));
    expect(cells.map((cell) => cell.textContent)).toEqual(['Oct 6, 02:00', 'Pending', 'StaleOct 6, 02:00']);
    expect(cells[1]).toHaveAccessibleDescription('The first check has not run yet');
    expect(cells[2]).toHaveAccessibleDescription('No recent successful check');
    expect(cells[0]).toHaveAccessibleDescription('');
  });

  it('puts the marker before the word of a row that has no date as well', () => {
    const dated = (row: Row): string | null => (row.id === 'k1' ? null : '2026-10-06T02:00:00Z');
    const columns = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.date<Row>('checked', dated, {
        header: 'Updated',
        timeZone: 'UTC',
        marker: () => <span>Stale</span>,
        unknown: () => ({ label: 'Check failed' }),
      }),
    ];
    renderWithProviders(<Harness rows={rowsOf(3)} columns={columns} />);
    const cells = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => /Oct 6|Check failed/.test(cell.textContent));
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'StaleOct 6, 02:00',
      'StaleCheck failed',
      'StaleOct 6, 02:00',
    ]);
  });

  it('keeps a date and its marker in the cell: the marker wraps under the date, and the date is never broken', () => {
    const columns = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.date<Row>('checked', () => '2026-10-06T02:00:00Z', {
        header: 'Updated',
        timeZone: 'UTC',
        marker: (row) => (row.id === 'k0' ? <span>Stale</span> : null),
      }),
    ];
    renderWithProviders(<Harness rows={rowsOf(2)} columns={columns} />);
    const [marked, plain] = within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => /Oct 6/.test(cell.textContent));
    const dateOf = (cell: HTMLElement | undefined): Element | null | undefined =>
      cell?.querySelector('.num') ?? undefined;
    // With a marker the date stays in one piece and the pair may wrap, so it does not spill into the next column
    expect(dateOf(marked)).toHaveClass('whitespace-nowrap');
    expect(dateOf(marked)?.parentElement).toHaveClass('flex-wrap', 'max-w-full');
    // A date alone is as it was: in a narrow column of the Runs table it may still wrap at its space
    expect(dateOf(plain)).not.toHaveClass('whitespace-nowrap');
  });

  it('describes a cell through the cell that holds the focus, and a header by its tooltip', () => {
    renderWithProviders(<Harness rows={rowsOf(5)} columns={RANKED} />);
    expect(screen.getByRole('columnheader', { name: /Rank/ })).toHaveAccessibleDescription(
      'Organic rank at the latest check',
    );
    const beyond = within(grid())
      .getAllByRole('gridcell')
      .find((cell) => cell.textContent === '>20');
    expect(beyond).toHaveAccessibleDescription('Not in the top 20');
  });

  it('renders a marker in a keyword cell without changing the accessible name or tooltip', () => {
    interface MarkedRow extends Row {
      flag: boolean;
    }
    const columns = [
      col.keyword<MarkedRow>('keyword', (row) => row.keyword, {
        header: 'Keyword',
        detail: (row) => `Detail for ${row.keyword}`,
        marker: (row) => (row.flag ? <span data-testid="m" /> : null),
      }),
    ];
    const rows: MarkedRow[] = [
      { id: '1', keyword: 'flagged keyword', volume: 100, difficulty: 20, flag: true },
      { id: '2', keyword: 'plain keyword', volume: 200, difficulty: 30, flag: false },
    ];
    renderWithProviders(<Harness rows={rows} columns={columns as unknown as readonly DataTableColumn<Row>[]} />);
    const rowHeaders = screen.getAllByRole('rowheader');
    const first = rowHeaders[0];
    const second = rowHeaders[1];
    if (first === undefined || second === undefined) throw new Error('No row headers');
    expect(within(first).getByTestId('m')).toBeInTheDocument();
    expect(within(second).queryByTestId('m')).toBeNull();
    expect(first).toHaveAccessibleName('flagged keyword');
    expect(second).toHaveAccessibleName('plain keyword');
    expect(first).toHaveAccessibleDescription('Detail for flagged keyword');
    expect(second).toHaveAccessibleDescription('Detail for plain keyword');
  });
});

/** A keyword cell with a copy button, and a URL cell with a link and a copy button, as Rankings builds them. */
const CONTROLLED_URL = col.url<Row>('url', () => null, {
  header: 'URL',
  sortable: false,
  hasControls: true,
  // The cell's own tooltip: what shows on the cell while no control in it has the keyboard focus
  cellTip: (row) => ({ content: `Whole address of ${row.id}` }),
  cell: (row) => (
    <span className="flex min-w-0 items-center">
      <a
        {...CELL_CONTROL}
        href={`https://example.test/${row.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open /${row.id} in a new tab`}
      >
        {`/${row.id}`}
      </a>
      <span>+1</span>
      <CopyButton text={`https://example.test/${row.id}`} label="Copy ranking URL" announcement="URL copied" />
    </span>
  ),
});
const CONTROLLED = [
  col.keyword<Row>('keyword', (row) => row.keyword, {
    header: 'Keyword',
    detail: (row) => `Berlin, desktop for ${row.keyword}`,
    copy: { label: (row) => `Copy keyword ${row.keyword}`, announcement: 'Keyword copied' },
  }),
  col.volume<Row>('volume', (row) => row.volume, { header: 'Volume' }),
  CONTROLLED_URL,
];

describe('DataTable controls in cells', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  /** A link click would navigate a real browser; the page stays here. */
  const keepPage = (event: Event): void => event.preventDefault();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    document.addEventListener('click', keepPage);
  });
  afterEach(() => {
    document.removeEventListener('click', keepPage);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  /** Rendered, then given a clipboard: rendering sets up user-event, which installs one of its own. */
  function renderControlled(): ReturnType<typeof renderWithProviders> {
    const view = renderWithProviders(<Harness rows={rowsOf(3)} columns={CONTROLLED} />);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return view;
  }
  const firstRow = (): HTMLElement => {
    const row = within(grid()).getAllByRole('row')[1];
    if (row === undefined) throw new Error('no row');
    return row;
  };
  /** The fourth cell of a row: after the checkbox, the keyword and the volume. */
  const urlCellOf = (row: Element | undefined): HTMLElement => {
    const cell = row?.children[3];
    if (!(cell instanceof HTMLElement)) throw new Error('no URL cell');
    return cell;
  };
  const urlCell = (): HTMLElement => urlCellOf(firstRow());
  const keywordCell = (): HTMLElement => within(firstRow()).getByRole('rowheader');
  const focusCell = (cell: HTMLElement): void => {
    act(() => cell.focus());
  };

  it('says in its hint how F2 reaches the controls, which a table without controls does not mention', () => {
    const { unmount } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    expect(grid()).toHaveAccessibleDescription(/Use the arrow keys to move between cells\. Enter opens the row/);
    expect(grid()).not.toHaveAccessibleDescription(/F2/);
    unmount();
    renderControlled();
    expect(grid()).toHaveAccessibleDescription(/Use the arrow keys to move between cells\. Enter opens the row/);
    expect(grid()).toHaveAccessibleDescription(
      /F2 moves into the buttons and links of a cell, Tab steps between them and Escape comes back to the cell/,
    );
    expect(grid()).toHaveAccessibleDescription(/On a column header, Enter sorts/);
  });

  it('leaves F2 out of the hint when the columns with controls are not the ones shown', () => {
    // The URL column holds controls and waits in the column chooser, so no cell shown has one
    renderWithProviders(
      <Harness rows={rowsOf(3)} columns={[...COLUMNS, { ...CONTROLLED_URL, defaultVisible: false }]} />,
    );
    expect(within(grid()).queryByRole('link')).toBeNull();
    expect(grid()).not.toHaveAccessibleDescription(/F2/);
  });

  it('keeps one tab stop, and names the row header by the keyword alone', () => {
    renderControlled();
    expect(grid().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    const buttons = within(grid()).getAllByRole('button', { name: /^Copy / });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.getAttribute('tabindex') === '-1')).toBe(true);
    expect(keywordCell()).toHaveAccessibleName('keyword 002');
    expect(keywordCell()).toHaveAccessibleDescription('Berlin, desktop for keyword 002');
    expect(within(keywordCell()).getByRole('button', { name: 'Copy keyword keyword 002' })).toBeInTheDocument();
  });

  it('moves into the controls of a cell with F2, steps between them with Tab, and comes back with Escape', async () => {
    const { user } = renderControlled();
    focusCell(urlCell());
    await user.keyboard('{F2}');
    const link = within(urlCell()).getByRole('link', { name: 'Open /k2 in a new tab' });
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    expect(link).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(copy).toHaveFocus();
    // It wraps, both ways, and the grid keeps its one tab stop
    await user.keyboard('{Tab}');
    expect(link).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(copy).toHaveFocus();
    expect(grid().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    await user.keyboard('{Escape}');
    expect(urlCell()).toHaveFocus();
  });

  it('stays on the only control of a cell on Tab, and hands the arrows back to the grid', async () => {
    const { user } = renderControlled();
    focusCell(keywordCell());
    await user.keyboard('{F2}');
    const copy = within(keywordCell()).getByRole('button', { name: /^Copy keyword/ });
    expect(copy).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(copy).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(within(firstRow()).getAllByRole('gridcell')[1]).toHaveFocus();
  });

  it('does nothing on F2 in a cell without controls', async () => {
    const { user } = renderControlled();
    const volume = within(firstRow()).getAllByRole('gridcell')[1];
    if (volume === undefined) throw new Error('no cell');
    focusCell(volume);
    await user.keyboard('{F2}');
    expect(volume).toHaveFocus();
  });

  it('leaves Tab alone for a control that was clicked rather than entered with F2', async () => {
    const { user } = renderControlled();
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    await user.click(copy);
    expect(copy).toHaveFocus();
    expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
  });

  it('stops taking Tab for the cell once focus has gone from it', async () => {
    const { user } = renderControlled();
    focusCell(urlCell());
    await user.keyboard('{F2}');
    await user.keyboard('{ArrowDown}');
    expect(urlCellOf(within(grid()).getAllByRole('row')[2])).toHaveFocus();
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    copy.focus();
    expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
  });

  it('keeps Enter for the inspector on a focused cell, and Enter on a control for the control', async () => {
    const { user } = renderControlled();
    focusCell(keywordCell());
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'k2' }), 'inspector');
    onOpen.mockClear();
    await user.keyboard('{F2}{Enter}');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('keyword 002');
    expect(onOpen).not.toHaveBeenCalled();
    // Space on a control does not select the row. The selection is announced after 250 ms, so the row's own
    // state is what says it was not selected
    await user.keyboard(' ');
    expect(firstRow()).toHaveAttribute('aria-selected', 'false');
    expect(within(firstRow()).getByRole('checkbox', { name: 'Select keyword 002' })).not.toBeChecked();
  });

  it('opens the link with Space as well as Enter, and Space does not scroll the table or select the row', async () => {
    const { user } = renderControlled();
    const clicked = vi.fn<(event: Event) => void>();
    document.addEventListener('click', clicked);
    try {
      focusCell(urlCell());
      await user.keyboard('{F2}');
      const link = within(urlCell()).getByRole('link', { name: 'Open /k2 in a new tab' });
      expect(link).toHaveFocus();
      // Enter is the browser's own; Space on an anchor scrolls unless the table takes it
      await user.keyboard('{Enter}');
      expect(clicked).toHaveBeenCalledOnce();
      clicked.mockClear();
      expect(fireEvent.keyDown(link, { key: ' ' })).toBe(false);
      expect(clicked).toHaveBeenCalledOnce();
      expect(clicked.mock.calls[0]?.[0].target).toBe(link);
      clicked.mockClear();
      await user.keyboard(' ');
      expect(clicked).toHaveBeenCalledOnce();
      expect(onOpen).not.toHaveBeenCalled();
      expect(firstRow()).toHaveAttribute('aria-selected', 'false');
    } finally {
      document.removeEventListener('click', clicked);
    }
  });

  it('keeps widget mode while the window has no focus, and Tab goes on to the next control when it is back', async () => {
    const { user } = renderControlled();
    focusCell(urlCell());
    await user.keyboard('{F2}');
    const link = within(urlCell()).getByRole('link', { name: 'Open /k2 in a new tab' });
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    expect(link).toHaveFocus();
    // A new tab or another window takes the focus: the link blurs with no element to give it to, and is
    // still the page's active element
    act(() => {
      window.dispatchEvent(new Event('blur'));
      fireEvent.blur(link, { relatedTarget: null });
    });
    expect(link).toHaveFocus();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      fireEvent.focus(link);
    });
    await user.keyboard('{Tab}');
    expect(copy).toHaveFocus();
    expect(urlCell().contains(document.activeElement)).toBe(true);
  });

  it('leaves widget mode when focus goes to nothing: the element is no longer the active one', async () => {
    const { user } = renderControlled();
    focusCell(urlCell());
    await user.keyboard('{F2}');
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    await user.keyboard('{Tab}');
    expect(copy).toHaveFocus();
    // A click on the page's background: nothing takes the focus
    act(() => copy.blur());
    act(() => {
      fireEvent.blur(copy, { relatedTarget: null });
    });
    expect(document.body).toHaveFocus();
    act(() => copy.focus());
    expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
  });

  it('stays in widget mode through a copy that falls back to a selected field, and keeps its focus', async () => {
    const { user } = renderControlled();
    // No Clipboard API (a plain http page): the field is selected and copied
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn<(commandId: string) => boolean>().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true });
    try {
      focusCell(urlCell());
      await user.keyboard('{F2}');
      const link = within(urlCell()).getByRole('link', { name: 'Open /k2 in a new tab' });
      const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
      await user.keyboard('{Tab}');
      expect(copy).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy'));
      await waitFor(() => expect(within(urlCell()).getByRole('button', { name: 'Copied' })).toBe(copy));
      expect(copy).toHaveFocus();
      // Still in widget mode: Tab steps to the link rather than leaving the cell
      await user.keyboard('{Tab}');
      expect(link).toHaveFocus();
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('leaves widget mode for a click on the cell itself, so a clicked control is Tab as any button', async () => {
    const { user } = renderControlled();
    focusCell(urlCell());
    await user.keyboard('{F2}');
    // The padding of the cell, which is focusable itself: focus goes to the cell, inside the widget cell
    await user.click(urlCell());
    expect(urlCell()).toHaveFocus();
    const copy = within(urlCell()).getByRole('button', { name: 'Copy ranking URL' });
    await user.click(copy);
    expect(copy).toHaveFocus();
    expect(fireEvent.keyDown(copy, { key: 'Tab' })).toBe(true);
  });

  it('shows the control own tooltip while a control has the keyboard focus, and the cell one otherwise', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} columns={CONTROLLED} />);
    focusCell(urlCell());
    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(urlCell()).toHaveFocus();
    await waitFor(() => expect(tooltip()).toHaveTextContent('Whole address of k2'));
    await user.keyboard('{F2}{Tab}');
    expect(within(urlCell()).getByRole('button', { name: 'Copy ranking URL' })).toHaveFocus();
    await waitFor(() => expect(tooltip()).toHaveTextContent('Copy ranking URL'));
    expect(document.querySelectorAll('[data-slot="tooltip"]')).toHaveLength(1);
    expect(tooltip()).not.toHaveTextContent('Whole address');
    // Escape is the way back to the cell, and the control's tooltip does not use the first press
    await user.keyboard('{Escape}');
    expect(urlCell()).toHaveFocus();
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  it('copies the keyword from the keyboard, as it is, and says so', async () => {
    const { user } = renderControlled();
    focusCell(keywordCell());
    await user.keyboard('{F2}{Enter}');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('keyword 002');
    await waitFor(() => expect(document.getElementById('live-region-polite')).toHaveTextContent('Keyword copied'));
  });

  it('does not open the row, select it or toggle its checkbox for a click on a control', async () => {
    const { user } = renderControlled();
    const checkbox = within(firstRow()).getByRole('checkbox', { name: 'Select keyword 002' });
    await user.click(within(urlCell()).getByRole('link'));
    await user.click(within(urlCell()).getByRole('button', { name: 'Copy ranking URL' }));
    await user.click(within(keywordCell()).getByRole('button', { name: /^Copy keyword/ }));
    // A new tab and a middle click are the link's own
    await user.keyboard('{Control>}');
    await user.click(within(urlCell()).getByRole('link'));
    await user.keyboard('{/Control}');
    fireEvent(
      within(urlCell()).getByRole('link'),
      new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }),
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(checkbox).not.toBeChecked();
    expect(firstRow()).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('still opens the row for a click on the cell outside its controls', async () => {
    const { user } = renderControlled();
    await user.click(within(urlCell()).getByText('+1'));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'k2' }), 'inspector');
    onOpen.mockClear();
    await user.click(within(keywordCell()).getByText('keyword 002'));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'k2' }), 'inspector');
  });

  it('reveals the controls on hover and focus by CSS only, so they stay in the page for everything else', () => {
    renderControlled();
    expect(keywordCell()).toHaveClass('group/cell');
    expect(urlCell()).toHaveClass('group/cell');
    const wrapper = within(keywordCell()).getByRole('button', { name: /^Copy keyword/ }).parentElement;
    expect(wrapper).toHaveClass('opacity-0', 'group-hover:opacity-100', 'group-focus-within/cell:opacity-100');
    expect(grid().querySelector('.hidden, .invisible')).toBeNull();
  });

  it('passes the accessibility check with the controls in the rows', async () => {
    const { container } = renderControlled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

const WHOSE = [
  ...COLUMNS,
  col.text<Row>('whose', (row) => (row.id === 'k2' ? 'You' : 'Someone else'), { header: 'Entity', priority: 1 }),
];
const isOwn = (row: Row): 'own' | undefined => (row.id === 'k2' ? 'own' : undefined);

describe('DataTable row tone', () => {
  const rowOf = (name: string): HTMLElement => {
    const row = within(grid())
      .getAllByRole('rowheader')
      .find((cell) => cell.textContent === name)?.parentElement;
    if (row === undefined || row === null) throw new Error(`no row for ${name}`);
    return row;
  };
  const cellTexts = (): string[] =>
    within(grid())
      .getAllByRole('row')
      .map((row) => row.textContent);

  it('marks the row the screen names and no other', () => {
    renderWithProviders(<Harness rows={rowsOf(5)} columns={WHOSE} rowTone={isOwn} />);
    expect(grid().querySelectorAll('[data-tone]')).toHaveLength(1);
    expect(rowOf('keyword 002')).toHaveAttribute('data-tone', 'own');
    expect(rowOf('keyword 003')).not.toHaveAttribute('data-tone');
  });

  it('is visual only: every cell says the same with and without it, and the own row says "You" in words', () => {
    const { unmount } = renderWithProviders(<Harness rows={rowsOf(5)} columns={WHOSE} />);
    const plain = cellTexts();
    unmount();
    renderWithProviders(<Harness rows={rowsOf(5)} columns={WHOSE} rowTone={isOwn} />);
    expect(cellTexts()).toEqual(plain);
    expect(within(rowOf('keyword 002')).getByRole('gridcell', { name: 'You' })).toBeInTheDocument();
    expect(within(rowOf('keyword 003')).queryByRole('gridcell', { name: 'You' })).toBeNull();
  });

  it('leaves the arrow keys alone: ArrowDown moves from the own row to the next one', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} columns={WHOSE} rowTone={isOwn} />);
    const own = within(rowOf('keyword 002')).getByRole('rowheader');
    act(() => own.focus());
    await user.keyboard('{ArrowDown}');
    // Sorted by volume, high to low: keyword 002 is followed by keyword 000
    expect(document.activeElement).toBe(within(rowOf('keyword 000')).getByRole('rowheader'));
  });
});

describe('DataTable tree mode', () => {
  const TREE_ROWS: Row[] = [
    { id: 'g1', keyword: 'Group A', volume: 50, difficulty: 1 },
    { id: 'c1', keyword: 'alpha one', volume: 20, difficulty: 2 },
    { id: 'c2', keyword: 'alpha two', volume: 30, difficulty: 3 },
    { id: 'g2', keyword: 'Group B', volume: 90, difficulty: 4 },
  ];
  const TREE: Readonly<Record<string, RowTree>> = {
    g1: { level: 1, expanded: true, setSize: 2, posInSet: 1 },
    c1: { level: 2, setSize: 2, posInSet: 1 },
    c2: { level: 2, setSize: 2, posInSet: 2 },
    g2: { level: 1, expanded: false, setSize: 2, posInSet: 2 },
  };
  // Two open groups, and between them a "Show all" row that is no keyword
  const WIDE_ROWS: Row[] = [
    { id: 'g1', keyword: 'Group A', volume: 50, difficulty: 1 },
    { id: 'c1', keyword: 'alpha one', volume: 20, difficulty: 2 },
    { id: 'c2', keyword: 'alpha two', volume: 30, difficulty: 3 },
    { id: 'm1', keyword: 'Show all 9', volume: null, difficulty: 0 },
    { id: 'g2', keyword: 'Group B', volume: 90, difficulty: 4 },
    { id: 'd1', keyword: 'beta one', volume: 10, difficulty: 5 },
    { id: 'd2', keyword: 'beta two', volume: 40, difficulty: 6 },
  ];
  const WIDE: Readonly<Record<string, RowTree>> = {
    g1: { level: 1, expanded: true, setSize: 2, posInSet: 1 },
    c1: { level: 2, setSize: 3, posInSet: 1 },
    c2: { level: 2, setSize: 3, posInSet: 2 },
    m1: { level: 2, setSize: 3, posInSet: 3, selectable: false },
    g2: { level: 1, expanded: true, setSize: 2, posInSet: 2 },
    d1: { level: 2, setSize: 2, posInSet: 1 },
    d2: { level: 2, setSize: 2, posInSet: 2 },
  };
  const toggle = vi.fn<(row: Row) => void>();
  const BASE_SELECTION: Selection = {
    selectedIds: new Set(),
    onChange: vi.fn(),
    matchingTotal: null,
    allMatching: false,
    onAllMatchingChange: vi.fn(),
  };

  function TreeHarness({
    sort = [],
    selection = {},
    toolbarEnd,
    rows = TREE_ROWS,
    tree = TREE,
  }: {
    sort?: readonly SortKey[];
    selection?: Partial<Selection>;
    toolbarEnd?: ReactElement;
    rows?: Row[];
    tree?: Readonly<Record<string, RowTree>>;
  }): ReactElement {
    const [search, setSearch] = useState('');
    const [density, setDensity] = useState<Density>(parseDensity(null));
    return (
      <div className="flex h-200 flex-col">
        <DataTable<Row>
          caption="Keywords"
          itemNoun={{ one: 'keyword', other: 'keywords' }}
          columns={COLUMNS}
          getRowId={rowId}
          rows={rows}
          total={3}
          sort={sort}
          onSortChange={vi.fn()}
          defaultSort={DEFAULT_SORT}
          density={density}
          onDensityChange={setDensity}
          columnState={{ visible: null, onChange: vi.fn() }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search keywords"
          selection={{ ...BASE_SELECTION, ...selection }}
          rowName={keywordOf}
          onRowOpen={onOpen}
          rowTree={(row) => tree[row.id]}
          onToggleGroup={toggle}
          toolbarEnd={toolbarEnd}
          status="ready"
          errorState={<p>The keywords did not load.</p>}
          emptyState={<p>No keywords yet.</p>}
          filteredEmptyState={<p>No keywords match.</p>}
        />
      </div>
    );
  }

  const treeGrid = (): HTMLElement => screen.getByRole('treegrid', { name: 'Keywords' });
  const bodyRows = (): HTMLElement[] => within(treeGrid()).getAllByRole('row').slice(1);
  const cellAt = (row: number, column: number): HTMLElement => {
    const cell = treeGrid().querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(column)}"]`);
    if (cell === null) throw new Error(`No cell ${String(row)}:${String(column)}`);
    return cell;
  };
  const focusedCell = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset.cell;

  beforeEach(() => {
    toggle.mockReset();
  });

  it('is a treegrid whose group rows carry the level, set and expanded state, and whose children carry no expanded state', () => {
    renderWithProviders(<TreeHarness />);
    const [first, child, , second] = bodyRows();
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAttribute('aria-level', '1');
    expect(first).toHaveAttribute('aria-setsize', '2');
    expect(first).toHaveAttribute('aria-posinset', '1');
    expect(first).toHaveAttribute('data-group-row');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-posinset', '2');
    expect(child).toHaveAttribute('aria-level', '2');
    expect(child).toHaveAttribute('aria-setsize', '2');
    expect(child).not.toHaveAttribute('aria-expanded');
    expect(child).not.toHaveAttribute('data-group-row');
  });

  it('names the disclosure button of a group row by its state and name, and toggles the group from it', async () => {
    const { user } = renderWithProviders(<TreeHarness />);
    await user.click(screen.getByRole('button', { name: 'Collapse Group A' }));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g1' }));
    expect(screen.getByRole('button', { name: 'Expand Group B' })).toBeInTheDocument();
    expect(within(bodyRows()[1] as HTMLElement).queryByRole('button', { name: /(Expand|Collapse)/ })).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the rows in the order given, whatever the sort names', () => {
    renderWithProviders(<TreeHarness sort={[{ id: 'keyword', desc: true }]} />);
    expect(
      within(treeGrid())
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Group A', 'alpha one', 'alpha two', 'Group B']);
  });

  it('toggles a group row on a click and on Enter, and opens a child row as before', async () => {
    const { user } = renderWithProviders(<TreeHarness />);
    await user.click(within(bodyRows()[0] as HTMLElement).getByText('Group A'));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g1' }));
    expect(onOpen).not.toHaveBeenCalled();
    toggle.mockClear();
    act(() => cellAt(3, 1).focus());
    await user.keyboard('{Enter}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g2' }));
    expect(onOpen).not.toHaveBeenCalled();
    await user.click(within(bodyRows()[1] as HTMLElement).getByText('alpha one'));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'c1' }), 'inspector');
  });

  it('opens a collapsed group with Right Arrow and closes an expanded one with Left Arrow', async () => {
    // The selection column is cell 0 and the identity cell, which holds the disclosure button, is cell 1
    const { user } = renderWithProviders(<TreeHarness />);
    act(() => cellAt(3, 1).focus());
    // Left on a closed group row moves to the cell before it, as in a grid
    await user.keyboard('{ArrowLeft}');
    expect(toggle).not.toHaveBeenCalled();
    expect(focusedCell()).toBe('3:0');
    act(() => cellAt(3, 1).focus());
    await user.keyboard('{ArrowRight}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g2' }));
    toggle.mockClear();
    act(() => cellAt(0, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'g1' }));
  });

  it('moves from an expanded group to its first child with Right Arrow, and from a child to its group with Left Arrow', async () => {
    const { user } = renderWithProviders(<TreeHarness />);
    act(() => cellAt(0, 1).focus());
    await user.keyboard('{ArrowRight}');
    expect(toggle).not.toHaveBeenCalled();
    expect(focusedCell()).toBe('1:1');
    // On a child the arrows move between cells, except Left from its identity cell
    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toBe('1:2');
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('1:1');
    act(() => cellAt(2, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('0:1');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('moves between cells as in a grid from the selection cell and from the cells after the identity cell', async () => {
    const { user } = renderWithProviders(<TreeHarness />);
    act(() => cellAt(3, 0).focus());
    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toBe('3:1');
    expect(toggle).not.toHaveBeenCalled();
    act(() => cellAt(0, 0).focus());
    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toBe('0:1');
    expect(toggle).not.toHaveBeenCalled();
    act(() => cellAt(0, 2).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('0:1');
    expect(toggle).not.toHaveBeenCalled();
    // The checkbox cell of a row inside a group goes right and left as a grid does, not to the group row
    act(() => cellAt(2, 0).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('2:0');
  });

  it('puts focus on the group row when its rows go while focus is on one of them', () => {
    const { rerender } = renderWithProviders(<TreeHarness rows={WIDE_ROWS} tree={WIDE} />);
    act(() => cellAt(2, 1).focus());
    expect(cellAt(2, 1)).toHaveAttribute('tabindex', '0');
    const closed = WIDE_ROWS.filter((row) => row.id !== 'c1' && row.id !== 'c2' && row.id !== 'm1');
    rerender(
      <TreeHarness rows={closed} tree={{ ...WIDE, g1: { level: 1, expanded: false, setSize: 2, posInSet: 1 } }} />,
    );
    expect(cellAt(0, 1)).toHaveAttribute('tabindex', '0');
    expect(focusedCell()).toBe('0:1');
  });

  it('names the disclosure button with the label the caller gives, and keeps the row header named by the row', () => {
    renderWithProviders(
      <TreeHarness
        tree={{
          ...TREE,
          g1: { level: 1, expanded: true, setSize: 2, posInSet: 1, label: 'Collapse the Group A group' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Collapse the Group A group' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Group A' })).toBeInTheDocument();
  });

  it('draws the cells of a group row in the strong body type', () => {
    renderWithProviders(<TreeHarness />);
    expect(within(bodyRows()[0] as HTMLElement).getByRole('rowheader')).toHaveClass('type-body-strong');
    expect(within(bodyRows()[1] as HTMLElement).getByRole('rowheader')).not.toHaveClass('type-body-strong');
  });

  it('keeps Space selecting a group row', async () => {
    const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();
    const { user } = renderWithProviders(<TreeHarness selection={{ onChange }} />);
    act(() => cellAt(0, 0).focus());
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(new Set(['g1']));
    expect(toggle).not.toHaveBeenCalled();
  });

  it('has the header checkbox cover the group rows as well when the screen asks for it', async () => {
    const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();
    const { user, rerender } = renderWithProviders(<TreeHarness selection={{ onChange }} />);
    expect(screen.getByRole('checkbox', { name: 'Select all 2 keywords loaded' })).toBeInTheDocument();
    rerender(<TreeHarness selection={{ onChange, headerCoversGroups: true }} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(new Set(['g1', 'c1', 'c2', 'g2']));
  });

  it('has Clear call the screen own clear, and not change the selected ids, when it gives one', async () => {
    const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();
    const onClear = vi.fn<() => void>();
    const { user } = renderWithProviders(
      <TreeHarness selection={{ selectedIds: new Set(['c1']), selectedCount: 3, onChange, onClear }} />,
    );
    await user.click(within(bulkBar()).getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says in the bulk bar what the screen words the selection as, in place of the count of ids', () => {
    renderWithProviders(
      <TreeHarness
        selection={{ selectedIds: new Set(['g1']), selectedCount: 7, selectedLabel: '2 topics selected, 7 prompts' }}
      />,
    );
    expect(within(bulkBar()).getByText('2 topics selected, 7 prompts')).toBeInTheDocument();
    expect(within(bulkBar()).queryByText('7 selected')).toBeNull();
    expect(screen.getByRole('group', { name: 'Bulk actions, 2 topics selected, 7 prompts' })).toBeInTheDocument();
  });

  it('draws a group checkbox as mixed when its id is in indeterminateIds and checked when it is selected', () => {
    renderWithProviders(
      <TreeHarness selection={{ selectedIds: new Set(['g2']), indeterminateIds: new Set(['g1']) }} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select Group A' })).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByRole('checkbox', { name: 'Select Group B' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select alpha one' })).not.toBeChecked();
  });

  it('counts the chosen keywords in the bulk bar, and does not call the rows of closed groups hidden', () => {
    const hidden = new Set(['g1', 'c1', 'c2', 'x1', 'x2', 'x3', 'x4']);
    const { rerender } = renderWithProviders(
      <TreeHarness selection={{ selectedIds: new Set(['g1', 'c1', 'c2']), selectedCount: 7 }} />,
    );
    expect(within(bulkBar()).getByText('7 selected')).toBeInTheDocument();
    expect(within(bulkBar()).queryByText('3 selected')).toBeNull();
    rerender(<TreeHarness selection={{ selectedIds: hidden }} />);
    expect(within(bulkBar()).getByText(/4 selected rows are hidden by filters/)).toBeInTheDocument();
    rerender(<TreeHarness selection={{ selectedIds: hidden, unrenderedCount: 4 }} />);
    expect(within(bulkBar()).queryByText(/hidden by filters/)).toBeNull();
    rerender(<TreeHarness selection={{ selectedIds: hidden, unrenderedCount: 10 }} />);
    expect(within(bulkBar()).queryByText(/hidden by filters/)).toBeNull();
  });

  it('keeps the bulk bar while keywords are chosen only in closed groups, and Clear empties the selection', async () => {
    const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();
    const onAllMatchingChange = vi.fn<(allMatching: boolean) => void>();
    const { user } = renderWithProviders(
      <TreeHarness
        selection={{ selectedIds: new Set(), selectedCount: 3, unrenderedCount: 3, onChange, onAllMatchingChange }}
      />,
    );
    expect(within(bulkBar()).getByText('3 selected')).toBeInTheDocument();
    expect(within(bulkBar()).queryByText(/hidden by filters/)).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search in table' })).toBeNull();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Clear selection' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(new Set());
    expect(onAllMatchingChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('shows the toolbar when the count is 0, whatever ids the selection holds', () => {
    renderWithProviders(<TreeHarness selection={{ selectedIds: new Set(['x1']), selectedCount: 0 }} />);
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search in table' })).toBeInTheDocument();
  });

  it('renders toolbarEnd after the search field and before the density and column controls', () => {
    renderWithProviders(<TreeHarness toolbarEnd={<button type="button">By group</button>} />);
    const end = screen.getByRole('button', { name: 'By group' });
    const search = screen.getByRole('searchbox', { name: 'Search in table' });
    const controls = screen.getByRole('toolbar', { name: /Keywords/ });
    expect(search.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(end.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls).not.toContainElement(end);
  });

  it('wraps the toolbar on a narrow table: the switch and the controls drop to a second line together', () => {
    renderWithProviders(<TreeHarness toolbarEnd={<button type="button">By group</button>} />);
    const controls = screen.getByRole('toolbar', { name: /Keywords/ });
    const endGroup = controls.parentElement;
    expect(endGroup).toContainElement(screen.getByRole('button', { name: 'By group' }));
    expect(endGroup?.parentElement).toHaveClass('flex-wrap', 'min-h-12');
    // The search field may narrow to nothing rather than push the bar wider than the table
    expect(screen.getByRole('searchbox', { name: 'Search in table' }).closest('[data-slot="input-group"]')).toHaveClass(
      'min-w-0',
      'max-w-full',
    );
  });

  describe('selecting rows in a tree', () => {
    const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();
    beforeEach(() => {
      onChange.mockReset();
    });
    const renderWide = (selection: Partial<Selection> = {}) =>
      renderWithProviders(<TreeHarness rows={WIDE_ROWS} tree={WIDE} selection={{ onChange, ...selection }} />);

    it('draws no checkbox on a row that cannot be selected, and no selected state', () => {
      renderWide();
      expect(screen.queryByRole('checkbox', { name: 'Select Show all 9' })).toBeNull();
      expect(within(bodyRows()[3] as HTMLElement).queryByRole('checkbox')).toBeNull();
      expect(bodyRows()[3]).not.toHaveAttribute('aria-selected');
    });

    // A caller that keeps the selection, as the screens do: a click's change is read by the next click
    function StatefulTree(): ReactElement {
      const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
      return (
        <TreeHarness
          rows={WIDE_ROWS}
          tree={WIDE}
          selection={{
            selectedIds,
            onChange: (next) => {
              onChange(next);
              setSelectedIds(next);
            },
          }}
        />
      );
    }
    const checkedNames = (): (string | null)[] =>
      bodyRows()
        .filter((row) => within(row).queryByRole('checkbox', { checked: true }) !== null)
        .map((row) => within(row).getByRole('rowheader').textContent);

    it('extends a Shift click over the keywords between two groups, and over no group row or other row, in one change', async () => {
      const { user } = renderWithProviders(<StatefulTree />);
      await user.click(screen.getByRole('checkbox', { name: 'Select alpha one' }));
      await user.keyboard('{Shift>}');
      await user.click(screen.getByRole('checkbox', { name: 'Select beta two' }));
      await user.keyboard('{/Shift}');
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith(new Set(['c1', 'c2', 'd1', 'd2']));
      expect(checkedNames()).toEqual(['alpha one', 'alpha two', 'beta one', 'beta two']);
    });

    it('lets a group row checkbox toggle its own id, with or without Shift, in one change, and keeps the anchor', async () => {
      const { user } = renderWithProviders(<StatefulTree />);
      await user.click(screen.getByRole('checkbox', { name: 'Select alpha one' }));
      await user.keyboard('{Shift>}');
      await user.click(screen.getByRole('checkbox', { name: 'Select Group B' }));
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenLastCalledWith(new Set(['c1', 'g2']));
      // The anchor is still alpha one, so this range runs from it
      await user.click(screen.getByRole('checkbox', { name: 'Select alpha two' }));
      await user.keyboard('{/Shift}');
      expect(onChange).toHaveBeenCalledTimes(3);
      expect(onChange).toHaveBeenLastCalledWith(new Set(['c1', 'c2', 'g2']));
    });

    it('selects only the keyword rows from the header checkbox, and counts only them in its name', async () => {
      const { user } = renderWide();
      await user.click(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' }));
      expect(onChange).toHaveBeenLastCalledWith(new Set(['c1', 'c2', 'd1', 'd2']));
    });

    it('selects only the keyword rows with Ctrl+A', async () => {
      const { user } = renderWide();
      act(() => cellAt(1, 1).focus());
      await user.keyboard('{Control>}a{/Control}');
      expect(onChange).toHaveBeenLastCalledWith(new Set(['c1', 'c2', 'd1', 'd2']));
    });

    it('shows the header checked when every keyword row is selected, whatever the group and other rows', () => {
      const { unmount } = renderWide({ selectedIds: new Set(['c1', 'c2', 'd1', 'd2']) });
      expect(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' })).toBeChecked();
      unmount();
      renderWide({ selectedIds: new Set(['g1', 'g2', 'm1', 'c1', 'c2', 'd1']) });
      expect(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' })).toHaveAttribute(
        'aria-checked',
        'mixed',
      );
    });

    it('does not count the group rows chosen as keywords: the header is unchecked when only they are', () => {
      renderWide({ selectedIds: new Set(['g1', 'g2']) });
      expect(screen.getByRole('checkbox', { name: 'Select all 4 keywords loaded' })).not.toBeChecked();
    });

    it('does not select a row that cannot be selected with Space', async () => {
      const { user } = renderWide();
      act(() => cellAt(3, 1).focus());
      await user.keyboard(' ');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('announcing the count of its own', () => {
    const region = (): HTMLElement => {
      const element = document.getElementById('live-region-polite');
      if (element === null) throw new Error('No live region');
      return element;
    };

    it('announces the count when it changes, including when it falls to 0, and not when only the selection changes', async () => {
      const { rerender } = renderWithProviders(
        <TreeHarness selection={{ selectedIds: new Set(['c1']), selectedCount: 3 }} />,
      );
      expect(region().textContent).toBe('');
      rerender(<TreeHarness selection={{ selectedIds: new Set(['c1', 'c2']), selectedCount: 3 }} />);
      rerender(<TreeHarness selection={{ selectedIds: new Set(['c1', 'c2']), selectedCount: 5 }} />);
      await waitFor(() => expect(region()).toHaveTextContent('5 selected'));
      rerender(<TreeHarness selection={{ selectedIds: new Set(), selectedCount: 0 }} />);
      await waitFor(() => expect(region()).toHaveTextContent('0 selected'));
    });
  });

  describe('announcing the label of its own', () => {
    it('announces a new label when only the label changes and the count stays', async () => {
      const { rerender } = renderWithProviders(
        <TreeHarness
          selection={{ selectedIds: new Set(['g1']), selectedCount: 7, selectedLabel: '1 topic, 7 prompts' }}
        />,
      );
      const region = document.getElementById('live-region-polite');
      expect(region?.textContent).toBe('');
      rerender(
        <TreeHarness
          selection={{ selectedIds: new Set(['g1']), selectedCount: 7, selectedLabel: '2 topics, 7 prompts' }}
        />,
      );
      await waitFor(() => expect(region).toHaveTextContent('2 topics, 7 prompts'));
    });
  });

  it('passes the accessibility check', async () => {
    const { container } = renderWithProviders(<TreeHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DataTable column groups', () => {
  const ENGINE_A: ColumnGroup = { id: 'engine-a', label: 'Engine A' };
  const ENGINE_B: ColumnGroup = { id: 'engine-b', label: 'Engine B' };
  // No column has a tooltip here, so the header markup holds no generated ids that differ between two renders
  const columnsOf = (grouped: boolean): DataTableColumn<Row>[] => [
    col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
    col.volume<Row>('volume', (row) => row.volume, { header: 'Volume', group: grouped ? ENGINE_A : undefined }),
    col.count<Row>('difficulty', (row) => row.difficulty, { header: 'KD', group: grouped ? ENGINE_A : undefined }),
    col.count<Row>('rank', (row) => row.difficulty + 1, { header: 'Rank', group: grouped ? ENGINE_B : undefined }),
    col.count<Row>('score', (row) => row.difficulty + 2, { header: 'Score', group: grouped ? ENGINE_B : undefined }),
  ];
  const GROUPED = columnsOf(true);
  const SELECTION_STATE = { matchingTotal: null, allMatching: false, onAllMatchingChange: vi.fn() };

  function GroupHarness({
    rows = rowsOf(3),
    columns = GROUPED,
    columnGroups = true,
    server,
    status = 'ready',
  }: {
    rows?: Row[];
    columns?: readonly DataTableColumn<Row>[];
    columnGroups?: boolean;
    server?: ServerPaging;
    status?: TableStatus;
  }): ReactElement {
    const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
    const [visible, setVisible] = useState<readonly string[] | null>(null);
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    return (
      <div className="flex h-200 flex-col">
        <DataTable<Row>
          caption="Keywords"
          itemNoun={{ one: 'keyword', other: 'keywords' }}
          columns={columns}
          columnGroups={columnGroups}
          getRowId={rowId}
          rows={rows}
          total={server === undefined ? rows.length : 4812}
          server={server}
          sort={sort}
          onSortChange={setSort}
          defaultSort={DEFAULT_SORT}
          density="compact"
          onDensityChange={vi.fn()}
          columnState={{ visible, onChange: setVisible }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search keywords"
          searchText={keywordOf}
          selection={{ ...SELECTION_STATE, selectedIds: selected, onChange: setSelected }}
          rowActions={ACTIONS}
          rowName={keywordOf}
          onRowOpen={onOpen}
          status={status}
          errorState={<p>The keywords did not load.</p>}
          emptyState={<p>No keywords yet.</p>}
          filteredEmptyState={<p>No keywords match.</p>}
        />
      </div>
    );
  }

  const headerRowElements = (): HTMLElement[] => [...grid().querySelectorAll<HTMLElement>('thead tr')];
  const headerCell = (name: RegExp | string): HTMLElement => within(grid()).getByRole('columnheader', { name });
  /** The header markup without the attributes that carry generated ids. */
  const headMarkup = (): string =>
    (grid().querySelector('thead')?.innerHTML ?? '').replace(/ (?:id|for|aria-\w+)="[^"]*"/g, '');
  const cellOf = (row: number, column: number): HTMLElement => {
    const cell = grid().querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(column)}"]`);
    if (cell === null) throw new Error(`No cell ${String(row)}:${String(column)}`);
    return cell;
  };

  it('draws one header row when columns have groups but columnGroups is off', () => {
    const { unmount } = renderWithProviders(<GroupHarness columns={GROUPED} columnGroups={false} />);
    const withGroups = headMarkup();
    expect(headerRowElements()).toHaveLength(1);
    expect(headerRowElements()[0]).toHaveClass('h-row-header');
    expect(screen.queryByRole('columnheader', { name: 'Engine A' })).toBeNull();
    unmount();
    renderWithProviders(<GroupHarness columns={columnsOf(false)} columnGroups={false} />);
    expect(headMarkup()).toBe(withGroups);
  });

  it('draws a group cell with colSpan over its columns and one sortable header per column', async () => {
    const { user } = renderWithProviders(<GroupHarness />);
    const engineA = headerCell('Engine A');
    expect(engineA).toHaveAttribute('colspan', '2');
    expect(engineA).toHaveAttribute('scope', 'colgroup');
    expect(engineA).toHaveClass('h-6');
    expect(headerCell('Engine B')).toHaveAttribute('colspan', '2');
    // A group cell is static text: no tab stop, no sort, no options menu
    expect(engineA).not.toHaveAttribute('tabindex');
    expect(engineA).not.toHaveAttribute('data-cell');
    expect(within(engineA).queryByRole('button')).toBeNull();
    // Columns under a group have their own header in the second row; the others span both rows
    const [first, second] = headerRowElements();
    expect(first).toContainElement(engineA);
    expect(second).toContainElement(headerCell(/^Volume/));
    expect(second).toContainElement(headerCell(/^KD/));
    expect(second).toContainElement(headerCell(/^Score/));
    expect(first).toContainElement(headerCell(/^Keyword/));
    for (const name of [/^Keyword/, /^Actions/]) expect(headerCell(name)).toHaveAttribute('rowspan', '2');
    expect(cellOf(-1, 0)).toHaveAttribute('rowspan', '2');
    expect(headerCell(/^Volume/)).not.toHaveAttribute('rowspan');
    // One sortable header per column
    expect(headerCell(/^KD/)).not.toHaveAttribute('aria-sort');
    await user.click(within(headerCell(/^KD/)).getByRole('button', { name: 'KD' }));
    expect(headerCell(/^KD/)).toHaveAttribute('aria-sort');
    expect(headerCell(/^Volume/)).not.toHaveAttribute('aria-sort');
  });

  it('numbers header rows 1 and 2, body rows from 3, and counts both in aria-rowcount (client and server mode)', () => {
    const { unmount } = renderWithProviders(<GroupHarness rows={rowsOf(3)} />);
    expect(grid()).toHaveAttribute('aria-rowcount', '5');
    const rows = within(grid()).getAllByRole('row');
    expect(rows.map((row) => row.getAttribute('aria-rowindex'))).toEqual(['1', '2', '3', '4', '5']);
    unmount();
    const server = renderWithProviders(<GroupHarness rows={rowsOf(3)} server={SERVER_PAGE} />);
    expect(grid()).toHaveAttribute('aria-rowcount', '4814');
    expect(within(grid()).getAllByRole('row')[2]).toHaveAttribute('aria-rowindex', '203');
    server.unmount();
    // A message in the body is the row after both header rows
    renderWithProviders(<GroupHarness rows={[]} status="empty" />);
    expect(grid()).toHaveAttribute('aria-rowcount', '3');
    expect(within(grid()).getAllByRole('row')[2]).toHaveAttribute('aria-rowindex', '3');
  });

  it("collapses a group to the column's own tall header when the chooser hides all but one of its columns", async () => {
    const { user } = renderWithProviders(<GroupHarness />);
    await user.click(screen.getByRole('button', { name: 'KD column options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide column' }));
    expect(screen.queryByRole('columnheader', { name: 'Engine A' })).toBeNull();
    expect(headerCell(/^Volume/)).toHaveAttribute('rowspan', '2');
    expect(headerRowElements()[0]).toContainElement(headerCell(/^Volume/));
    // The other group still spans, so two header rows remain
    expect(headerCell('Engine B')).toHaveAttribute('colspan', '2');
    expect(headerRowElements()).toHaveLength(2);
    expect(grid()).toHaveAttribute('aria-rowcount', '5');
  });

  it('keeps one header row when every group has one shown column', () => {
    const lone = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.volume<Row>('volume', (row) => row.volume, { header: 'Volume', group: ENGINE_A }),
      col.count<Row>('rank', (row) => row.difficulty + 1, { header: 'Rank', group: ENGINE_B }),
    ];
    renderWithProviders(<GroupHarness columns={lone} />);
    expect(headerRowElements()).toHaveLength(1);
    expect(headerRowElements()[0]).toHaveClass('h-row-header');
    expect(screen.queryByRole('columnheader', { name: 'Engine A' })).toBeNull();
    expect(grid().querySelector('[rowspan]')).toBeNull();
    expect(grid()).toHaveAttribute('aria-rowcount', '4');
    expect(within(grid()).getAllByRole('row')[1]).toHaveAttribute('aria-rowindex', '2');
  });

  it('keeps roving focus on the leaf header row: ArrowUp from the first body row lands on a column header and Enter sorts', async () => {
    const { user } = renderWithProviders(<GroupHarness />);
    expect(headerCell('Engine A')).toBeInTheDocument();
    act(() => cellOf(0, 3).focus());
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(headerCell(/^KD/));
    expect((document.activeElement as HTMLElement).dataset.cell).toBe('-1:3');
    await user.keyboard('{Enter}');
    expect(headerCell(/^KD/)).toHaveAttribute('aria-sort');
    // The group cell is not in the tab order: the one tab stop is on a leaf header
    expect(grid().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("sets the leaf header's sticky offset below the group row and leaves rowWindow math in step (page keys move by the same rows)", async () => {
    class TallObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback(
          [{ target, contentRect: { width: 1600, height: 520 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', TallObserver);
    const { user, unmount } = renderWithProviders(<GroupHarness rows={rowsOf(40)} />);
    expect(headerCell('Engine A')).toHaveClass('top-0');
    expect(headerCell(/^Volume/)).toHaveClass('top-6');
    expect(headerCell(/^Keyword/)).toHaveClass('top-0');
    // A 520 px view shows 15 rows under a 40 px header and 14 under the 64 px two row header; a page key moves one less
    act(() => cellOf(0, 1).focus());
    await user.keyboard('{PageDown}');
    expect((document.activeElement as HTMLElement).dataset.cell).toBe('13:1');
    unmount();
    renderWithProviders(<GroupHarness rows={rowsOf(40)} columnGroups={false} />);
    act(() => cellOf(0, 1).focus());
    await user.keyboard('{PageDown}');
    expect((document.activeElement as HTMLElement).dataset.cell).toBe('14:1');
  });

  it('puts no aria-colindex on any cell', () => {
    renderWithProviders(<GroupHarness />);
    expect(grid().querySelector('[aria-colindex]')).toBeNull();
    expect(grid()).not.toHaveAttribute('aria-colcount');
  });

  it('passes the accessibility check with groups', async () => {
    const { container } = renderWithProviders(<GroupHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DataTable tree mode, third level', () => {
  // A topic, its subtopics (one open, one closed), a plain row at level 2, and a second topic
  const ROWS3: Row[] = [
    { id: 't1', keyword: 'Topic A', volume: 50, difficulty: 1 },
    { id: 's1', keyword: 'Sub A1', volume: 30, difficulty: 2 },
    { id: 'p1', keyword: 'prompt one', volume: 20, difficulty: 3 },
    { id: 'p2', keyword: 'prompt two', volume: 10, difficulty: 4 },
    { id: 's2', keyword: 'Sub A2', volume: 15, difficulty: 5 },
    { id: 'l1', keyword: 'Plain A3', volume: 5, difficulty: 6 },
    { id: 't2', keyword: 'Topic B', volume: 40, difficulty: 7 },
  ];
  const TREE3: Readonly<Record<string, RowTree>> = {
    t1: { level: 1, expanded: true, setSize: 2, posInSet: 1 },
    s1: { level: 2, expanded: true, setSize: 3, posInSet: 1 },
    p1: { level: 3, setSize: 2, posInSet: 1 },
    p2: { level: 3, setSize: 2, posInSet: 2 },
    s2: { level: 2, expanded: false, setSize: 3, posInSet: 2 },
    l1: { level: 2, setSize: 3, posInSet: 3 },
    t2: { level: 1, expanded: false, setSize: 2, posInSet: 2 },
  };
  const toggle = vi.fn<(row: Row) => void>();
  const onChange = vi.fn<(ids: ReadonlySet<string>) => void>();

  function ThreeHarness({
    rows = ROWS3,
    tree = TREE3,
    selection = {},
  }: {
    rows?: Row[];
    tree?: Readonly<Record<string, RowTree>>;
    selection?: Partial<Selection>;
  }): ReactElement {
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
    return (
      <div className="flex h-200 flex-col">
        <DataTable<Row>
          caption="Keywords"
          itemNoun={{ one: 'keyword', other: 'keywords' }}
          columns={COLUMNS}
          getRowId={rowId}
          rows={rows}
          total={rows.length}
          sort={[]}
          onSortChange={vi.fn()}
          defaultSort={DEFAULT_SORT}
          density="compact"
          onDensityChange={vi.fn()}
          columnState={{ visible: null, onChange: vi.fn() }}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search keywords"
          selection={{
            selectedIds,
            onChange: (next) => {
              onChange(next);
              setSelectedIds(next);
            },
            matchingTotal: null,
            allMatching: false,
            onAllMatchingChange: vi.fn(),
            ...selection,
          }}
          rowName={keywordOf}
          onRowOpen={onOpen}
          rowTree={(row) => tree[row.id]}
          onToggleGroup={toggle}
          status="ready"
          errorState={<p>The keywords did not load.</p>}
          emptyState={<p>No keywords yet.</p>}
          filteredEmptyState={<p>No keywords match.</p>}
        />
      </div>
    );
  }

  const treeGrid = (): HTMLElement => screen.getByRole('treegrid', { name: 'Keywords' });
  const bodyRows = (): HTMLElement[] => within(treeGrid()).getAllByRole('row').slice(1);
  const rowOf = (id: string): HTMLElement => {
    const index = ROWS3.findIndex((row) => row.id === id);
    const row = bodyRows()[index];
    if (row === undefined) throw new Error(`No row ${id}`);
    return row;
  };
  const cellAt = (row: number, column: number): HTMLElement => {
    const cell = treeGrid().querySelector<HTMLElement>(`[data-cell="${String(row)}:${String(column)}"]`);
    if (cell === null) throw new Error(`No cell ${String(row)}:${String(column)}`);
    return cell;
  };
  const focusedCell = (): string | undefined => (document.activeElement as HTMLElement | null)?.dataset.cell;
  const headerOf = (id: string): HTMLElement => within(rowOf(id)).getByRole('rowheader');

  beforeEach(() => {
    toggle.mockReset();
    onChange.mockReset();
  });

  it('sets aria-level 3 with its own setsize and posinset, aria-expanded on level 2 groups only, and ignores expanded on level 3', () => {
    renderWithProviders(
      <ThreeHarness tree={{ ...TREE3, p1: { level: 3, expanded: true, setSize: 2, posInSet: 1 } }} />,
    );
    expect(rowOf('p1')).toHaveAttribute('aria-level', '3');
    expect(rowOf('p1')).toHaveAttribute('aria-setsize', '2');
    expect(rowOf('p2')).toHaveAttribute('aria-posinset', '2');
    expect(rowOf('p1')).not.toHaveAttribute('aria-expanded');
    expect(rowOf('p1')).not.toHaveAttribute('data-group-row');
    expect(within(rowOf('p1')).queryByRole('button', { name: /(Expand|Collapse)/ })).toBeNull();
    expect(rowOf('s1')).toHaveAttribute('aria-level', '2');
    expect(rowOf('s1')).toHaveAttribute('aria-expanded', 'true');
    expect(rowOf('s1')).toHaveAttribute('data-group-row');
    expect(rowOf('s2')).toHaveAttribute('aria-expanded', 'false');
    expect(rowOf('l1')).not.toHaveAttribute('aria-expanded');
    expect(rowOf('t1')).toHaveAttribute('aria-level', '1');
  });

  it('draws a level 2 group row as a band with a disclosure button, in the strong body type', async () => {
    const { user } = renderWithProviders(<ThreeHarness />);
    expect(headerOf('s1')).toHaveClass('type-body-strong', 'bg-surface-subtle');
    expect(headerOf('l1')).not.toHaveClass('type-body-strong');
    await user.click(screen.getByRole('button', { name: 'Collapse Sub A1' }));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 's1' }));
    expect(screen.getByRole('button', { name: 'Expand Sub A2' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('toggles a level 2 group on click, Enter and Right and Left Arrow, calling onToggleGroup with that row', async () => {
    const { user } = renderWithProviders(<ThreeHarness />);
    await user.click(within(rowOf('s1')).getByText('Sub A1'));
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 's1' }));
    expect(onOpen).not.toHaveBeenCalled();
    toggle.mockClear();
    act(() => cellAt(4, 1).focus());
    await user.keyboard('{Enter}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 's2' }));
    toggle.mockClear();
    await user.keyboard('{ArrowRight}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 's2' }));
    toggle.mockClear();
    act(() => cellAt(1, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(toggle).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 's1' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('moves Right from an open level 2 group to its first level 3 row and Left from level 3 to the level 2 parent, not the level 1 group', async () => {
    const { user } = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(1, 1).focus());
    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toBe('2:1');
    expect(toggle).not.toHaveBeenCalled();
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('1:1');
    act(() => cellAt(3, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('1:1');
    // The level 1 group still moves into its first row, which is the level 2 group
    act(() => cellAt(0, 1).focus());
    await user.keyboard('{ArrowRight}');
    expect(focusedCell()).toBe('1:1');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('moves Left from a closed level 2 group to its level 1 parent and from a closed level 1 group one cell left', async () => {
    const { user } = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(4, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('0:1');
    act(() => cellAt(5, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('0:1');
    act(() => cellAt(6, 1).focus());
    await user.keyboard('{ArrowLeft}');
    expect(focusedCell()).toBe('6:0');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('hands focus to the level 2 group when it closes under a focused level 3 row, and to the level 1 group when that one closes', () => {
    const { rerender } = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(2, 1).focus());
    expect(cellAt(2, 1)).toHaveAttribute('tabindex', '0');
    const withoutPrompts = ROWS3.filter((row) => row.id !== 'p1' && row.id !== 'p2');
    rerender(
      <ThreeHarness
        rows={withoutPrompts}
        tree={{ ...TREE3, s1: { level: 2, expanded: false, setSize: 3, posInSet: 1 } }}
      />,
    );
    expect(cellAt(1, 1)).toHaveAttribute('tabindex', '0');
    expect(focusedCell()).toBe('1:1');
  });

  it('hands focus to the level 1 group when its level 2 and level 3 rows go, and to the row at that place when every ancestor went', () => {
    const { rerender, unmount } = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(2, 1).focus());
    const onlyTopics = ROWS3.filter((row) => row.id === 't1' || row.id === 't2');
    rerender(
      <ThreeHarness
        rows={onlyTopics}
        tree={{ ...TREE3, t1: { level: 1, expanded: false, setSize: 2, posInSet: 1 } }}
      />,
    );
    expect(cellAt(0, 1)).toHaveAttribute('tabindex', '0');
    expect(focusedCell()).toBe('0:1');
    unmount();
    const other = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(2, 1).focus());
    const fresh: Row[] = ['x0', 'x1', 'x2'].map((id) => ({ id, keyword: id, volume: 1, difficulty: 1 }));
    const freshTree: Record<string, RowTree> = Object.fromEntries(
      fresh.map((row, index) => [row.id, { level: 1, setSize: 3, posInSet: index + 1 } satisfies RowTree]),
    );
    other.rerender(<ThreeHarness rows={fresh} tree={freshTree} />);
    expect(cellAt(2, 1)).toHaveAttribute('tabindex', '0');
    expect(focusedCell()).toBe('2:1');
  });

  it('selects level 3 rows with a Shift range, the header checkbox and Ctrl+A, and leaves level 2 group rows out unless headerCoversGroups', async () => {
    const { user, unmount } = renderWithProviders(<ThreeHarness />);
    await user.click(screen.getByRole('checkbox', { name: 'Select prompt one' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Plain A3' }));
    await user.keyboard('{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith(new Set(['p1', 'p2', 'l1']));
    unmount();
    onChange.mockClear();
    const header = renderWithProviders(<ThreeHarness />);
    await header.user.click(screen.getByRole('checkbox', { name: 'Select all 3 keywords loaded' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(['p1', 'p2', 'l1']));
    header.unmount();
    onChange.mockClear();
    const keys = renderWithProviders(<ThreeHarness />);
    act(() => cellAt(2, 1).focus());
    await keys.user.keyboard('{Control>}a{/Control}');
    expect(onChange).toHaveBeenLastCalledWith(new Set(['p1', 'p2', 'l1']));
    keys.unmount();
    onChange.mockClear();
    const groups = renderWithProviders(<ThreeHarness selection={{ headerCoversGroups: true }} />);
    await groups.user.click(screen.getByRole('checkbox', { name: 'Select all 7 keywords loaded' }));
    expect(onChange).toHaveBeenLastCalledWith(new Set(ROWS3.map((row) => row.id)));
  });

  it('gives an indeterminate level 2 group checkbox from indeterminateIds', () => {
    renderWithProviders(
      <ThreeHarness selection={{ selectedIds: new Set(['s2']), indeterminateIds: new Set(['s1']) }} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select Sub A1' })).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByRole('checkbox', { name: 'Select Sub A2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select prompt one' })).not.toBeChecked();
  });

  it('indents with no spacer in a two level tree, with the spacer on level 3 and on level 2 leaves once a level 2 group exists', () => {
    const twoLevels: Readonly<Record<string, RowTree>> = {
      t1: { level: 1, expanded: true, setSize: 1, posInSet: 1 },
      s1: { level: 2, setSize: 4, posInSet: 1 },
      p1: { level: 2, setSize: 4, posInSet: 2 },
      p2: { level: 2, setSize: 4, posInSet: 3 },
      s2: { level: 2, setSize: 4, posInSet: 4 },
    };
    const { unmount } = renderWithProviders(<ThreeHarness rows={ROWS3.slice(0, 5)} tree={{ ...twoLevels }} />);
    expect(treeGrid().querySelector('[data-tree-spacer]')).toBeNull();
    expect(headerOf('s1')).toHaveClass('pl-10');
    expect(headerOf('t1')).not.toHaveClass('pl-10');
    unmount();
    renderWithProviders(<ThreeHarness />);
    // Level 3 and the level 2 leaf line up under the text of a level 2 group: both have the spacer
    expect(headerOf('p1')).toHaveClass('pl-10');
    expect(headerOf('p1').querySelector('[data-tree-spacer]')).not.toBeNull();
    expect(headerOf('l1')).toHaveClass('pl-10');
    expect(headerOf('l1').querySelector('[data-tree-spacer]')).not.toBeNull();
    expect(headerOf('s1').querySelector('[data-tree-spacer]')).toBeNull();
    expect(headerOf('t1').querySelector('[data-tree-spacer]')).toBeNull();
    expect(headerOf('p1').querySelector('[data-tree-spacer]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives level 3 the spacer and level 2 leaves none while no level 2 row is a group', () => {
    const noGroups: Readonly<Record<string, RowTree>> = {
      ...TREE3,
      s1: { level: 2, setSize: 3, posInSet: 1 },
      s2: { level: 2, setSize: 3, posInSet: 2 },
    };
    renderWithProviders(<ThreeHarness tree={noGroups} />);
    expect(headerOf('p1').querySelector('[data-tree-spacer]')).not.toBeNull();
    expect(headerOf('l1').querySelector('[data-tree-spacer]')).toBeNull();
    expect(headerOf('s1').querySelector('[data-tree-spacer]')).toBeNull();
  });

  it('counts every rendered row in aria-rowcount and numbers aria-rowindex across three levels', () => {
    renderWithProviders(<ThreeHarness />);
    expect(treeGrid()).toHaveAttribute('aria-rowcount', '8');
    expect(
      within(treeGrid())
        .getAllByRole('row')
        .map((row) => row.getAttribute('aria-rowindex')),
    ).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('passes the accessibility check with three levels', async () => {
    const { container } = renderWithProviders(<ThreeHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DataTable pinned actions column', () => {
  const PIN_CLASSES = ['right-0', 'border-l', 'border-l-border', 'z-(--z-sticky)'];
  const actionsHeader = (): HTMLElement => within(grid()).getByRole('columnheader', { name: 'Actions' });
  const actionCells = (): HTMLElement[] =>
    within(grid())
      .getAllByRole('gridcell')
      .filter((cell) => cell.classList.contains('text-right'));
  const scrollRegion = (): HTMLElement => {
    const element = grid().parentElement;
    if (element === null) throw new Error('The grid has no scroll region');
    return element;
  };
  /** The region as a browser lays it out (jsdom has no layout), scrolled to `left`, then the scroll event. */
  const scrollTo = (left: number, scrollWidth = 1000, clientWidth = 700): void => {
    const element = scrollRegion();
    Object.defineProperty(element, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(element, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(element, 'scrollLeft', { value: left, configurable: true });
    fireEvent.scroll(element);
  };
  const hasEdge = (element: HTMLElement): boolean =>
    element.classList.contains('border-l') && element.classList.contains('border-l-border');

  // The three columns of the harness need 448 px at their narrowest, so these regions are narrower than the table
  it('leaves the actions column static unless pinActions is set', () => {
    regionWidth = 400;
    renderWithProviders(<Harness rows={rowsOf(3)} />);
    scrollTo(0);
    // Every header cell is sticky at the top already; only the right pin and its edge are new
    for (const name of PIN_CLASSES) expect(actionsHeader()).not.toHaveClass(name);
    expect(actionsHeader()).toHaveClass('z-(--z-table-header)');
    expect(actionCells()).toHaveLength(3);
    for (const cell of actionCells()) {
      for (const name of ['sticky', ...PIN_CLASSES]) expect(cell).not.toHaveClass(name);
      expect(cell.className).not.toMatch(/z-\(--z-(sticky|pinned-cell)\)/);
    }
  });

  it('pins the actions header and cells to the right edge with the right z-index tokens', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    expect(actionsHeader()).toHaveClass('sticky', 'right-0', 'top-0', 'z-(--z-sticky)');
    expect(actionCells()).toHaveLength(3);
    for (const cell of actionCells()) expect(cell).toHaveClass('sticky', 'right-0', 'z-(--z-pinned-cell)');
    // The other columns are not pinned on the right
    for (const header of within(grid()).getAllByRole('columnheader')) {
      if (header !== actionsHeader()) expect(header).not.toHaveClass('right-0');
    }
  });

  it('draws the pinned edge only while columns are hidden behind it: overflowing and not at the end, none when the table fits or after scrolling to the end', () => {
    regionWidth = 400;
    renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    scrollTo(0);
    for (const cell of [actionsHeader(), ...actionCells()]) expect(hasEdge(cell)).toBe(true);
    // Columns before the actions column carry no edge of their own
    const keywordHeader = within(grid()).getByRole('columnheader', { name: /^Keyword/ });
    expect(keywordHeader).not.toHaveClass('border-l');
    scrollTo(150);
    for (const cell of [actionsHeader(), ...actionCells()]) expect(hasEdge(cell)).toBe(true);
    // Scrolled to the end (scrollWidth 1000, clientWidth 700): nothing is behind the pin
    scrollTo(300);
    for (const cell of [actionsHeader(), ...actionCells()]) expect(hasEdge(cell)).toBe(false);
    scrollTo(100);
    for (const cell of [actionsHeader(), ...actionCells()]) expect(hasEdge(cell)).toBe(true);
  });

  it('draws no edge when the table fits the region', () => {
    renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    scrollTo(0, 1600, 1600);
    for (const cell of [actionsHeader(), ...actionCells()]) expect(hasEdge(cell)).toBe(false);
  });

  it('re-renders only when the edge flips, not on every scroll event', () => {
    regionWidth = 300;
    const getVolume = vi.fn((row: Row) => row.volume);
    const columns = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.volume<Row>('volume', getVolume, { header: 'Volume', priority: 2 }),
    ];
    renderWithProviders(<Harness rows={rowsOf(3)} columns={columns} pinActions />);
    scrollTo(0);
    // The first no-change update may still be rendered once before React bails out
    scrollTo(20);
    const rendered = getVolume.mock.calls.length;
    scrollTo(60);
    scrollTo(120);
    scrollTo(200);
    expect(getVolume).toHaveBeenCalledTimes(rendered);
    // The flip at the end is a render
    scrollTo(300);
    expect(getVolume.mock.calls.length).toBeGreaterThan(rendered);
  });

  it('keeps the left pin and the right pin together: selection cell left 0, identity left 40, actions right 0 at a 1280 wide region', () => {
    regionWidth = 1280;
    renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    const headers = within(grid()).getAllByRole('columnheader');
    expect(headers[0]?.style.left).toBe('0px');
    expect(within(grid()).getByRole('columnheader', { name: /^Keyword/ }).style.left).toBe('40px');
    expect(actionsHeader()).toHaveClass('right-0');
    expect(actionsHeader().style.left).toBe('');
    const [firstRow] = within(grid()).getAllByRole('row').slice(1);
    if (firstRow === undefined) throw new Error('no row');
    const cells = within(firstRow).getAllByRole('gridcell');
    expect(cells[0]?.style.left).toBe('0px');
    expect(within(firstRow).getByRole('rowheader').style.left).toBe('40px');
    expect(cells.at(-1)).toHaveClass('right-0');
    expect(cells.at(-1)?.style.left).toBe('');
  });

  it('works under two header rows: the cell spans both, at the top', () => {
    const group: ColumnGroup = { id: 'engine', label: 'Engine' };
    const columns = [
      col.keyword<Row>('keyword', (row) => row.keyword, { header: 'Keyword' }),
      col.volume<Row>('volume', (row) => row.volume, { header: 'Volume', group }),
      col.count<Row>('difficulty', (row) => row.difficulty, { header: 'KD', group }),
    ];
    renderWithProviders(<Harness rows={rowsOf(3)} columns={columns} columnGroups pinActions />);
    const headerRows = grid().querySelectorAll('thead tr');
    expect(headerRows).toHaveLength(2);
    expect(actionsHeader()).toHaveAttribute('rowspan', '2');
    expect(actionsHeader()).toHaveClass('sticky', 'right-0', 'top-0', 'z-(--z-sticky)');
    expect(headerRows[0]?.contains(actionsHeader())).toBe(true);
    expect(headerRows[1]?.contains(actionsHeader())).toBe(false);
  });

  it('changes nothing about row height in either density: the pin only adds its own classes to the actions cells', () => {
    const rowClasses = (): string[] =>
      within(grid())
        .getAllByRole('row')
        .map((row) => row.className);
    const actionClasses = (): string[] => [actionsHeader(), ...actionCells()].map((cell) => cell.className);
    const added = new Set(['sticky', 'right-0', 'z-(--z-sticky)', 'z-(--z-pinned-cell)']);
    for (const startDensity of ['compact', 'default'] as const) {
      const plain = renderWithProviders(<Harness rows={rowsOf(3)} startDensity={startDensity} />);
      const rowsBefore = rowClasses();
      const actionsBefore = actionClasses();
      plain.unmount();
      const pinned = renderWithProviders(<Harness rows={rowsOf(3)} startDensity={startDensity} pinActions />);
      expect(rowClasses()).toEqual(rowsBefore);
      const rowHeight = startDensity === 'compact' ? 'h-row-compact' : 'h-row';
      for (const row of within(grid()).getAllByRole('row').slice(1)) expect(row).toHaveClass(rowHeight);
      actionClasses().forEach((pinned, index) => {
        const before = new Set((actionsBefore[index] ?? '').split(' '));
        const extra = pinned.split(' ').filter((name) => !before.has(name));
        // Only the pin's own classes: no height, padding or line-height of its own
        expect(extra.filter((name) => !added.has(name))).toEqual([]);
      });
      pinned.unmount();
    }
  });

  it('opens the row menu with Shift+F10 from the pinned cell and returns focus to the pinned cell', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    const cell = actionCells()[0];
    if (cell === undefined) throw new Error('no actions cell');
    act(() => cell.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Open' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(cell);
    });
  });

  it('passes the accessibility check', async () => {
    regionWidth = 400;
    const { container } = renderWithProviders(<Harness rows={rowsOf(3)} pinActions />);
    scrollTo(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('DataTable server paging and Select all N matching', () => {
  const PAGE_ONE = rowsOf(200).slice(0, 100);
  const PAGE_TWO = rowsOf(200).slice(100);
  const SERVER_ONE: ServerPaging = { ...SERVER_PAGE, offset: 0, hasPrevious: false };
  const SERVER_TWO: ServerPaging = { ...SERVER_PAGE, offset: 100 };
  const ALL_ON_PAGE = 'Select all 100 keywords loaded';
  const ANNOUNCEMENT = 'All 4,812 matching keywords selected. Bulk actions apply to all of them.';
  const offerOf = (): HTMLElement | null => within(bulkBar()).queryByRole('button', { name: /matching$/ });
  const liveRegion = (): HTMLElement => {
    const element = document.getElementById('live-region-polite');
    if (element === null) throw new Error('No live region');
    return element;
  };

  it('keeps the selection across server pages: ids from page 1 stay selected on page 2, the bar says so', async () => {
    const { user, rerender } = renderWithProviders(<Harness rows={PAGE_ONE} server={SERVER_ONE} />);
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    expect(within(bulkBar()).getByText('100 selected')).toBeInTheDocument();
    rerender(<Harness rows={PAGE_TWO} server={SERVER_TWO} />);
    expect(within(bulkBar()).getByText('100 selected')).toBeInTheDocument();
    expect(within(bulkBar()).getByText('100 selected rows are on other pages')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ALL_ON_PAGE })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    // Page 1's ids are still on another page, so the bar still says so
    expect(within(bulkBar()).getByText('200 selected')).toBeInTheDocument();
    expect(within(bulkBar()).getByText('100 selected rows are on other pages')).toBeInTheDocument();
  });

  it('offers all matching from a server page once every row of that page is selected, and the header checkbox stays checked on the next page while all matching is on', async () => {
    const { user, rerender } = renderWithProviders(
      <Harness rows={PAGE_ONE} server={SERVER_ONE} matchingTotal={4812} />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 000' }));
    expect(offerOf()).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    expect(within(bulkBar()).getByText('All 4,812 matching selected')).toBeInTheDocument();
    rerender(<Harness rows={PAGE_TWO} server={SERVER_TWO} matchingTotal={4812} />);
    expect(screen.getByRole('checkbox', { name: ALL_ON_PAGE })).toBeChecked();
    expect(within(bulkBar()).getByText('All 4,812 matching selected')).toBeInTheDocument();
    expect(within(bulkBar()).queryByText(/on other pages/)).toBeNull();
    expect(offerOf()).toBeNull();
  });

  it('announces that every matching keyword is selected, once', async () => {
    const spoken: string[] = [];
    const observer = new MutationObserver(() => {
      if (liveRegion().textContent === ANNOUNCEMENT) spoken.push(ANNOUNCEMENT);
    });
    const { user, rerender } = renderWithProviders(
      <Harness rows={PAGE_ONE} server={SERVER_ONE} matchingTotal={4812} />,
    );
    observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true });
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    await waitFor(() => expect(liveRegion()).toHaveTextContent(ANNOUNCEMENT));
    rerender(<Harness rows={PAGE_TWO} server={SERVER_TWO} matchingTotal={4812} />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    observer.disconnect();
    expect(spoken).toEqual([ANNOUNCEMENT]);
  });

  it('sends the filters, not ids: the action gets allMatching true across a page change', async () => {
    const { user, rerender } = renderWithProviders(
      <Harness rows={PAGE_ONE} server={SERVER_ONE} matchingTotal={4812} />,
    );
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    rerender(<Harness rows={PAGE_TWO} server={SERVER_TWO} matchingTotal={4812} />);
    await user.click(within(bulkBar()).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ allMatching: true }));
  });

  it('keeps Select all N matching out of reach while matchingTotal is null (unknown total)', async () => {
    const { user } = renderWithProviders(<Harness rows={PAGE_ONE} server={SERVER_ONE} matchingTotal={null} />);
    await user.click(screen.getByRole('checkbox', { name: ALL_ON_PAGE }));
    expect(within(bulkBar()).getByText('100 selected')).toBeInTheDocument();
    expect(offerOf()).toBeNull();
  });

  it('keeps focus in the bulk bar after Select all N matching', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    expect(offerOf()).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(bulkBar()).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    expect(document.activeElement).toHaveTextContent('All 4,812 matching selected');
    // A way to focus the count, not a tab stop of its own
    expect(document.activeElement).toHaveAttribute('tabindex', '-1');
  });

  it('does not offer all matching while a search in memory narrows the loaded rows (client mode)', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), '003');
    await user.click(screen.getByRole('checkbox', { name: 'Select all 1 keyword loaded' }));
    expect(within(bulkBar()).getByText('1 selected')).toBeInTheDocument();
    expect(offerOf()).toBeNull();
  });

  it('leaves all matching out of an action while a search set from outside narrows the list, and takes it back when the search clears', async () => {
    const { user, rerender } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} search="" />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' }));
    await user.click(within(bulkBar()).getByRole('button', { name: 'Select all 4,812 matching' }));
    expect(within(bulkBar()).getByText('All 4,812 matching selected')).toBeInTheDocument();
    rerender(<Harness rows={rowsOf(5)} matchingTotal={4812} search="003" />);
    expect(within(bulkBar()).getByText('5 selected')).toBeInTheDocument();
    expect(within(bulkBar()).queryByText(/matching selected/)).toBeNull();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenLastCalledWith(expect.any(Array), {
      ids: new Set(['k0', 'k1', 'k2', 'k3', 'k4']),
      allMatching: false,
    });
    rerender(<Harness rows={rowsOf(5)} matchingTotal={4812} search="" />);
    expect(within(bulkBar()).getByText('All 4,812 matching selected')).toBeInTheDocument();
    await user.click(within(bulkBar()).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenLastCalledWith(expect.any(Array), expect.objectContaining({ allMatching: true }));
  });

  it('does offer it again when the search is cleared', async () => {
    const { user, rerender } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} search="003" />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 1 keyword loaded' }));
    expect(offerOf()).toBeNull();
    rerender(<Harness rows={rowsOf(5)} matchingTotal={4812} search="" />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' }));
    expect(offerOf()).toHaveTextContent('Select all 4,812 matching');
  });
});

describe('DataTable row context menu', () => {
  /** A note field in a cell: the browser's own menu belongs to it. */
  const NOTE = col.url<Row>('note', () => null, {
    header: 'Note',
    sortable: false,
    cell: () => <input aria-label="Note" />,
  });
  const NO_ACTIONS_FOR_K1 = (row: Row): readonly RecordAction<Row>[] => (row.id === 'k1' ? [] : ACTIONS);
  const TREE: Readonly<Record<string, RowTree>> = {
    k0: { level: 1, expanded: true, setSize: 1, posInSet: 1 },
    k1: { level: 2, setSize: 2, posInSet: 1 },
    k2: { level: 2, setSize: 2, posInSet: 2 },
  };
  const toggle = vi.fn<(row: Row) => void>();

  /** The columns are: 0 selection, 1 keyword, 2 volume, 3 KD, 4 actions (the note column, when given, is 4). */
  function ContextHarness({
    rows,
    rowActions = ACTIONS,
    rowContextMenu = true,
    columns = COLUMNS,
    tree = false,
  }: {
    rows: Row[];
    /** `null`: the table has no `rowActions` at all. */
    rowActions?: RowActions<Row> | null;
    rowContextMenu?: boolean;
    columns?: readonly DataTableColumn<Row>[];
    tree?: boolean;
  }): ReactElement {
    const [density, setDensity] = useState<Density>(parseDensity(null));
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const [allMatching, setAllMatching] = useState(false);
    return (
      <div className="flex h-200 flex-col">
        <DataTable<Row>
          caption="Keywords"
          itemNoun={{ one: 'keyword', other: 'keywords' }}
          columns={columns}
          getRowId={rowId}
          rows={rows}
          total={rows.length}
          sort={[]}
          onSortChange={vi.fn()}
          defaultSort={DEFAULT_SORT}
          density={density}
          onDensityChange={setDensity}
          columnState={{ visible: null, onChange: vi.fn() }}
          search=""
          onSearchChange={vi.fn()}
          searchPlaceholder="Search keywords"
          selection={{
            selectedIds: selected,
            onChange: setSelected,
            matchingTotal: null,
            allMatching,
            onAllMatchingChange: setAllMatching,
          }}
          rowActions={rowActions ?? undefined}
          rowContextMenu={rowContextMenu}
          rowTree={tree ? (row) => TREE[row.id] : undefined}
          onToggleGroup={toggle}
          rowName={keywordOf}
          onRowOpen={onOpen}
          status="ready"
          errorState={<p>The keywords did not load.</p>}
          emptyState={<p>No keywords yet.</p>}
          filteredEmptyState={<p>No keywords match.</p>}
        />
      </div>
    );
  }

  // Looked up in the DOM and not by role: an open menu hides the page behind it from the accessibility tree
  const bodyRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('tbody tr[role="row"]')];
  const bodyRow = (name: string): HTMLElement => {
    const row = bodyRows().find((candidate) => candidate.querySelector('[role="rowheader"]')?.textContent === name);
    if (row === undefined) throw new Error(`No row ${name}`);
    return row;
  };
  /** A cell of a row by its column, as the grid numbers them. */
  const cellOf = (name: string, column: number): HTMLElement => {
    const cell = bodyRow(name).querySelector<HTMLElement>(`[data-cell$=":${String(column)}"]`);
    if (cell === null) throw new Error(`No cell ${String(column)} in ${name}`);
    return cell;
  };
  const anchor = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-slot="row-context-anchor"]');
  const menuLabels = (): (string | null)[] =>
    within(screen.getByRole('menu'))
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
  /** Whether the event was left to the browser's own menu: not prevented. */
  const leftToBrowser = (element: Element, init: MouseEventInit = {}): boolean =>
    fireEvent.contextMenu(element, { clientX: 40, clientY: 30, ...init });
  const markup = (html: string): string => html.replace(/(?:_r_|:r)[0-9a-z]+[_:]/g, 'ID');
  const selectedKeywords = (): (string | null | undefined)[] =>
    bodyRows()
      .filter((row) => row.getAttribute('aria-selected') === 'true')
      .map((row) => row.querySelector('[role="rowheader"]')?.textContent);

  beforeEach(() => {
    toggle.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the row menu on right click with the More menu's items, and the browser menu is prevented", async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    expect(anchor()).toBeNull();
    const handled = !leftToBrowser(cellOf('keyword 001', 1));
    expect(handled).toBe(true);
    expect(await screen.findByRole('menu', { name: 'Actions for keyword 001' })).toBeInTheDocument();
    const fromContextMenu = menuLabels();
    expect(fromContextMenu).toEqual(['Open', 'Archive']);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await user.click(within(bodyRow('keyword 001')).getByRole('button', { name: 'Actions for keyword 001' }));
    await screen.findByRole('menu');
    expect(menuLabels()).toEqual(fromContextMenu);
  });

  it('puts the anchor at the pointer coordinates', async () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    leftToBrowser(cellOf('keyword 001', 2), { clientX: 233, clientY: 147 });
    await screen.findByRole('menu');
    expect(anchor()).toHaveStyle({ left: '233px', top: '147px' });
    expect(anchor()).toHaveAccessibleName('Actions for keyword 001');
  });

  it('focuses the clicked cell and leaves selection, the active row and the inspector alone', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 000' }));
    onOpen.mockClear();
    const cell = cellOf('keyword 002', 2);
    leftToBrowser(cell);
    await screen.findByRole('menu');
    // The tab stop is on the cell that was clicked
    expect(cell).toHaveAttribute('tabindex', '0');
    expect(document.querySelectorAll('table [tabindex="0"]')).toHaveLength(1);
    expect(onOpen).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(selectedKeywords()).toEqual(['keyword 000']);
    expect(bodyRows().some((row) => row.hasAttribute('aria-current'))).toBe(false);
  });

  it('runs an action on that row only, with the same arguments as the More menu, also while another row is selected', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select keyword 000' }));
    leftToBrowser(cellOf('keyword 002', 1));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(archive).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'k2' })], {
      ids: new Set(['k2']),
      allMatching: false,
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // The same call from the More menu
    await user.click(within(bodyRow('keyword 002')).getByRole('button', { name: 'Actions for keyword 002' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledTimes(2);
    expect(archive.mock.calls[1]).toEqual(archive.mock.calls[0]);
    // Neither opened the row, and the earlier selection is as it was
    expect(onOpen).not.toHaveBeenCalled();
    expect(selectedKeywords()).toEqual(['keyword 000']);
  });

  it('closes on Escape, returns focus to the clicked cell, and the arrows move on from it', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    const cell = cellOf('keyword 001', 2);
    leftToBrowser(cell);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cell));
    expect(anchor()).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cellOf('keyword 002', 2));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('closes on a press outside the menu and leaves the tab stop on the clicked cell', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    const cell = cellOf('keyword 001', 2);
    leftToBrowser(cell);
    await screen.findByRole('menu');
    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(anchor()).toBeNull();
    expect(cell).toHaveAttribute('tabindex', '0');
    expect(selectedKeywords()).toEqual([]);
  });

  it('moves the menu to another row on a second right click, never two menus', async () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    leftToBrowser(cellOf('keyword 000', 1), { clientX: 10, clientY: 10 });
    await screen.findByRole('menu', { name: 'Actions for keyword 000' });
    leftToBrowser(cellOf('keyword 002', 3), { clientX: 300, clientY: 200 });
    expect(await screen.findByRole('menu', { name: 'Actions for keyword 002' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
    expect(document.querySelectorAll('[data-slot="row-context-anchor"]')).toHaveLength(1);
    expect(anchor()).toHaveStyle({ left: '300px', top: '200px' });
    // The old menu's close must not pull the tab stop back to the cell it was opened from
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(cellOf('keyword 002', 3)).toHaveAttribute('tabindex', '0');
    expect(document.querySelectorAll('table [tabindex="0"]')).toHaveLength(1);
  });

  it('closes the More menu that is open when the context menu opens', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    await user.click(within(bodyRow('keyword 000')).getByRole('button', { name: 'Actions for keyword 000' }));
    await screen.findByRole('menu', { name: 'Actions for keyword 000' });
    leftToBrowser(cellOf('keyword 001', 1));
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
    expect(screen.getByRole('menu', { name: 'Actions for keyword 001' })).toBeInTheDocument();
  });

  it('leaves Shift plus right click, a link in a cell and an input to the browser', async () => {
    const { rerender, user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    expect(leftToBrowser(cellOf('keyword 001', 1), { shiftKey: true })).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(anchor()).toBeNull();
    rerender(<ContextHarness rows={rowsOf(3)} columns={CONTROLLED} />);
    const link = within(bodyRow('keyword 001')).getByRole('link');
    expect(leftToBrowser(link)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    // The cell around the link is the table's
    expect(leftToBrowser(link.closest('td') ?? link)).toBe(false);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    rerender(<ContextHarness rows={rowsOf(3)} columns={[...COLUMNS, NOTE]} />);
    expect(leftToBrowser(within(bodyRow('keyword 001')).getByRole('textbox', { name: 'Note' }))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens nothing for a row the actions function gives no actions, or without rowActions', async () => {
    const { rerender, user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} rowActions={NO_ACTIONS_FOR_K1} />);
    expect(leftToBrowser(cellOf('keyword 001', 1))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(leftToBrowser(cellOf('keyword 002', 1))).toBe(false);
    expect(await screen.findByRole('menu', { name: 'Actions for keyword 002' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    rerender(<ContextHarness rows={rowsOf(3)} rowActions={null} />);
    expect(leftToBrowser(cellOf('keyword 002', 1))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ignores a right click inside the More menu, which reaches the row through React', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    await user.click(within(bodyRow('keyword 001')).getByRole('button', { name: 'Actions for keyword 001' }));
    const item = await screen.findByRole('menuitem', { name: 'Archive' });
    expect(leftToBrowser(item)).toBe(true);
    expect(anchor()).toBeNull();
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  describe('from the keyboard', () => {
    const focus = (cell: HTMLElement): void => {
      act(() => cell.focus());
    };

    it('keeps Shift+F10 and the Menu key opening the More menu on the focused row, and one menu when the browser also raises contextmenu for that key press', async () => {
      const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      const cell = cellOf('keyword 001', 1);
      focus(cell);
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      // The browser's own contextmenu for the same key press: prevented, and no second menu
      expect(leftToBrowser(cell)).toBe(false);
      await screen.findByRole('menu', { name: 'Actions for keyword 001' });
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(anchor()).toBeNull();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      // The More menu returns focus to the actions cell of its row, as it always has
      await waitFor(() => expect(document.activeElement).toBe(cellOf('keyword 001', 4)));
      fireEvent.keyDown(cellOf('keyword 001', 4), { key: 'ContextMenu' });
      expect(leftToBrowser(cell)).toBe(false);
      await screen.findByRole('menu', { name: 'Actions for keyword 001' });
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(anchor()).toBeNull();
    });

    it('does not hold the keyboard flag past that key press: a right click after it opens the context menu', async () => {
      const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      const cell = cellOf('keyword 001', 1);
      focus(cell);
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      await screen.findByRole('menu');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(leftToBrowser(cellOf('keyword 002', 1), { clientX: 90, clientY: 70 })).toBe(false);
      await screen.findByRole('menu', { name: 'Actions for keyword 002' });
      expect(anchor()).toHaveStyle({ left: '90px', top: '70px' });
    });

    it('treats a contextmenu raised on key up (Windows, Linux) as the key press that opened the menu', async () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      const cell = cellOf('keyword 001', 1);
      focus(cell);
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      await screen.findByRole('menu');
      // Time passes while the key is held, then it is released and the browser answers
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      fireEvent.keyUp(document.activeElement ?? cell, { key: 'F10', shiftKey: true });
      expect(leftToBrowser(cell, { clientX: 5, clientY: 6 })).toBe(false);
      expect(anchor()).toBeNull();
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      // The key up re-armed the flag for that one event only
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      leftToBrowser(cellOf('keyword 002', 1), { clientX: 77, clientY: 88 });
      await waitFor(() => expect(anchor()).toHaveStyle({ left: '77px', top: '88px' }));
    });

    it('arms nothing on a key up when the key opened no menu', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} rowActions={NO_ACTIONS_FOR_K1} />);
      const cell = cellOf('keyword 001', 1);
      focus(cell);
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      fireEvent.keyUp(cell, { key: 'F10', shiftKey: true });
      expect(leftToBrowser(cell)).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('leaves a contextmenu of the browser alone when the key opened no menu (a row without actions)', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} rowActions={NO_ACTIONS_FOR_K1} />);
      const cell = cellOf('keyword 001', 1);
      focus(cell);
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      expect(leftToBrowser(cell)).toBe(true);
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  describe('touch long press', () => {
    const REGION = (): HTMLElement => {
      const element = grid().parentElement;
      if (element === null) throw new Error('The grid has no scroll region');
      return element;
    };
    const touch = (init: PointerEventInit = {}): PointerEventInit => ({
      pointerType: 'touch',
      pointerId: 7,
      clientX: 60,
      clientY: 90,
      ...init,
    });
    /** Time passes, with React rendering what the timers changed. */
    const wait = (ms: number): void => {
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    };
    const target = (): HTMLElement => cellOf('keyword 001', 2);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('opens on a long press of 500 ms at the touch point, and the click after it does not open the row', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch());
      wait(499);
      expect(screen.queryByRole('menu')).toBeNull();
      wait(1);
      expect(screen.getByRole('menu', { name: 'Actions for keyword 001' })).toBeInTheDocument();
      expect(anchor()).toHaveStyle({ left: '60px', top: '90px' });
      expect(target()).toHaveAttribute('tabindex', '0');
      fireEvent.pointerUp(target(), touch());
      fireEvent.click(target());
      expect(onOpen).not.toHaveBeenCalled();
      expect(selectedKeywords()).toEqual([]);
    });

    it('stays within a slop of 10 px, and a move beyond it cancels', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch());
      fireEvent.pointerMove(target(), touch({ clientX: 66, clientY: 98 }));
      wait(500);
      expect(screen.getByRole('menu')).toBeInTheDocument();
      expect(anchor()).toHaveStyle({ left: '60px', top: '90px' });
    });

    it.each([
      ['a move over 10 px', () => fireEvent.pointerMove(target(), touch({ clientX: 60, clientY: 101 }))],
      ['a lift', () => fireEvent.pointerUp(target(), touch())],
      ['a cancel', () => fireEvent.pointerCancel(target(), touch())],
      ['a scroll of the table', () => fireEvent.scroll(REGION())],
    ])('does not open after %s before 500 ms', (_name, interrupt) => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch());
      wait(300);
      interrupt();
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
      expect(anchor()).toBeNull();
      // Nothing was held back from the click that follows a plain tap
      fireEvent.click(target());
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('is for touch only, not for the mouse or a pen', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch({ pointerType: 'mouse' }));
      wait(600);
      fireEvent.pointerDown(target(), touch({ pointerType: 'pen' }));
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('leaves a link and a row without actions alone, and respects rowContextMenu false', () => {
      const { rerender } = renderWithProviders(<ContextHarness rows={rowsOf(3)} columns={CONTROLLED} />);
      fireEvent.pointerDown(within(bodyRow('keyword 001')).getByRole('link'), touch());
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
      rerender(<ContextHarness rows={rowsOf(3)} rowActions={NO_ACTIONS_FOR_K1} />);
      fireEvent.pointerDown(target(), touch());
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
      rerender(<ContextHarness rows={rowsOf(3)} rowContextMenu={false} />);
      fireEvent.pointerDown(target(), touch());
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('does not open a second time for a press on the row whose menu is already open', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      // Android raises contextmenu on the long press as well, a pixel away from where the press began
      fireEvent.pointerDown(target(), touch());
      leftToBrowser(target(), { clientX: 61, clientY: 90 });
      expect(anchor()).toHaveStyle({ left: '61px', top: '90px' });
      wait(500);
      // The press's own timer found the menu open and left it: the anchor is where contextmenu put it
      expect(anchor()).toHaveStyle({ left: '61px', top: '90px' });
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(document.querySelectorAll('[data-slot="row-context-anchor"]')).toHaveLength(1);
    });

    it('does not press for a touch on the More menu, which reaches the row through React', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      const cell = cellOf('keyword 001', 1);
      act(() => cell.focus());
      fireEvent.keyDown(cell, { key: 'F10', shiftKey: true });
      const item = screen.getByRole('menuitem', { name: 'Archive' });
      fireEvent.pointerDown(item, touch());
      wait(600);
      expect(anchor()).toBeNull();
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    });

    it('clears the timer of a press that is still running when the table goes', () => {
      const set = vi.spyOn(globalThis, 'setTimeout');
      const clear = vi.spyOn(globalThis, 'clearTimeout');
      const { unmount } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch());
      const press = set.mock.calls.findIndex(([, delay]) => delay === 500);
      expect(press).toBeGreaterThanOrEqual(0);
      const timer: unknown = set.mock.results[press]?.value;
      clear.mockClear();
      unmount();
      expect(clear).toHaveBeenCalledWith(timer);
      wait(600);
      expect(screen.queryByRole('menu')).toBeNull();
      set.mockRestore();
      clear.mockRestore();
    });

    it('lets the next tap open a row even when no click followed the long press', () => {
      renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
      fireEvent.pointerDown(target(), touch());
      wait(500);
      fireEvent.pointerUp(target(), touch());
      // No click came; a new press starts afresh
      fireEvent.pointerDown(cellOf('keyword 002', 2), touch());
      fireEvent.pointerUp(cellOf('keyword 002', 2), touch());
      fireEvent.click(cellOf('keyword 002', 2));
      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'k2' }), 'inspector');
    });
  });

  it('counts Ctrl plus click, which a Mac raises as contextmenu, as a right click', async () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    expect(leftToBrowser(cellOf('keyword 001', 1), { ctrlKey: true })).toBe(false);
    expect(await screen.findByRole('menu', { name: 'Actions for keyword 001' })).toBeInTheDocument();
  });

  it('leaves a contenteditable cell to the browser', () => {
    const editable = col.url<Row>('editable', () => null, {
      header: 'Editable',
      sortable: false,
      cell: () => (
        <div contentEditable suppressContentEditableWarning>
          <b>text</b>
        </div>
      ),
    });
    renderWithProviders(<ContextHarness rows={rowsOf(3)} columns={[...COLUMNS, editable]} />);
    const inner = bodyRow('keyword 001').querySelector('b');
    if (inner === null) throw new Error('no editable text');
    expect(leftToBrowser(inner)).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    // Its cell around it is still the table's
    expect(leftToBrowser(cellOf('keyword 001', 1))).toBe(false);
  });

  it('opens the row menu, once, on the selection cell, its checkbox, the actions cell and the More button, and selects nothing', async () => {
    const { user } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    const row = bodyRow('keyword 001');
    const targets: [string, Element | null][] = [
      ['selection cell', cellOf('keyword 001', 0)],
      ['checkbox', row.querySelector('[role="checkbox"]')],
      ['actions cell', cellOf('keyword 001', 4)],
      ['More button', row.querySelector('button[aria-label="Actions for keyword 001"]')],
    ];
    for (const [, element] of targets) {
      if (element === null) throw new Error('missing target');
      expect(leftToBrowser(element)).toBe(false);
      expect(await screen.findByRole('menu', { name: 'Actions for keyword 001' })).toBeInTheDocument();
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(document.querySelectorAll('[data-slot="row-context-anchor"]')).toHaveLength(1);
      expect(selectedKeywords()).toEqual([]);
      expect(onOpen).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    }
  });

  it('forgets the menu when its row goes, so it does not reopen at the old point when the row returns', async () => {
    const { rerender } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    leftToBrowser(cellOf('keyword 001', 1), { clientX: 120, clientY: 80 });
    await screen.findByRole('menu');
    rerender(<ContextHarness rows={rowsOf(3).filter((row) => row.id !== 'k1')} />);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    rerender(<ContextHarness rows={rowsOf(3)} />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(anchor()).toBeNull();
  });

  it('forgets the menu when its row loses its actions, and when the actions come back', async () => {
    const { rerender } = renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    leftToBrowser(cellOf('keyword 001', 1));
    await screen.findByRole('menu');
    rerender(<ContextHarness rows={rowsOf(3)} rowActions={NO_ACTIONS_FOR_K1} />);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    rerender(<ContextHarness rows={rowsOf(3)} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('right click on a tree group row opens its menu and does not toggle the group', async () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} tree />);
    expect(screen.getByRole('treegrid', { name: 'Keywords' })).toBeInTheDocument();
    const group = within(screen.getByRole('treegrid')).getByRole('rowheader', { name: 'keyword 000' }).closest('tr');
    if (group === null) throw new Error('no group row');
    expect(group).toHaveAttribute('aria-expanded', 'true');
    const cell = group.querySelector<HTMLElement>('[data-cell$=":2"]');
    if (cell === null) throw new Error('no cell');
    expect(leftToBrowser(cell)).toBe(false);
    expect(await screen.findByRole('menu', { name: 'Actions for keyword 000' })).toBeInTheDocument();
    expect(toggle).not.toHaveBeenCalled();
    expect(group).toHaveAttribute('aria-expanded', 'true');
  });

  it('rowContextMenu false leaves the browser menu in place', () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} rowContextMenu={false} />);
    expect(leftToBrowser(cellOf('keyword 001', 1))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(anchor()).toBeNull();
  });

  it('adds nothing to the markup before it is used', () => {
    const on = renderWithProviders(<ContextHarness rows={rowsOf(5)} rowContextMenu />);
    const withMenu = markup(on.container.innerHTML);
    on.unmount();
    const off = renderWithProviders(<ContextHarness rows={rowsOf(5)} rowContextMenu={false} />);
    expect(markup(off.container.innerHTML)).toBe(withMenu);
    expect(document.querySelector('[data-slot="row-context-anchor"]')).toBeNull();
  });

  it('passes the accessibility check with the context menu open', async () => {
    renderWithProviders(<ContextHarness rows={rowsOf(3)} />);
    leftToBrowser(cellOf('keyword 001', 1));
    await screen.findByRole('menu');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
