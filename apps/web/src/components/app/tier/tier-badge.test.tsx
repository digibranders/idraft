import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TierBadge } from './tier-badge';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const T1 = { code: 'T1', name: 'Money pages' };

afterEach(() => document.documentElement.classList.remove('dark'));

describe('TierBadge', () => {
  it('is an outline badge with a square in the tier color and the code', () => {
    renderWithProviders(<TierBadge tier={T1} />);
    const badge = screen.getByText('T1').closest('[data-slot="tier-badge"]');
    expect(badge).toHaveClass('h-badge', 'rounded-sm', 'border', 'border-border', 'bg-surface', 'type-label');
    expect(badge?.querySelector('[data-tier-square]')).toHaveClass('bg-tier-1', 'size-2');
    expect(badge).toHaveAttribute('title', 'T1 Money pages');
  });

  it('shows the code and the name where names show (filters, the inspector)', () => {
    renderWithProviders(<TierBadge tier={T1} withName />);
    expect(screen.getByText('T1 Money pages')).toBeInTheDocument();
  });

  it('shows Untiered with the neutral square and no title', () => {
    renderWithProviders(<TierBadge tier={null} />);
    const badge = screen.getByText('Untiered').closest('[data-slot="tier-badge"]');
    expect(badge?.querySelector('[data-tier-square]')).toHaveClass('bg-tier-none');
    expect(badge).not.toHaveAttribute('title');
  });

  it.each(['light', 'dark'])('has no axe violations in the %s theme', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = renderWithProviders(
      <p>
        <TierBadge tier={T1} /> <TierBadge tier={{ code: 'T8', name: 'Archive' }} withName /> <TierBadge tier={null} />
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
