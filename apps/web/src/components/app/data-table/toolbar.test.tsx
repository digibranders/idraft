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

  it('leaves out the density menu, the count and the visible sort note when asked', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} parts={{ density: false, count: false, sortNote: false }} />);
    expect(screen.queryByRole('button', { name: 'Density' })).toBeNull();
    expect(screen.queryByText('3 keywords')).toBeNull();
    const note = screen.getByText(/^Sorted by Volume/);
    expect(note).toHaveClass('sr-only');
    expect(note).not.toHaveClass('xl:not-sr-only');
  });

  it('draws a start node before the search box, and nothing extra without one', () => {
    const { unmount } = renderWithProviders(<DataTableToolbar {...PROPS} start={<button>View</button>} />);
    const view = screen.getByRole('button', { name: 'View' });
    expect(view.compareDocumentPosition(screen.getByRole('searchbox'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    unmount();
    const plain = renderWithProviders(<DataTableToolbar {...PROPS} />);
    // The bar's first child is the search group, as before
    expect(plain.container.firstElementChild?.firstElementChild).toContainElement(screen.getByRole('searchbox'));
  });

  it('draws all of them when parts is absent', () => {
    renderWithProviders(<DataTableToolbar {...PROPS} />);
    expect(screen.getByRole('button', { name: 'Density' })).toBeInTheDocument();
  });
});
