import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CompetitorTrendCard from './competitors/competitor-trend-card';
import { at } from './competitors/model/summary-fixtures';
import SovOverTimeCard from './competitors/sov-over-time-card';
import SovRankCard from './competitors/sov-rank-card';
import RateTrendCard from './engines/rate-trend-card';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary, WeekCells } from '@/lib/api/types';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import {
  entityRows,
  POOLED_WEEKS,
  readExport,
  renderCard,
  serveEntities,
  tooltipText,
  WEEKS,
  weeklySummary,
  type WeekSpec,
} from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

/*
 * The cards that draw share of voice week by week, and only they, ask for the per-brand weekly cells of the server
 * (`include=series,entities`, with the `total` the weeks belong to and no row lists). Every other read of the page keeps
 * its own include, so no card makes a heavier read than it needs and the cache never mixes the two.
 */

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Serves `summary` and gives the URL of every summary read, in order. */
function serveRecording(summary: PromptsSummary): URL[] {
  const urls: URL[] = [];
  server.use(
    http.get(SUMMARY, ({ request }) => {
      urls.push(new URL(request.url));
      return HttpResponse.json({ data: summary });
    }),
  );
  serveEntities(entityRows());
  return urls;
}

/** The values of the `include` parameter of a read, whether it is repeated or a comma list. */
const includeOf = (url: URL): string[] =>
  url.searchParams
    .getAll('include')
    .flatMap((value) => value.split(','))
    .sort();

async function readsOf(type: string, Card: ComponentType<CardProps>, searchParams: string): Promise<URL[]> {
  const urls = serveRecording(weeklySummary());
  renderCard(type, Card, { engine: 'chatgpt_web' }, { searchParams });
  await waitFor(() => {
    expect(urls.length).toBeGreaterThan(0);
  });
  await screen.findByTestId('echart-canvas');
  return urls;
}

describe('the weekly share of voice cards ask for the per-brand weekly cells', () => {
  it.each([
    ['Share of voice over time', 'ai.sov_over_time', SovOverTimeCard, 'cmp=off'],
    ['Share of voice rank', 'ai.sov_rank', SovRankCard, 'cmp=off'],
    ['the competitor trend', 'ai.competitor_trend', CompetitorTrendCard, 'cmp=off'],
    ['the rate trend with the metric Share of voice', 'ai.rate_trend_by_engine', RateTrendCard, 'cmp=off&metric=sov'],
  ] as const)('%s: include=series,entities with the total, and no rows', async (_name, type, Card, searchParams) => {
    const urls = await readsOf(type, Card, searchParams);
    for (const url of urls) {
      expect(includeOf(url)).toEqual(['entities', 'series', 'total']);
      expect(url.searchParams.get('rows')).toBe('none');
    }
  });

  it('leaves the rate trend with any other metric on its own read: the weekly points of the prompt rows, no entity cells', async () => {
    const urls = await readsOf('ai.rate_trend_by_engine', RateTrendCard, 'cmp=off&metric=mention');
    for (const url of urls) {
      expect(includeOf(url)).toEqual(['series']);
      expect(url.searchParams.get('rows')).toBeNull();
    }
  });

  it('keeps the two reads of the rate trend apart: another metric is another request, so the cache never mixes them', async () => {
    const urls = serveRecording(weeklySummary());
    const { user } = renderCard(
      'ai.rate_trend_by_engine',
      RateTrendCard,
      {},
      { searchParams: 'cmp=off&metric=mention' },
    );
    await screen.findByTestId('echart-canvas');
    const before = urls.length;
    await user.click(screen.getByRole('radio', { name: 'Share of voice' }));
    await waitFor(() => {
      expect(urls.length).toBeGreaterThan(before);
    });
    const asked = urls.slice(before).map((url) => includeOf(url).join(','));
    expect(asked).toContain('entities,series,total');
  });
});

