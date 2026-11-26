import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QueriesCell } from './queries-cell';
import type { PageQueries } from '../types';
import { MINUS } from '@/lib/format';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

const queries = (value: number, previous: number | null, capped = false): PageQueries => ({ value, previous, capped });

describe('QueriesCell', () => {
  it('shows the count as the app formats an integer, with a growth in the positive tone and the smaller change size', () => {
    renderWithProviders(<QueriesCell queries={queries(1240, 1105)} loading={false} />);
    expect(screen.getByText('1,240')).not.toHaveClass('type-meta');
    const change = screen.getByText('+135');
    expect(change).toHaveClass('type-meta', 'text-positive-text');
    expect(change).toHaveAccessibleDescription('1,105 queries in the period before');
  });

  it('shows a fall in the negative tone', () => {
    renderWithProviders(<QueriesCell queries={queries(12, 17)} loading={false} />);
    const change = screen.getByText(`${MINUS}5`);
    expect(change).toHaveClass('type-meta', 'text-negative-text');
    expect(change).toHaveAccessibleDescription('17 queries in the period before');
  });

  it.each<[string, PageQueries]>([
    ['the count did not change', queries(12, 12)],
    ['there is no count before', queries(12, null)],
    ['the count is capped', queries(25_000, 24_000, true)],
  ])('shows no change when %s', (_name, value) => {
    renderWithProviders(<QueriesCell queries={value} loading={false} />);
    expect(screen.queryByText(/^[+−]\d/)).not.toBeInTheDocument();
  });

  it('reads a capped count with a plus and says why in a tooltip', () => {
    renderWithProviders(<QueriesCell queries={queries(25_000, null, true)} loading={false} />);
    expect(screen.getByText('25,000+')).toHaveAccessibleDescription(
      'Google returned its limit of 25,000 queries for this page, so the real number is higher.',
    );
  });

  it('reads Not collected yet, never 0, when no count is stored', () => {
    renderWithProviders(<QueriesCell queries={null} loading={false} />);
    expect(screen.getByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('reads a stored 0 as 0', () => {
    renderWithProviders(<QueriesCell queries={queries(0, null)} loading={false} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('draws a skeleton while the history loads', () => {
    const { container } = renderWithProviders(<QueriesCell queries={null} loading />);
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText('Not collected yet')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<QueriesCell queries={queries(1240, 1105)} loading={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
