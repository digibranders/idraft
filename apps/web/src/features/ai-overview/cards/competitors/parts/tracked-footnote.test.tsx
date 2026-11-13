import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { projectEntity, summaryOf } from '../model/summary-fixtures';
import { trackedSetOf } from '../model/tracked-set';
import { TrackedFootnote } from './tracked-footnote';
import { renderWithProviders } from '@/test/render';

const DASH = new RegExp(`[${String.fromCharCode(0x2012, 0x2013, 0x2014, 0x2015)}]| - `);

describe('TrackedFootnote', () => {
  it('names the set and lists the competitors added inside the window with their days', () => {
    const rows = [
      projectEntity(1, 'Fynix', { role: 'own', colorIndex: 1 }),
      projectEntity(2, 'HubSpot', { colorIndex: 2, addedAt: '2026-10-21T09:00:00Z' }),
      projectEntity(3, 'Zoho', { colorIndex: 3, addedAt: '2026-01-05T09:00:00Z' }),
    ];
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), rows);
    renderWithProviders(<TrackedFootnote set={set} />);
    const note = screen.getByTestId('tracked-footnote');
    expect(note).toHaveTextContent('Tracked brands: you and 2 competitors.');
    expect(note).toHaveTextContent('Added in this window: HubSpot on Oct 21.');
    expect(note).not.toHaveTextContent('Zoho on');
  });

  it('says the set changed when no date is known', () => {
    const set = trackedSetOf(summaryOf({ versions: [1, 2] }), null);
    renderWithProviders(<TrackedFootnote set={set} />);
    const note = screen.getByTestId('tracked-footnote');
    expect(note).toHaveTextContent('Tracked brands: you and 2 competitors.');
    expect(note).toHaveTextContent('The tracked set changed in this window');
    expect(note).not.toHaveTextContent('Added in this window');
  });

  it('only names the set when it did not change', () => {
    const set = trackedSetOf(summaryOf({ versions: [1] }), null);
    renderWithProviders(<TrackedFootnote set={set} />);
    const note = screen.getByTestId('tracked-footnote');
    expect(note).toHaveTextContent('Tracked brands: you and 2 competitors.');
    expect(note).not.toHaveTextContent('changed');
  });

  it('counts one competitor in the singular', () => {
    const set = trackedSetOf(summaryOf({ entities: summaryOf().entities.slice(0, 2) }), null);
    renderWithProviders(<TrackedFootnote set={set} />);
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('you and 1 competitor.');
  });

  it('contains no dash', () => {
    const rows = [projectEntity(2, 'HubSpot', { addedAt: '2026-10-21T09:00:00Z' })];
    for (const set of [
      trackedSetOf(summaryOf({ versions: [1, 2] }), rows),
      trackedSetOf(summaryOf({ versions: [1, 2] }), null),
    ]) {
      const { unmount } = renderWithProviders(<TrackedFootnote set={set} />);
      expect(screen.getByTestId('tracked-footnote').textContent).not.toMatch(DASH);
      unmount();
    }
  });
});
