import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CompetitorTrendCard from './competitor-trend-card';
import { at } from './model/summary.test-fixtures';
import SovOverTimeCard from './sov-over-time-card';
import SovRankCard from './sov-rank-card';
import { stubViewport } from '@/test/customize-harness';
import type { PromptsSummary, WeekCells } from '@/lib/api/types';
import {
  ENGINE,
  entityRows,
  idleWeek,
  POOLED_WEEKS,
  readExport,
  renderCard,
  serveWorld,
  tooltipText,
  WEEKS,
  WEEKS_WITH_GAP,
  weeklySummary,
  type WeekSpec,
} from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

/*
 * The weekly cards of share of voice (Share of voice over time, its rank, the competitor trend) read the per-brand weekly
 * cells of `include=series,entities` and write each brand's week as "x of y brand mentions" in the tooltip, the Table
 * view and the export, with the weeks a pooled point holds, n/a for a week with no tracked-brand mention, and a reason
 * where the read has no counts to give.
 */

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ONE_PLATFORM = 'cmp=off&engine=chatgpt_web';
const ALL_PLATFORMS = 'cmp=off';

/** The weekly summary of the first engine, with a second platform of other counts added to its total. */
function twoPlatforms(second: readonly WeekSpec[]): PromptsSummary {
  const first = weeklySummary();
  const gemini = at(weeklySummary({ weeks: second }).total?.engines ?? [], 0);
  const total = first.total;
  if (total === undefined || total === null) throw new Error('The fixture has no total');
  return { ...first, total: { ...total, engines: [...total.engines, { ...gemini, engine_code: 'gemini_web' }] } };
}

/** Gemini's own counts: its week of Oct 19 is 20 of 40 brand mentions for the own brand (50%), where ChatGPT's is 80 of 200. */
const GEMINI_WEEKS: readonly WeekSpec[] = WEEKS.map((spec) =>
  spec.start === '2026-10-19'
    ? { ...spec, answers: 40, numerators: [20, 12, 8], mentions: { n: 40, ks: [20, 12, 8] } }
    : spec,
);

/** The same summary with the tracked set one brand longer than the 20 cells the API lists. */
function cappedSummary(): PromptsSummary {
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
  return { ...summary, total: { ...total, engines } };
}

/** The weekly points hold no cell for any tracked brand, as an API that does not send them. */
function withoutBrandCells(summary: PromptsSummary): PromptsSummary {
  const total = summary.total;
  if (total === undefined || total === null) throw new Error('The fixture has no total');
  const strip = (week: WeekCells): WeekCells => ({ ...week, entities: [] });
  const engines = total.engines.map((entry) => ({ ...entry, series: entry.series?.map(strip) ?? [] }));
  return { ...summary, total: { ...total, engines } };
}

/** The charts that draw data: the faint curve behind an empty state is a drawing and does not count. */
const dataCharts = (): HTMLElement[] =>
  screen.queryAllByTestId('echart-canvas').filter((node) => node.closest('[data-slot="ghost-trend"]') === null);

