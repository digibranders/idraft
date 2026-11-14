import { act, waitFor } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EngineDisagreementCard from './engine-disagreement-card';
import PromptHeatmapCard from './prompt-heatmap-card';
import TopPromptsCard from './top-prompts-card';
import TopicContributionCard from './topic-contribution-card';
import TopicEngineGapCard from './topic-engine-gap-card';
import TopicExtremesCard from './topic-extremes-card';
import TopicHeatmapCard from './topic-heatmap-card';
import TopicMoversCard from './topic-movers-card';
import TopicSmallMultiplesCard from './topic-small-multiples-card';
import TopicTrendsCard from './topic-trends-card';
import type { CardProps } from '@/features/layouts';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

/**
 * Every card of the topics family asks its reads only while it is live (customize mode pauses them): the one place
 * that proves `subscribed: live` reaches the summary read of each card, since a card that drops it still renders.
 */

const CARDS: readonly (readonly [type: string, Card: ComponentType<CardProps>])[] = [
  ['ai.topic_heatmap', TopicHeatmapCard],
  ['ai.topic_extremes', TopicExtremesCard],
  ['ai.topic_engine_gap', TopicEngineGapCard],
  ['ai.engine_disagreement', EngineDisagreementCard],
  ['ai.topic_movers', TopicMoversCard],
  ['ai.topic_contribution', TopicContributionCard],
  ['ai.topic_trends', TopicTrendsCard],
  ['ai.topic_small_multiples', TopicSmallMultiplesCard],
  ['ai.prompt_heatmap', PromptHeatmapCard],
  ['ai.top_prompts', TopPromptsCard],
];

const listeners: ((info: { request: Request }) => void)[] = [];

/** The paths of the requests the server sees from the start of the test. */
function recordPaths(): string[] {
  const paths: string[] = [];
  const listener = ({ request }: { request: Request }): void => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', listener);
  listeners.push(listener);
  return paths;
}
const summaries = (paths: readonly string[]): string[] => paths.filter((path) => path.endsWith('/ai/prompts-summary'));

function renderCard(
  type: string,
  Card: ComponentType<CardProps>,
  live: boolean,
): ReturnType<typeof renderWithProviders> {
  function Held(props: CardProps): ReactElement {
    return <Card {...props} live={live} />;
  }
  return renderWithProviders(cardInOverview({ type, Card: Held, width: 'two_thirds' }));
}

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  for (const listener of listeners) server.events.removeListener('request:start', listener);
  listeners.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(CARDS)('%s', (type, Card) => {
  it('a card that is not live makes no request for the summary and shows a skeleton, not an error', async () => {
    const paths = recordPaths();
    const { container } = renderCard(type, Card, false);
    // The engines are read whatever the card does; once they are in, a live card would have asked for its summary
    await waitFor(() => {
      expect(paths.some((path) => path.endsWith('/engines'))).toBe(true);
      expect(container.querySelector('section[aria-busy="true"] [data-slot="skeleton"]')).not.toBeNull();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(summaries(paths)).toEqual([]);
    expect(container.querySelector('section[aria-busy="true"] [data-slot="skeleton"]')).not.toBeNull();
  });

  it('a live card asks for the summary', async () => {
    const paths = recordPaths();
    renderCard(type, Card, true);
    await waitFor(() => {
      expect(summaries(paths).length).toBeGreaterThan(0);
    });
  });
});
