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

describe('DataTableToolbar', () => {
  it('draws the sort summary from 1280 px, and always keeps the count in view', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} />);
    expect(screen.getByText('3 keywords')).not.toHaveClass('hidden');
    expect(screen.getByText(/^Sorted by Volume/)).toHaveClass('sr-only', 'xl:not-sr-only');
  });

  it('lets a compact toolbar, whose end slot holds more, read the sort summary and draw it from 1440 px', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} compact />);
    expect(screen.getByText(/^Sorted by Volume/)).toHaveClass('sr-only', '2xl:not-sr-only');
    expect(screen.getByText(/^Sorted by Volume/)).not.toHaveClass('xl:not-sr-only');
  });
});
