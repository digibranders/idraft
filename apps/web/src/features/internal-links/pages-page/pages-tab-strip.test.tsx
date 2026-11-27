import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PagesTabStrip } from './pages-tab-strip';
import { renderWithProviders } from '@/test/render';

describe('the Pages tab strip', () => {
  it('lists Overview, All pages and Monitoring as links, with the current one marked', () => {
    renderWithProviders(<PagesTabStrip workspaceSlug="acme" projectSlug="site" current="monitoring" />);
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Overview', 'All pages', 'Monitoring']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/acme/site/seo/pages',
      '/acme/site/seo/pages/all',
      '/acme/site/seo/pages/monitoring',
    ]);
    expect(screen.getByRole('link', { name: 'Monitoring' })).toHaveAttribute('aria-current', 'page');
  });
});
