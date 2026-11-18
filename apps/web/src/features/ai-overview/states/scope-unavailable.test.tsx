import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cardMinHeight } from './card-min-height';
import { ScopeUnavailableCard } from './scope-unavailable';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const render = (searchParams: string): ReturnType<typeof renderWithProviders> => {
  stubViewport();
  return renderWithProviders(
    cardInOverview({ type: 'ai.share_of_voice', Card: ({ item }) => <ScopeUnavailableCard item={item} /> }),
    { searchParams },
  );
};

describe('ScopeUnavailableCard', () => {
  it('says the platform does not measure the card, and keeps the card smallest height', async () => {
    render('?engine=gemini_web');
    expect(await screen.findByText('Not available for this scope')).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/is not measured on Gemini\. Choose All platforms or another platform\.$/))[0],
    ).toBeInTheDocument();
    // The card is a named section of its own frame, which fills its cell
    expect(screen.getByRole('region', { name: 'Share of voice' })).toHaveClass('h-full');
  });

  it('says the card compares groups when no platform is chosen', async () => {
    render('');
    expect((await screen.findAllByText(/compares groups, so it needs All groups\.$/))[0]).toBeInTheDocument();
  });
});

describe('cardMinHeight', () => {
  it('has a class for the cards the preview sizes and none for the rest', () => {
    expect(cardMinHeight('ai.topic_heatmap')).toBe('md:min-h-146.25');
    expect(cardMinHeight('traffic.ai_referrals')).toBe('md:min-h-130 xl:min-h-86.5');
    expect(cardMinHeight('ai.top_prompts')).toBe('');
    expect(cardMinHeight('toString')).toBe('');
  });
});
