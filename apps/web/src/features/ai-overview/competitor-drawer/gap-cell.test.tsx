import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GapCell } from './gap-cell';
import { renderWithProviders } from '@/test/render';

const icon = (): HTMLElement => {
  const node = document.querySelector<HTMLElement>('[data-slot="gap-icon"]');
  if (node === null) throw new Error('no gap icon');
  return node;
};

describe('GapCell', () => {
  it('is coloured, and says detectable, when the two rates differ detectably', () => {
    renderWithProviders(
      <GapCell own={0.9} rival={0.4} ownCounts={{ k: 90, n: 100 }} rivalCounts={{ k: 40, n: 100 }} name="Rival" />,
    );
    expect(icon()).toHaveAttribute('data-direction', 'up');
    expect(screen.getAllByText(/You are 50\.0 pts above Rival: 90% against 40%\. Detectable/).length).toBeGreaterThan(
      0,
    );
  });

  it('is coloured red for a detectable gap behind', () => {
    renderWithProviders(
      <GapCell own={0.4} rival={0.9} ownCounts={{ k: 40, n: 100 }} rivalCounts={{ k: 90, n: 100 }} name="Rival" />,
    );
    expect(icon()).toHaveAttribute('data-direction', 'down');
  });

  it('is a grey dash that says small sample when the difference is not detectable', () => {
    renderWithProviders(
      <GapCell own={0.5} rival={0.25} ownCounts={{ k: 4, n: 8 }} rivalCounts={{ k: 2, n: 8 }} name="Rival" />,
    );
    expect(icon()).toHaveAttribute('data-direction', 'flat');
    expect(screen.getAllByText(/not detectable, small sample: 50% against 25%/).length).toBeGreaterThan(0);
  });

  it('is a grey dash when a count is not known, never coloured by the sign alone', () => {
    renderWithProviders(<GapCell own={0.9} rival={0.1} ownCounts={null} rivalCounts={{ k: 1, n: 10 }} name="Rival" />);
    expect(icon()).toHaveAttribute('data-direction', 'flat');
  });

  it('is n/a when either side has no rate', () => {
    renderWithProviders(<GapCell own={null} rival={0.1} ownCounts={null} rivalCounts={null} name="Rival" />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });
});
