import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DomainsFeedsSection } from './domains-feeds-section';
import { renderWithProviders } from '@/test/render';

// The section holds tables and an inspector as well, so rendering it all is slow on a loaded machine
const SECTION_TIMEOUT_MS = 30_000;

describe('the domains and feeds section, FeedRow compact group', () => {
  it(
    'shows a wrapping sentence, a row without a link and a row with an atLabel',
    () => {
      document.documentElement.className = 'light';
      const { container } = renderWithProviders(<DomainsFeedsSection />);
      const group = within(container).getByRole('heading', { level: 2, name: 'FeedRow compact' }).closest('section');
      if (group === null) throw new Error('The FeedRow compact group is missing');
      const rows = within(group).getAllByRole('listitem');
      expect(rows).toHaveLength(3);

      const long = group.querySelector('[data-slot="feed-sentence"]') as HTMLElement;
      expect(long).toHaveClass('line-clamp-2');
      expect(long.getAttribute('title')).toContain('ChatGPT citation rate fell to 21.6%');
      expect(within(rows[0] as HTMLElement).getByRole('link')).toBeInTheDocument();

      // The two rows after it are plain text
      expect(within(group).getAllByRole('link')).toHaveLength(1);
      expect(rows[1]?.querySelector('a')).toBeNull();
      expect(rows[2]?.querySelector('time')).toHaveTextContent('28 days');
      document.documentElement.className = '';
    },
    SECTION_TIMEOUT_MS,
  );
});