/** ChatGPT's weeks as read, and Gemini's of other counts, both on the total of one summary. */
function twoPlatforms(second: readonly WeekSpec[]): PromptsSummary {
  const first = weeklySummary();
  const gemini = at(weeklySummary({ weeks: second }).total?.engines ?? [], 0);
  const total = first.total;
  if (total === undefined || total === null) throw new Error('The fixture has no total');
  return { ...first, total: { ...total, engines: [...total.engines, { ...gemini, engine_code: 'gemini_web' }] } };
}

const GEMINI_WEEKS: readonly WeekSpec[] = WEEKS.map((spec) =>
  spec.start === '2026-10-19'
    ? { ...spec, answers: 40, numerators: [20, 12, 8], mentions: { n: 40, ks: [20, 12, 8] } }
    : spec,
);

describe('the rate trend with the metric Share of voice', () => {
  it('writes the counts of each platform in the tooltip of the Average (R3), and x of y brand mentions on a platform', async () => {
    serveRecording(twoPlatforms(GEMINI_WEEKS));
    renderCard('ai.rate_trend_by_engine', RateTrendCard, {}, { searchParams: 'cmp=off&metric=sov' });
    await screen.findByTestId('echart-canvas');
    // The week of Oct 19: ChatGPT 80 of 200 (40%) and Gemini 20 of 40 (50%), their average 45%
    const tip = tooltipText(1);
    expect(tip).toContain('ChatGPT|40.0%, 80 of 200 brand mentions');
    expect(tip).toContain('Gemini|50.0%, 20 of 40 brand mentions');
    expect(tip).toContain(
      'Average of 2 platforms, each counting once. Brand mentions: ChatGPT 80 of 200 and Gemini 20 of 40',
    );
  });

  it('says which weeks a pooled point holds, in the words of the API pool, in the tooltip and the export', async () => {
    serveRecording(weeklySummary({ weeks: POOLED_WEEKS }));
    const { user } = renderCard(
      'ai.rate_trend_by_engine',
      RateTrendCard,
      {},
      { searchParams: 'cmp=off&metric=sov&engine=chatgpt_web' },
    );
    await screen.findByTestId('echart-canvas');
    // The week of Nov 2 is the fourth point (the leading week of Oct 12 has no answer but is on the axis)
    expect(tooltipText(3)).toContain('31.8%, 84 of 264 brand mentions, 4 weeks together (Oct 19 to Nov 9, 2026)');
    expect(tooltipText(4)).not.toContain('together');
    const [block] = await readExport(user);
    expect(block?.header).toContain('weeks_held');
    expect(block?.rows).toContainEqual(
      expect.arrayContaining(['2026-11-02', 'ChatGPT', 31.8, 84, 264, '2026-10-19 to 2026-11-09']),
    );
  });

  it('says More than 20 tracked brands, with no line, when the weekly cells stop at 20 of a longer set', async () => {
    const names = Array.from({ length: 21 }, (_, index) => (index === 0 ? 'Fynix' : `Rival ${String(index)}`));
    const summary = weeklySummary({ names });
    const total = summary.total;
    if (total === undefined || total === null) throw new Error('The fixture has no total');
    const cut = (week: WeekCells): WeekCells => ({ ...week, entities: week.entities?.slice(0, 20) ?? [] });
    const engines = total.engines.map((entry) => ({
      ...entry,
      entities: entry.entities?.slice(0, 20) ?? [],
      series: entry.series?.map(cut) ?? [],
    }));
    serveRecording({ ...summary, total: { ...total, engines } });
    renderCard('ai.rate_trend_by_engine', RateTrendCard, {}, { searchParams: 'cmp=off&metric=sov' });
    expect(await screen.findByText('More than 20 tracked brands')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('says Not collected yet, with no line, when the weekly points hold no cell for a tracked brand', async () => {
    const summary = weeklySummary();
    const total = summary.total;
    if (total === undefined || total === null) throw new Error('The fixture has no total');
    const bare = (week: WeekCells): WeekCells => ({ ...week, entities: [] });
    const engines = total.engines.map((entry) => ({ ...entry, series: entry.series?.map(bare) ?? [] }));
    serveRecording({ ...summary, total: { ...total, engines } });
    renderCard('ai.rate_trend_by_engine', RateTrendCard, {}, { searchParams: 'cmp=off&metric=sov' });
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });
});
