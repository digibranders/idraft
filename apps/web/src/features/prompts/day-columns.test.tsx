import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DayColumns } from './day-columns';
import type { DayColumn } from './day-compare-model';
import { renderWithProviders } from '@/test/render';

const column = (id: string, day: string, names: readonly string[], own = false, ownCited = false): DayColumn => ({
  observationId: id,
  observedDate: day,
  observedAt: `${day}T09:30:00Z`,
  brands: names.map((name) => ({ entityId: name, name, role: name === 'Northwind' ? 'own' : 'competitor' })),
  sources: ownCited ? [{ host: 'northwind.com', role: 'own' }] : [{ host: 'g2.com', role: 'third_party' }],
  ownNamed: own,
  ownCited,
});

const COLUMNS = [
  column('1', '2026-11-07', ['HubSpot', 'Zoho'], false, false),
  column('2', '2026-11-14', ['HubSpot', 'Northwind', 'Pipedrive'], true, true),
];

describe('the cards of Compare days', () => {
  it('names each day, its reading, its brands in order and its cited domains', () => {
    renderWithProviders(<DayColumns columns={COLUMNS} timeZone="UTC" />);
    const [first, second] = screen.getAllByRole('article');
    if (first === undefined || second === undefined) throw new Error('Two cards are expected');

    expect(within(first).getByRole('heading', { level: 3, name: 'Nov 7' })).toBeInTheDocument();
    expect(within(first).getByText('Neither')).toBeInTheDocument();
    expect(within(second).getByRole('heading', { level: 3, name: 'Nov 14' })).toBeInTheDocument();
    expect(within(second).getByText('Mentioned and cited')).toBeInTheDocument();

    const brands = within(second).getByRole('region', { name: 'Brands mentioned' });
    expect(
      within(brands)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('HubSpot'),
      expect.stringContaining('Northwind (you)'),
      expect.stringContaining('Pipedrive'),
    ]);
    expect(
      within(within(second).getByRole('region', { name: 'Cited domains' })).getByText('northwind.com'),
    ).toBeInTheDocument();
  });

  it('tags the brands that are new since the card before and names the ones that are gone', () => {
    renderWithProviders(<DayColumns columns={COLUMNS} timeZone="UTC" />);
    const [first, second] = screen.getAllByRole('article');
    if (first === undefined || second === undefined) throw new Error('Two cards are expected');

    // The first card has nothing before it to differ from
    expect(within(first).queryByText('New')).toBeNull();
    // Northwind and Pipedrive are new on Nov 14; Zoho was mentioned on Nov 7 and is gone
    expect(within(second).getAllByText('New')).toHaveLength(2);
    expect(within(second).getByText('Mentioned on Nov 7, not on this day: Zoho')).toBeInTheDocument();
  });

  it('says so for a day with no brand mentioned and no domain cited', () => {
    renderWithProviders(<DayColumns columns={[{ ...column('3', '2026-11-20', []), sources: [] }]} timeZone="UTC" />);
    expect(screen.getByText('No brand mentioned.')).toBeInTheDocument();
    expect(screen.getByText('No domain cited.')).toBeInTheDocument();
  });
});
