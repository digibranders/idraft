import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SovRankCard from './sov-rank-card';
import { id } from './model/summary-fixtures';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import {
  drawnCategories,
  drawnSeries,
  ENGINE,
  entityRows,
  idleWeek,
  NAMES,
  POOLED_WEEKS,
  readExport,
  renderCard,
  serveSummaryFailure,
  serveWorld,
  SIX_NAMES,
  SIX_WEEKS,
  tooltipText,
  WEEKS,
  WEEKS_WITH_GAP,
  weeklySummary,
  yAxisOf,
  type WeekSpec,
} from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const TYPE = 'ai.sov_rank';
const TITLE = 'Share of voice rank on ChatGPT';
const OPTIONS = { engine: ENGINE };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function drawRanks(): Promise<ReturnType<typeof renderCard>> {
  const rendered = renderCard(TYPE, SovRankCard, OPTIONS);
  await screen.findByTestId('echart-canvas');
  return rendered;
}

const lines = (): Record<string, unknown[]> =>
  Object.fromEntries(
    drawnSeries()
      .filter((entry) => entry.id !== 'boundaries')
      .map((entry) => [entry.id, entry.data]),
  );

/** Four weeks with no pooled point, so the card pools the trailing four weeks itself. */
const STARTS = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'] as const;
const unpooled = (shares: readonly (readonly number[])[], from = 0): WeekSpec[] =>
  shares.map((numerators, index) => ({
    start: STARTS[from + index] ?? '2026-11-16',
    answers: numerators.reduce((total, value) => total + value, 0),
    numerators,
    mentions: { n: 100, ks: [10, 10, 10] },
  }));

