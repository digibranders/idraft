import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InsufficientPill } from './insufficient-pill';
import { MIN_OBSERVATIONS } from '@/lib/stats';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('InsufficientPill', () => {
  it('says how many answers there are in place of a rate, and why that is not enough', async () => {
    const { container } = renderWithProviders(<InsufficientPill answers={3} />);
    const pill = screen.getByText('3 answers');
    expect(pill).toHaveClass('bg-insufficient');
    expect(pill).toHaveAccessibleDescription(
      `Too few valid answers for a rate: 3 of the ${String(MIN_OBSERVATIONS)} it needs.`,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('counts one answer in the singular', () => {
    renderWithProviders(<InsufficientPill answers={1} />);
    expect(screen.getByText('1 answer')).toBeInTheDocument();
  });

  it('leaves its tooltip to the table cell it sits in, which carries it for the keyboard too', () => {
    renderWithProviders(<InsufficientPill answers={3} tip={false} />);
    const pill = screen.getByText('3 answers');
    expect(pill).toHaveClass('bg-insufficient');
    expect(pill).not.toHaveAccessibleDescription();
  });
});
