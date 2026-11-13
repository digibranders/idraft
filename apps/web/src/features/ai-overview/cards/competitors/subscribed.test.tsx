import { screen, waitFor } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CoMentionsCard from './co-mentions-card';
import CompetitorTableCard from './competitor-table-card';
import CompetitorTrendCard from './competitor-trend-card';
import LostToCard from './lost-to-card';
import OpportunitiesCard from './opportunities-card';
import ShareOfVoiceCard from './share-of-voice-card';
import SovOverTimeCard from './sov-over-time-card';
import SovRankCard from './sov-rank-card';
import type { CardProps } from '@/features/layouts';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import messages from '../../../../../messages/en.json';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

/*
 * Customize mode passes `live` false to every card, and a card hands it to its reads as `subscribed`: while it is
 * false no summary is asked (whatever the compare setting) and nothing reads as a failure. One case per card of
 * the family, by catalog key.
 */

interface Case {
  type: string;
  Card: ComponentType<CardProps>;
  options: Readonly<Record<string, string>>;
}

const ENGINE = { engine: 'chatgpt_web' };
const CASES: readonly Case[] = [
  { type: 'ai.share_of_voice', Card: ShareOfVoiceCard, options: { ...ENGINE, rows: '5' } },
  { type: 'ai.lost_to_competitor', Card: LostToCard, options: { ...ENGINE, rows: '5' } },
  { type: 'ai.opportunities', Card: OpportunitiesCard, options: { rows: '4' } },
  { type: 'ai.competitor_trend', Card: CompetitorTrendCard, options: { ...ENGINE, competitors: '3' } },
  { type: 'ai.sov_over_time', Card: SovOverTimeCard, options: ENGINE },
  { type: 'ai.sov_rank', Card: SovRankCard, options: ENGINE },
  { type: 'ai.co_mentions', Card: CoMentionsCard, options: ENGINE },
  { type: 'ai.competitor_table', Card: CompetitorTableCard, options: { metric: 'mention', rows: '5' } },
];

const listeners: ((info: { request: Request }) => void)[] = [];
/** The paths of the requests the server sees from now on. */
function recordRequests(): string[] {
  const seen: string[] = [];
  const listener = ({ request }: { request: Request }): void => {
    seen.push(new URL(request.url).pathname);
  };
  listeners.push(listener);
  server.events.on('request:start', listener);
  return seen;
}
const summaries = (seen: readonly string[]): string[] => seen.filter((path) => path.endsWith('/ai/prompts-summary'));
const entityReads = (seen: readonly string[]): string[] => seen.filter((path) => path.endsWith('/entities'));

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

function renderCard({ type, Card, options }: Case, live: boolean): void {
  function Fixed(props: CardProps): ReactElement {
    return <Card {...props} options={options} live={live} />;
  }
  // No `cmp`: the comparison is on, so the previous window is a read that must stay quiet too
  renderWithProviders(cardInOverview({ type, Card: Fixed }));
}

describe('the competitor cards in customize mode', () => {
  describe.each(CASES)('$type', (entry) => {
    it('asks no summary and shows no error while it is not subscribed', async () => {
      const seen = recordRequests();
      renderCard(entry, false);
      // The card is mounted once it reads the tracked set, which it does whatever the summary does
      await waitFor(() => {
        expect(entityReads(seen).length).toBeGreaterThan(0);
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(summaries(seen)).toEqual([]);
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.queryByText(/^Could not load/)).not.toBeInTheDocument();
    });

    it('loads the summary while it is subscribed', async () => {
      const seen = recordRequests();
      renderCard(entry, true);
      await waitFor(() => {
        expect(summaries(seen).length).toBeGreaterThan(0);
      });
    });
  });
});

describe('the titles of the competitor cards', () => {
  const family = messages.aiOverview.competitors;
  const titles = [
    family.shareOfVoice.title,
    family.lostTo.title,
    family.trend.title,
    family.sovOverTime.title,
    family.sovRank.title,
    family.coMentions.title,
    family.table.title,
  ];

  it('are all different, so two cards of the family never share a heading', () => {
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('names share of voice over time as over time, apart from the share of voice of one engine', () => {
    expect(family.sovOverTime.title).toContain('over time');
    expect(family.shareOfVoice.title).not.toContain('over time');
  });
});
