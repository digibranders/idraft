import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('not-found page', () => {
  it('has one level-one heading that names the problem', () => {
    renderWithProviders(<NotFound />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
  });

  it('does not say whether the page exists, so another tenant learns nothing from it', () => {
    renderWithProviders(<NotFound />);
    expect(screen.getByText(/does not exist, or you do not have access/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<NotFound />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
