import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from './page-header';
import { renderWithProviders } from '@/test/render';

describe('PageHeader with the title hidden', () => {
  it('keeps the page’s heading for assistive technology but does not draw it', () => {
    renderWithProviders(
      <PageHeader
        title="Keywords"
        titleHidden
        meta="Updated 2h ago"
        toolbar={<div>toolbar</div>}
        actions={<button type="button">Add</button>}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Keywords' });
    expect(heading).toHaveClass('sr-only');
    expect(screen.getByText('toolbar')).toBeInTheDocument();
    expect(screen.getByText('Updated 2h ago')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('draws the title as before without it', () => {
    renderWithProviders(<PageHeader title="Keywords" meta="Updated 2h ago" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Keywords' })).not.toHaveClass('sr-only');
  });
});
