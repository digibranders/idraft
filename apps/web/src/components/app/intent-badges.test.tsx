import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IntentBadges } from './intent-badges';
import { axe } from '@/test/axe';
import { renderWithProviders } from '@/test/render';

describe('IntentBadges', () => {
  it('draws one named badge per intent in the order I, C, T, N, L', async () => {
    const { container } = renderWithProviders(<IntentBadges intents={['local', 'informational', 'transactional']} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Informational intent',
      'Transactional intent',
      'Local intent',
    ]);
    expect(items.map((item) => item.textContent)).toEqual(['I', 'T', 'L']);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a muted n/a for none, for unknown and for words outside the five', () => {
    const { container } = renderWithProviders(<IntentBadges intents={['unknown', 'other']} />);
    expect(container.textContent).toBe('n/a');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
