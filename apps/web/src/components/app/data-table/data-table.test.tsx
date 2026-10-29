import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { col } from './columns';
import { DataTable } from './data-table';
import type { DataTableColumn, RecordAction, RowActions, ServerPaging, TableStatus } from './types';
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
}: {
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
  const [density, setDensity] = useState<Density>(parseDensity(null));
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState('');
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
        status={status}
        errorState={<p>The keywords did not load.</p>}
        emptyState={<p>No keywords yet.</p>}
        filteredEmptyState={<p>No keywords match.</p>}
      />
    </div>
  );
}

/** The width the bulk bar's action area is given; the grid's region is always 1600 px. */
let actionsWidth = 1600;

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const inBar = target instanceof HTMLElement && target.dataset.slot === 'bulk-actions';
    this.callback(
      [{ target, contentRect: { width: inBar ? actionsWidth : 1600, height: 480 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  actionsWidth = 1600;
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
    expect(RANKED.map((column) => column.type)).toEqual(['keyword', 'rank', 'rankDelta', 'url']);
    expect(wide.width).toBe(80);
    expect(narrow.width).toBe(180);
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
