import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SeoTab } from './seo-tab';
import { renderWithProviders } from '@/test/render';

describe('SeoTab', () => {
  it('says search share of voice is not measured yet with its reason, links to Rankings and renders no digit', () => {
    renderWithProviders(<SeoTab workspaceSlug="digibranders" projectSlug="fynix" />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Search competitors are not measured yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs keyword volumes and a click-through model/)).toBeInTheDocument();
    // Rankings is not built, Keywords is: the link goes where the keywords are added
    expect(screen.getByRole('link', { name: 'Open Keywords' })).toHaveAttribute(
      'href',
      '/digibranders/fynix/seo/keywords',
    );
    expect(document.body.textContent).not.toMatch(/\d/);
  });
});
