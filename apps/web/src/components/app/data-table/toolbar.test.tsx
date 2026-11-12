import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTableToolbar, type DataTableToolbarProps } from './toolbar';
import { renderWithProviders } from '@/test/render';

const PROPS: DataTableToolbarProps = {
  caption: 'Keywords',
  search: '',
  onSearchChange: vi.fn(),
  searchPlaceholder: 'Search keywords',
  countText: '3 keywords',
  sortSummary: 'Sorted by Volume descending, then Keyword ascending',
  updating: false,
  density: 'compact',
  onDensityChange: vi.fn(),
  columns: (trigger) => trigger,
};

const searchGroup = (): HTMLElement | null =>
  screen.getByRole('searchbox', { name: 'Search in table' }).closest('[data-slot="input-group"]');

describe('DataTableToolbar', () => {
  it('keeps the search at 256 px, the count in view and the sort summary from 1280 px, unless asked to be compact', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} />);
    expect(searchGroup()).toHaveClass('w-64');
    expect(searchGroup()).not.toHaveClass('flex-1');
    expect(screen.getByText('3 keywords')).not.toHaveClass('hidden');
    expect(screen.getByText(/^Sorted by Volume/)).toHaveClass('sr-only', 'xl:not-sr-only');
  });

  it('lets a compact toolbar give the search the room of a phone row, hide the count there and the sort summary below 1440 px', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} compact />);
    expect(searchGroup()).toHaveClass('flex-1', 'basis-32', 'sm:w-64', 'sm:flex-none');
    expect(screen.getByText('3 keywords')).toHaveClass('hidden', 'sm:block');
    expect(screen.getByText(/^Sorted by Volume/)).toHaveClass('sr-only', '2xl:not-sr-only');
    expect(screen.getByText(/^Sorted by Volume/)).not.toHaveClass('xl:not-sr-only');
  });
});