describe('the share of voice rank card (CH-29)', () => {
  it('draws an inverted whole number axis from 1 to the lowest rank drawn, with no SERP guide lines', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawRanks();
    expect(yAxisOf()).toMatchObject({ inverse: true, min: 1, max: 3, interval: 1, minInterval: 1 });
    for (const entry of drawnSeries()) {
      expect(entry.markArea).toBeUndefined();
      if (entry.id !== 'boundaries') expect(entry.markLine).toBeUndefined();
    }
    expect(screen.getByRole('img', { name: TITLE })).toHaveStyle({ height: '240px' });
  });

  it('ranks the weekly shares as read when the server pooled a point, and gives a thin week no rank, not last place', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawRanks();
    // The 3 answer week is a gap for every brand
    expect(lines()).toEqual({
      [id(1)]: [1, null, 2, 2],
      [id(2)]: [2, null, 1, 1],
      [id(3)]: [3, null, 3, 3],
    });
    // The week the server pooled is the leading one with no answers, left off the axis: it still says how it ranks
    expect(screen.getByText(/ranked on the points as the server pooled them/)).toBeInTheDocument();
  });

  it('starts the axis at the first week with answers and ends at the last, and keeps an empty week between as a gap', async () => {
    serveWorld(
      weeklySummary({ weeks: [idleWeek('2026-10-05'), ...WEEKS_WITH_GAP, idleWeek('2026-11-16')] }),
      entityRows(),
    );
    await drawRanks();
    expect(drawnCategories()).toEqual(['Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
    expect(lines()[id(1)]).toEqual([1, null, 2, 2]);
  });

  it('pools the trailing four weeks itself when no point is pooled, and the first thin week is a gap', async () => {
    const weeks: WeekSpec[] = [
      { start: '2026-10-19', answers: 3, numerators: [1, 1.5, 0.5], mentions: { n: 3, ks: [1, 1, 1] } },
      ...unpooled(
        [
          [40, 35, 25],
          [30, 40, 30],
        ],
        1,
      ),
    ];
    serveWorld(weeklySummary({ weeks }), entityRows());
    await drawRanks();
    // Week 1 alone has 3 answers; week 2 is the pool of weeks 1 and 2 (103 answers), week 3 of all three (203)
    const data = lines();
    expect(data[id(1)]).toEqual([null, 1, 2]);
    expect(data[id(2)]).toEqual([null, 2, 1]);
    expect(screen.getByText(/ranked on the answers of the last 4 weeks together/)).toBeInTheDocument();
  });

  it('draws tied brands at the same rank and the next one below the tie', async () => {
    const tie = [40, 40, 20];
    serveWorld(weeklySummary({ weeks: unpooled([tie, tie, tie, tie]) }), entityRows());
    await drawRanks();
    expect(lines()).toEqual({
      [id(1)]: [1, 1, 1, 1],
      [id(2)]: [1, 1, 1, 1],
      [id(3)]: [3, 3, 3, 3],
    });
  });

  it('says the rank, the share and the answers behind it in the tooltip, best rank first', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawRanks();
    const words = tooltipText(2);
    expect(words).toContain('Week of Nov 2');
    expect(words).toContain('HubSpot|Rank 1, 45%');
    expect(words).toContain('Fynix|Rank 2, 30%');
    expect(words).toContain('120 answers naming a tracked brand');
    expect(words.indexOf('HubSpot')).toBeLessThan(words.indexOf('Fynix'));
    expect(tooltipText(1)).toContain('Too few answers name a tracked brand (3): this week has no rank');
    expect(tooltipText(1)).not.toMatch(/Rank \d/);
  });

  it('says in the footer how many weeks a pooled point holds, and nothing of weeks on a plain point', async () => {
    serveWorld(weeklySummary({ weeks: POOLED_WEEKS }), entityRows());
    await drawRanks();
    expect(tooltipText(2)).toContain('120 answers naming a tracked brand, 4 weeks together');
    expect(tooltipText(3)).toContain('100 answers naming a tracked brand');
    expect(tooltipText(3)).not.toContain('together');
  });

  it('says how many tracked brands are not drawn: you and the 5 with the highest share', async () => {
    const weeks = SIX_WEEKS.map((spec) => ({
      ...spec,
      numerators: [...spec.numerators.slice(0, 5), (spec.numerators[5] ?? 0) / 2, (spec.numerators[5] ?? 0) / 2],
      mentions: { n: spec.mentions.n, ks: [...spec.mentions.ks, 10] },
    }));
    const names = [...SIX_NAMES, 'Monday'];
    serveWorld(weeklySummary({ weeks, names }), entityRows(names));
    await drawRanks();
    // You, then HubSpot, Pipedrive, Zoho, Salesforce and Freshworks by share. Monday is the seventh brand: its
    // colour_index is 7, so it has no palette slot and colorSlots leaves it out, whatever its share
    expect(Object.keys(lines())).toEqual([id(1), id(2), id(4), id(3), id(5), id(6)]);
    expect(
      screen.getByText('1 tracked brand is not drawn: you and the 5 competitors with the highest share are.'),
    ).toBeInTheDocument();
  });

  it('draws the boundary on the week a competitor was added when the set changed', async () => {
    serveWorld(weeklySummary({ versions: [1, 2] }), entityRows(NAMES, { Zoho: '2026-11-04T09:00:00Z' }));
    await drawRanks();
    expect(
      drawnSeries()
        .find((entry) => entry.id === 'boundaries')
        ?.markLine?.data.map((entry) => entry.xAxis),
    ).toEqual(['Nov 2']);
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('Zoho on Nov 4');
  });

  it('summarises where you rank in the latest ranked week', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawRanks();
    expect(screen.getByRole('img', { name: TITLE })).toHaveAccessibleDescription(
      'Fynix ranks 2 of 3 tracked brands by share of voice on ChatGPT in the week of Nov 9.',
    );
  });

  it('prints the rank and share of every week in the Table view, and no value for a gap', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawRanks();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: TITLE });
    expect(within(table).getByRole('row', { name: /Oct 19/ })).toHaveTextContent('Rank 1, 40%');
    const gap = within(table).getByRole('row', { name: /Oct 26/ });
    expect(gap).toHaveTextContent('No data');
    expect(gap).not.toHaveTextContent('Rank');
  });

  it('hands its table to the export under the layout item id', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawRanks();
    const [block] = await readExport(user);
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['week', 'brand', 'rank', 'share_of_voice', 'answers_naming_tracked']);
    expect(block?.rows).toContainEqual(['2026-10-19', 'Fynix', 1, 40, 100]);
    expect(block?.rows).toContainEqual(['2026-10-26', 'Fynix', null, null, 3]);
  });

  it('has no serious accessibility violation when it is ready', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { container } = await drawRanks();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the share of voice rank card states', () => {
  it('says a rank needs at least 3 tracked brands when fewer are tracked', async () => {
    serveWorld(weeklySummary({ names: ['Fynix', 'HubSpot'] }), entityRows(['Fynix', 'HubSpot']));
    renderCard(TYPE, SovRankCard, OPTIONS);
    expect(await screen.findByText('A rank needs at least 3 tracked brands')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('asks for two weeks when only one week can be ranked', async () => {
    serveWorld(weeklySummary({ weeks: WEEKS.slice(0, 2) }), entityRows());
    renderCard(TYPE, SovRankCard, OPTIONS);
    expect(await screen.findByText('A trend needs two weeks of answers')).toBeInTheDocument();
  });

  it('says the engine is not asked when the project has it off', async () => {
    renderCard(TYPE, SovRankCard, { engine: 'google_ai_mode' });
    expect(await screen.findByText('AI Mode is not asked in this scope')).toBeInTheDocument();
  });

  it('shows Try again when the read failed', async () => {
    serveSummaryFailure();
    renderCard(TYPE, SovRankCard, OPTIONS);
    expect(await screen.findByText('Could not load share of voice rank')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