describe('the share of voice over time card writes x of y brand mentions', () => {
  it('beside each brand in the tooltip of a week, for one platform', async () => {
    serveWorld(weeklySummary(), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    // The week of Oct 19: 80, 70 and 50 of 200 brand mentions
    const words = tooltipText(0);
    expect(words).toContain('Week of Oct 19');
    expect(words).toContain('Fynix (you)|40%, 80 of 200 brand mentions');
    expect(words).toContain('HubSpot|35%, 70 of 200 brand mentions');
    expect(words).toContain('Zoho|25%, 50 of 200 brand mentions');
  });

  it('with the counts of each platform beside the average for All platforms, never one pooled count', async () => {
    serveWorld(twoPlatforms(GEMINI_WEEKS), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ALL_PLATFORMS });
    await screen.findByTestId('echart-canvas');
    // ChatGPT 80 of 200 (40%) and Gemini 20 of 40 (50%): the average is 45%
    // The counts of the platforms are a line of their own under the share, so a long row is wrapped and not cut
    expect(tooltipText(0)).toContain('Fynix (you)|45%|Brand mentions: ChatGPT 80 of 200 and Gemini 20 of 40');
    expect(tooltipText(0)).toContain('HubSpot|');
  });

  it('says the same, in one cell, in the Table view of an average', async () => {
    serveWorld(twoPlatforms(GEMINI_WEEKS), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ALL_PLATFORMS });
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(within(screen.getByRole('table')).getByRole('row', { name: /Oct 19/ })).toHaveTextContent(
      '45%, average of 2 platforms, each counting once. Brand mentions: ChatGPT 80 of 200 and Gemini 20 of 40',
    );
  });

  it('says the same in the Table view', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Share of voice over time' });
    expect(within(table).getByRole('row', { name: /Oct 19/ })).toHaveTextContent('40%, 80 of 200 brand mentions');
  });

  it('says which weeks a pooled point holds, in the words of the API pool', async () => {
    serveWorld(weeklySummary({ weeks: POOLED_WEEKS }), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    expect(tooltipText(2)).toContain('Week of Nov 2, 4 weeks together (Oct 19 to Nov 9, 2026)');
    expect(tooltipText(3)).not.toContain('together');
  });

  it('shows n/a, not 0, for a week with no tracked-brand mention, and the few of a thin week', async () => {
    serveWorld(weeklySummary({ weeks: WEEKS_WITH_GAP }), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    // The week of Oct 26 is between two weeks that have answers
    expect(tooltipText(1)).toContain('n/a: no brand mentions that week');
    expect(tooltipText(1)).not.toMatch(/0%|0 of/);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    // The Table view's own word for a cell without a value
    expect(within(screen.getByRole('table')).getByRole('row', { name: /Oct 26/ })).toHaveTextContent('No data');
  });

  it('gives a thin week the few brand mentions it has and no percent', async () => {
    serveWorld(weeklySummary(), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    expect(tooltipText(1)).toContain('Too few brand mentions that week: 3 brand mentions, fewer than 4');
  });

  it('exports the mentions and the brand mentions of every brand and week, the weeks a point holds, and n/a for no mention', async () => {
    serveWorld(weeklySummary({ weeks: [...POOLED_WEEKS.slice(0, 5), idleWeek('2026-11-16')] }), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    await screen.findByTestId('echart-canvas');
    const [block] = await readExport(user);
    expect(block?.header).toEqual([
      'Week',
      'Brand',
      'Share of voice',
      'Brand mentions',
      'Brand mentions of all tracked brands',
      'Brand mentions of each platform',
      'Weeks held',
      'Status',
    ]);
    expect(block?.rows).toContainEqual(['2026-10-19', 'Fynix', 40, 80, 200, null, null, 'ok']);
    expect(block?.rows).toContainEqual(['2026-11-02', 'Fynix', 31.8, 84, 264, null, '2026-10-19 to 2026-11-09', 'ok']);
    expect(block?.rows).toContainEqual(['2026-10-26', 'Fynix', null, 1, 3, null, null, 'insufficient']);
  });

  it('exports the counts of the one platform that has data under All platforms, as for one platform', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ALL_PLATFORMS });
    await screen.findByTestId('echart-canvas');
    const [block] = await readExport(user);
    expect(block?.rows).toContainEqual(['2026-10-19', 'Fynix', 40, 80, 200, null, null, 'ok']);
  });

  it('exports each platform of an average, which has no count of its own', async () => {
    serveWorld(twoPlatforms(GEMINI_WEEKS), entityRows());
    const { user } = renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ALL_PLATFORMS });
    await screen.findByTestId('echart-canvas');
    const [block] = await readExport(user);
    expect(block?.rows).toContainEqual([
      '2026-10-19',
      'Fynix',
      45,
      null,
      null,
      'ChatGPT 80 of 200; Gemini 20 of 40',
      null,
      'ok',
    ]);
  });

  it('says More than 20 tracked brands, and draws no layer, when the cells stop at 20 of a longer set', async () => {
    serveWorld(cappedSummary(), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    expect(await screen.findByText('More than 20 tracked brands')).toBeInTheDocument();
    expect(dataCharts()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says Not collected yet when the weekly points hold no cell for a tracked brand', async () => {
    serveWorld(withoutBrandCells(weeklySummary()), entityRows());
    renderCard('ai.sov_over_time', SovOverTimeCard, {}, { searchParams: ONE_PLATFORM });
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(dataCharts()).toHaveLength(0);
  });
});

describe('the share of voice rank card writes x of y brand mentions', () => {
  const options = { engine: ENGINE };

  it('beside each rank in the tooltip and the Table view', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = renderCard('ai.sov_rank', SovRankCard, options);
    await screen.findByTestId('echart-canvas');
    expect(tooltipText(0)).toContain('Fynix|Rank 1, 40%, 80 of 200 brand mentions');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(within(screen.getByRole('table')).getByRole('row', { name: /Oct 19/ })).toHaveTextContent(
      'Rank 1, 40%, 80 of 200 brand mentions',
    );
  });

  it('says which weeks a point the API pooled holds', async () => {
    serveWorld(weeklySummary({ weeks: POOLED_WEEKS }), entityRows());
    renderCard('ai.sov_rank', SovRankCard, options);
    await screen.findByTestId('echart-canvas');
    expect(tooltipText(2)).toContain('Week of Nov 2, 4 weeks together (Oct 19 to Nov 9, 2026)');
  });

  it('says n/a, not 0, for a week with no tracked-brand mention', async () => {
    serveWorld(weeklySummary({ weeks: WEEKS_WITH_GAP }), entityRows());
    const { user } = renderCard('ai.sov_rank', SovRankCard, options);
    await screen.findByTestId('echart-canvas');
    expect(tooltipText(1)).toContain('n/a: no brand mentions this week');
    const [block] = await readExport(user);
    expect(block?.rows).toContainEqual(['2026-10-26', 'Fynix', null, null, null, null, null, 'none']);
  });

  it('says More than 20 tracked brands, as a state of the card and not an error', async () => {
    serveWorld(cappedSummary(), entityRows());
    renderCard('ai.sov_rank', SovRankCard, options);
    expect(await screen.findByText('More than 20 tracked brands')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('says Not collected yet, as a state of the card and not an error, when the weeks hold no brand cell', async () => {
    serveWorld(withoutBrandCells(weeklySummary()), entityRows());
    renderCard('ai.sov_rank', SovRankCard, options);
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('the competitor trend card, which reads the same weekly cells', () => {
  const options = { engine: ENGINE };

  it('says Not collected yet, as a state of the card, when the weeks hold no brand cell', async () => {
    serveWorld(withoutBrandCells(weeklySummary()), entityRows());
    renderCard('ai.competitor_trend', CompetitorTrendCard, options);
    // The mention rate of a brand needs its weekly cell as well
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
  });

  it('says More than 20 tracked brands at the cap', async () => {
    serveWorld(cappedSummary(), entityRows());
    renderCard('ai.competitor_trend', CompetitorTrendCard, options);
    expect(await screen.findByText('More than 20 tracked brands')).toBeInTheDocument();
  });
});
