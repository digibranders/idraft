import { screen } from '@testing-library/react';
import type { Route } from 'next';
import { describe, expect, it } from 'vitest';

import { UpdatedLink } from './updated-link';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('UpdatedLink', () => {
  it('is the same words as a link to the run, named so a reader knows where it goes', async () => {
    const href = '/digibranders/fynix/ops/runs?inspect=run%3Aabc' as Route;
    const { container } = renderWithProviders(<UpdatedLink text="Updated 5m ago" href={href} />);
    const link = screen.getByRole('link', { name: 'Updated 5m ago. Open the run that collected these answers.' });
    expect(link).toHaveTextContent('Updated 5m ago');
    expect(link).toHaveAttribute('href', href);
    // A box of its own of at least 24 px: an inline anchor's height is only its line
    expect(link).toHaveClass('inline-flex', 'min-h-6');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('is only the words without a href', () => {
    renderWithProviders(<UpdatedLink text="Updated 5m ago" href={null} />);
    expect(screen.getByText('Updated 5m ago')).toBeVisible();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
