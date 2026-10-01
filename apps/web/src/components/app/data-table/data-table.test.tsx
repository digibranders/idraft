import { act, screen, within } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { col } from './columns';
import { DataTable } from './data-table';
import type { RecordAction, TableStatus } from './types';
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

function Harness({
  rows,
  status = 'ready',
  matchingTotal = null,
}: {
  rows: Row[];
  status?: TableStatus;
  matchingTotal?: number | null;
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
        columns={COLUMNS}
        getRowId={(row) => row.id}
        rows={rows}
        total={rows.length}
        sort={sort}
        onSortChange={setSort}
        defaultSort={DEFAULT_SORT}
        density={density}
        onDensityChange={setDensity}
        columnState={{ visible, onChange: setVisible }}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search keywords"
        searchText={(row) => row.keyword}
        selection={{
          selectedIds: selected,
          onChange: setSelected,
          matchingTotal,
          allMatching,
          onAllMatchingChange: setAllMatching,
        }}
        bulkActions={ACTIONS}
        rowActions={ACTIONS}
        rowName={(row) => row.keyword}
        onRowOpen={onOpen}
        status={status}
        errorState={<p>The keywords did not load.</p>}
        emptyState={<p>No keywords yet.</p>}
        filteredEmptyState={<p>No keywords match.</p>}
      />
    </div>
  );
}

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: { width: 1600, height: 480 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
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

  it('moves one tab stop with the arrows, opens with Enter and selects with Space and Shift+Space', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} />);
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    const first = screen.getAllByRole('columnheader')[0];
    if (first === undefined) throw new Error('no header');
    first.focus();
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(document.activeElement).toBe(within(grid()).getAllByRole('rowheader')[0]);
    expect(grid().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'k4' }), 'inspector');
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('{Shift>} {/Shift}');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    await user.keyboard('{Control>}a{/Control}');
    expect(screen.getByText('5 selected')).toBeInTheDocument();
  });

  it('offers every matching row past the loaded ones, and runs a bulk action on the selection', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(5)} matchingTotal={4812} />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all 5 keywords loaded' }));
    const bar = screen.getByRole('group', { name: /Bulk actions/ });
    await user.click(within(bar).getByRole('button', { name: 'Select all 4,812 matching' }));
    expect(within(bar).getByText('All 4,812 matching selected')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'k0' })]));
    await user.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: /Bulk actions/ })).toBeNull();
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

  it('opens a row menu from the keyboard and runs its action on that row', async () => {
    const { user } = renderWithProviders(<Harness rows={rowsOf(3)} />);
    const cell = within(grid()).getAllByRole('rowheader')[0];
    if (cell === undefined) throw new Error('no row');
    act(() => cell.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(archive).toHaveBeenCalledWith([expect.objectContaining({ id: 'k2' })]);
  });
});
