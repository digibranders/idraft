import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { col } from './columns';
import { DataTable } from './data-table';
import type { DataTableColumn, RecordAction, RowActions, ServerPaging, TableStatus } from './types';
import type { Density, SortKey } from '@/lib/tables/table-state';
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
  const [density, setDensity] = useState<Density>('default');
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
