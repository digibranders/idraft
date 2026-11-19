import { renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CandidatesTabPanel, useCandidatesCount } from './candidates-tab';
import { competitorTabItems } from './competitor-tabs';
import { renderWithProviders } from '@/test/render';

const label = (id: string): string => `label:${id}`;

describe('competitorTabItems', () => {
  it('tab order is Comparison, SEO, AI, Candidates', () => {
    expect(competitorTabItems(label, null).map((item) => item.value)).toEqual([
      'comparison',
      'seo',
      'ai',
      'candidates',
    ]);
    expect(competitorTabItems(label, null).map((item) => item.label)).toEqual([
      'label:comparison',
      'label:seo',
      'label:ai',
      'label:candidates',
    ]);
  });

  it('the Candidates count is unknown and the label shows no number', () => {
    const { result } = renderHook(() => useCandidatesCount());
    expect(result.current).toBeNull();
    const items = competitorTabItems(label, result.current);
    expect(items.every((item) => item.count === undefined)).toBe(true);
  });

  it('a known count is written after the Candidates label only', () => {
    const items = competitorTabItems(label, 12_345);
    expect(items.find((item) => item.value === 'candidates')?.count).toBe('12,345');
    expect(items.filter((item) => item.count !== undefined)).toHaveLength(1);
    // Zero is a count, not an unknown
    expect(competitorTabItems(label, 0).find((item) => item.value === 'candidates')?.count).toBe('0');
  });
});

describe('CandidatesTabPanel', () => {
  it('says brand discovery is not built, with no number and no action', () => {
    renderWithProviders(<CandidatesTabPanel />);
    expect(screen.getByRole('heading', { level: 2, name: 'Candidate brands are not listed yet' })).toBeInTheDocument();
    expect(screen.getByText(/once brand discovery is built/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d/);
  });
});
