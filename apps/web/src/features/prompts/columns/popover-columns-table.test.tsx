import { screen, waitFor } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { brandsColumn } from './brands-column';
import { chatgptRow, PROJECT, platformName, TRACKED } from '../lists/lists-fixtures';
import type { FactsRow } from '../facts';
import { col } from '@/components/app/data-table/columns';
import { DataTable } from '@/components/app/data-table/data-table';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { parseDensity, type Density, type SortKey } from '@/lib/tables/table-state';
import { renderWithProviders } from '@/test/render';
import messages from '../../../../messages/en.json';

interface Row {
  id: string;
  prompt: string;
  facts: FactsRow;
}

const t = createTranslator({ locale: 'en', messages });
const ROWS: Row[] = [
  { id: 'a', prompt: 'Best CRM for startups', facts: chatgptRow() },
  { id: 'b', prompt: 'CRM for agencies', facts: chatgptRow() },
];
const DEFAULT_SORT: SortKey[] = [{ id: 'prompt', desc: false }];
const onOpen = vi.fn();

const COLUMNS: readonly DataTableColumn<Row>[] = [
  col.keyword<Row>('prompt', (row) => row.prompt, { header: 'Prompt' }),
  brandsColumn<Row>({
    rowsOf: (row) => [row.facts],
    labelOf: () => 'This prompt',
    loaded: true,
    scope: ['chatgpt_web'],
    entities: TRACKED,
    project: PROJECT,
    platformName,
    t,
  }),
];

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
  vi.stubGlobal('ResizeObserver', FixedResizeObserver);
  Object.defineProperty(Element.prototype, 'getAnimations', { value: () => [], configurable: true, writable: true });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());

function Table({ rows }: { rows: Row[] }): ReactElement {
  const [sort, setSort] = useState<readonly SortKey[]>(DEFAULT_SORT);
  const [density, setDensity] = useState<Density>(parseDensity(null));
  const [visible, setVisible] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState('');
  return (
    <div className="flex h-200 flex-col">
      <DataTable<Row>
        caption="Prompts"
        itemNoun={{ one: 'prompt', other: 'prompts' }}
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
        searchPlaceholder="Search prompts"
        searchText={(row) => row.prompt}
        rowName={(row) => row.prompt}
        onRowOpen={onOpen}
        status="ready"
        errorState={<p>Failed</p>}
        emptyState={<p>None</p>}
        filteredEmptyState={<p>No match</p>}
      />
    </div>
  );
}

const openers = (): HTMLElement[] => screen.getAllByRole('button', { name: /^Brands mentioned in the answers/ });

describe('the Brands list in the table', () => {
  it('opens from its cell button without opening the row, and Escape closes it again', async () => {
    const { user } = renderWithProviders(<Table rows={ROWS} />);
    await user.click(openers()[0] as HTMLElement);
    expect(await screen.findByRole('dialog', { name: 'Brands mentioned in answers' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Brands mentioned in answers' })).not.toBeInTheDocument(),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens with Enter on the button, which stays the list own key and not the inspector', async () => {
    const { user } = renderWithProviders(<Table rows={ROWS} />);
    (openers()[0] as HTMLElement).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Brands mentioned in answers' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('closes when its row leaves the table', async () => {
    const { user, rerender } = renderWithProviders(<Table rows={ROWS} />);
    await user.click(openers()[0] as HTMLElement);
    await screen.findByRole('dialog', { name: 'Brands mentioned in answers' });
    rerender(<Table rows={ROWS.slice(1)} />);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Brands mentioned in answers' })).not.toBeInTheDocument(),
    );
  });
});
