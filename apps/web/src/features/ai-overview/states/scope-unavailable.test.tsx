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
      await screen.findByText(/is not measured on Gemini\. Choose All platforms or another platform\.$/),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-slot="scope-unavailable-card"]')).toHaveClass('md:min-h-[306px]');
  });

  it('says the card compares groups when no platform is chosen', async () => {
    render('');
    expect(await screen.findByText(/compares groups, so it needs All groups\.$/)).toBeInTheDocument();
  });
});

describe('cardMinHeight', () => {
  it('has a class for the cards the preview sizes and none for the rest', () => {
    expect(cardMinHeight('ai.topic_heatmap')).toBe('md:min-h-[585px]');
    expect(cardMinHeight('traffic.ai_referrals')).toBe('md:min-h-[520px] xl:min-h-[346px]');
    expect(cardMinHeight('ai.top_prompts')).toBe('');
    expect(cardMinHeight('toString')).toBe('');
  });
});
