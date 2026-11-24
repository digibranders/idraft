import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PositionDistributionCard from './position-card';
import SentimentCard from './sentiment-card';
import { cell, engine, promptRow, summaryOf } from '../competitors/model/summary.test-fixtures';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { EngineSummaryWithFacts, PositionCounts, SentimentCounts } from '@/lib/prompt-facts';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

interface Facts {
  position?: PositionCounts;
  sentiment?: SentimentCounts | null;
}

/** One platform of one prompt over 40 valid answers, with the facts the card reads. */
function platform(code: string, facts: Facts): EngineSummaryWithFacts {
  return { ...engine(code, { mentioned: cell(20, 40), cited: cell(10, 40) }), ...facts };
}

function serve(...engines: EngineSummaryWithFacts[]): void {
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf({ prompts: [promptRow(1, engines)] }) })));
}

function renderCard(Card: ComponentType<CardProps>, searchParams: string): ReturnType<typeof renderWithProviders> {
  const Wrapped = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <Card {...props} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.position_distribution', Card: Wrapped, width: 'third' }), {
    searchParams,
  });
}

const POSITION: PositionCounts = {
  rank_sum: 34,
  ordered_answers: 20,
  mentions: 22,
  answers: 40,
  by_order: { counts: [10, 5, 3, 2], rank_sum: 34 },
};

describe('the mention position card', () => {
  it('draws one stacked column per platform from the counts by place, with the mean and the exact shares', async () => {
    serve(platform('chatgpt_web', { position: POSITION }), platform('gemini_web', { position: POSITION }));
    renderCard(PositionDistributionCard, 'cmp=off');
    // The columns are one picture that says every platform's shares in words
    const columns = await screen.findByRole('img', { name: /ChatGPT.*Mentioned first 50%.*Gemini.*Mentioned first 50%/ });
    expect(columns).toHaveAccessibleName(/Mentioned second 25%.*Mentioned third 15%.*Fourth or later 10%/);
    // The exact shares are text under the chart, one cell per platform and place
    expect(screen.getAllByText('mean 1.7')).toHaveLength(2);
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('order among tracked brands')).toBeInTheDocument();
    expect(screen.getByText('Mentioned first', { selector: 'th' })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="share-segment"]')).toBeNull();
  });

  it('says Not collected yet, and draws no shares, when the counts by place are not sent, whatever the mean says', async () => {
    const withoutOrder: PositionCounts = { rank_sum: 34, ordered_answers: 20, mentions: 22, answers: 40 };
    serve(platform('chatgpt_web', { position: withoutOrder }));
    renderCard(PositionDistributionCard, 'cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Mentioned first/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^mean \d/)).not.toBeInTheDocument();
  });

  it('keeps the line of a platform with fewer than 4 answers with a place as a chip and no bar', async () => {
    serve(
      platform('chatgpt_web', { position: POSITION }),
      platform('gemini_web', {
        position: {
          rank_sum: 4,
          ordered_answers: 3,
          mentions: 3,
          answers: 40,
          by_order: { counts: [2, 1, 0, 0], rank_sum: 4 },
        },
      }),
    );
    renderCard(PositionDistributionCard, 'cmp=off');
    await screen.findByRole('img', { name: /Mentioned first 50%/ });
    expect(screen.getByText('Too few mentions')).toBeInTheDocument();
    expect(screen.getByText('too few mentions')).toBeInTheDocument();
  });

  it('has the preview info text behind its info button and passes axe', async () => {
    serve(platform('chatgpt_web', { position: POSITION }));
    const { container } = renderCard(PositionDistributionCard, 'cmp=off&engine=chatgpt_web');
    await screen.findByRole('img', { name: /Mentioned first/ });
    expect(screen.getByRole('button', { name: /about mention position/i })).toBeInTheDocument();
    expect(screen.getByText(/It is not a Google rank\./)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

const TONE: SentimentCounts = { positive: 12, neutral: 6, negative: 2, mixed: 2 };

describe('the sentiment by platform card', () => {
  it('draws a ring of the four shares for each platform that classifies, never one score, with the share of mentions classified', async () => {
    serve(
      platform('chatgpt_web', { position: POSITION, sentiment: TONE }),
      platform('gemini_web', { position: POSITION, sentiment: TONE }),
    );
    renderCard(SentimentCard, 'cmp=off');
    // The rings are one picture that says every platform's four shares in words
    const rings = await screen.findByRole('img', { name: /ChatGPT.*Positive 55%.*Neutral 27%.*Negative 9%.*Mixed 9%/ });
    expect(rings).toHaveAccessibleName(/Gemini.*Positive 55%/);
    // The positive share is in the middle of each ring: 55% twice, and again in the table under them
    expect(within(rings).getAllByText('55%')).toHaveLength(2);
    expect(screen.getAllByText('100% of mentions classified').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sample data')).not.toBeInTheDocument();
  });

  it('says Not collected yet for a platform the API sends no sentiment for, and for the whole card when none has it', async () => {
    serve(platform('chatgpt_web', { position: POSITION }));
    renderCard(SentimentCard, 'cmp=off&engine=chatgpt_web');
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.getByText('The tone of the mentions is not collected yet.')).toBeInTheDocument();
  });

  it('says Not classified for a platform that does not classify, and keeps the platform that does', async () => {
    serve(
      platform('chatgpt_web', { position: POSITION, sentiment: TONE }),
      platform('gemini_web', { position: POSITION, sentiment: null }),
    );
    renderCard(SentimentCard, 'cmp=off');
    await screen.findByRole('img', { name: /Positive 55%/ });
    // Said under the empty ring and once in the table
    expect(screen.getAllByText('Not classified').length).toBeGreaterThan(0);
    expect(screen.getByText('not classified')).toBeInTheDocument();
  });

  it('says the whole card is not classified when every platform in scope has no classification', async () => {
    serve(platform('gemini_web', { position: POSITION, sentiment: null }));
    renderCard(SentimentCard, 'cmp=off&engine=gemini_web');
    expect(await screen.findByText('Not classified on this platform')).toBeInTheDocument();
    expect(
      screen.getByText('Sentiment is classified on ChatGPT and Gemini answers. Pick another platform to see it.'),
    ).toBeInTheDocument();
  });

  it('has no ring under 4 classified mentions and says why', async () => {
    serve(
      platform('chatgpt_web', { position: POSITION, sentiment: TONE }),
      platform('gemini_web', { position: POSITION, sentiment: { positive: 1, neutral: 1, negative: 0, mixed: 0 } }),
    );
    renderCard(SentimentCard, 'cmp=off');
    const rings = await screen.findByRole('img', { name: /Positive 55%/ });
    expect(screen.getByText('too few mentions')).toBeInTheDocument();
    // The platform is named but has no shares in the picture
    expect(rings).not.toHaveAccessibleName(/Gemini.*Positive/);
    expect(within(rings).getByText('Gemini')).toBeInTheDocument();
  });
});
