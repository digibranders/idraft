import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RelatedKeywords, type RelatedKeywordsProps } from './inspector-competitors';
import type { LinkedKeywordVolume } from '@/lib/api/prompt-facts';
import { renderWithProviders } from '@/test/render';

function renderCard(overrides: Partial<RelatedKeywordsProps>): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <RelatedKeywords
      status="ready"
      retry={() => undefined}
      retrying={false}
      requested
      row={undefined}
      {...overrides}
    />,
  );
}

const keyword = (extra: Partial<LinkedKeywordVolume>): { linked_keyword: LinkedKeywordVolume } => ({
  linked_keyword: { keyword: 'best crm for startups', search_volume: 1190, ...extra },
});

describe('the Related keywords card of the Competitors tab', () => {
  it('says "Not collected yet" and shows no rank when the read did not carry the facts', () => {
    renderCard({ requested: false, row: keyword({ rank: 3 }) });
    expect(screen.getByText(/^Not collected yet\./)).toBeInTheDocument();
    expect(screen.queryByText('best crm for startups')).toBeNull();
  });

  it('says "Not collected yet" in the cells of a field the facts do not have, never a rank or "Not cited"', () => {
    renderCard({ row: keyword({}) });
    const row = screen.getByRole('row', { name: /best crm for startups/ });
    expect(within(row).getAllByText('Not collected yet')).toHaveLength(2);
    expect(row).not.toHaveTextContent(/Not cited|No Google AI Overview|\d/);
    expect(within(row).getByText('Linked')).toBeInTheDocument();
  });

  it('shows the rank, ">20" beyond the first 20, and the state of the Google AI Overview', () => {
    const { unmount } = renderCard({ row: keyword({ rank: 3, ai_overview: { cited_position: 2 } }) });
    let row = screen.getByRole('row', { name: /best crm for startups/ });
    expect(row).toHaveTextContent('3');
    expect(row).toHaveTextContent('Cited #2');
    unmount();
    const beyond = renderCard({ row: keyword({ rank: null, ai_overview: { cited_position: null } }) });
    row = screen.getByRole('row', { name: /best crm for startups/ });
    expect(row).toHaveTextContent('>20');
    expect(row).toHaveTextContent('Not cited');
    beyond.unmount();
    renderCard({ row: keyword({ rank: 5, ai_overview: null }) });
    expect(screen.getByRole('row', { name: /best crm for startups/ })).toHaveTextContent('No Google AI Overview');
  });

  it('says no keyword is linked, with what that means for the Google AI Overview', () => {
    renderCard({ row: { linked_keyword: null } });
    expect(screen.getByText('No keyword is linked, so this prompt has no Google AI Overview.')).toBeInTheDocument();
  });
});
