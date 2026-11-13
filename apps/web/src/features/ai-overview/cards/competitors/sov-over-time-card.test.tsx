import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SovOverTimeCard from './sov-over-time-card';
import { id } from './model/summary-fixtures';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import {
  drawnOption,
  drawnSeries,
  ENGINE,
  entityRows,
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
  weeklySummary,
  yAxisOf,
  type WeekSpec,
} from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const TYPE = 'ai.sov_over_time';
const TITLE = 'Share of voice on ChatGPT';
const OPTIONS = { engine: ENGINE };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function drawColumns(options: Record<string, string> = OPTIONS): Promise<ReturnType<typeof renderCard>> {
  const rendered = renderCard(TYPE, SovOverTimeCard, options);
  await screen.findByTestId('echart-canvas');
  return rendered;
}

const stacked = (): string[] =>
  drawnSeries()
    .filter((entry) => entry.stack === 'total')
    .map((entry) => entry.id);

/** Seven brands: the palette has six slots, so the seventh folds into Other tracked. */
const SEVEN_NAMES = [...SIX_NAMES, 'Monday'];
const sevenWeeks = (): WeekSpec[] =>
  SIX_WEEKS.map((spec) => ({
    ...spec,
    numerators: [...spec.numerators.slice(0, 5), (spec.numerators[5] ?? 0) / 2, (spec.numerators[5] ?? 0) / 2],
    mentions: { n: spec.mentions.n, ks: [...spec.mentions.ks, 10] },
  }));

describe('the share of voice over time card (CH-19)', () => {
  it('draws 100 percent columns: you at the bottom, the palette in order, other tracked on top, axis 0 to 1', async () => {
    serveWorld(weeklySummary({ weeks: sevenWeeks(), names: SEVEN_NAMES }), entityRows(SEVEN_NAMES));
    await drawColumns();
    expect(stacked()).toEqual([id(1), id(2), id(3), id(4), id(5), id(6), 'other']);
    expect(yAxisOf()).toMatchObject({ min: 0, max: 1 });
    const colours = Object.fromEntries(drawnSeries().map((entry) => [entry.id, entry.color]));
    expect(colours[id(1)]).toBe('#c1');
    expect(colours[id(2)]).toBe('#c2');
    expect(colours.other).toBe('#other');
    // A good week adds up to 1: the folded brand's share is in Other tracked
    const column = drawnSeries()
      .filter((entry) => entry.stack === 'total')
      .map((entry) => entry.data[1] as number);
    expect(column.reduce((total, value) => total + value, 0)).toBeCloseTo(1, 10);
    expect(drawnSeries().find((entry) => entry.id === 'other')?.data[1]).toBeCloseTo(0.05, 10);
  });

  it('has no other tracked series while every brand has a slot', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawColumns();
    expect(stacked()).toEqual([id(1), id(2), id(3)]);
    expect(screen.getByRole('img', { name: TITLE })).toHaveStyle({ height: '280px' });
  });

  it('draws a week with fewer than 4 answers naming a tracked brand as an empty column that says too few', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawColumns();
    for (const entry of drawnSeries().filter((candidate) => candidate.stack === 'total')) {
      // The leading week with no answers and the thin week are not 0: they have no value
      expect(entry.data[0]).toBeNull();
      expect(entry.data[2]).toBeNull();
      expect(entry.data[1]).not.toBeNull();
    }
    const placeholder = drawnSeries().find((entry) => entry.id === 'too-few');
    expect(placeholder?.data).toEqual([1, null, 1, null, null]);
    expect(tooltipText(2)).toContain('Too few answers name a tracked brand that week: 3 answers, fewer than 4');
    expect(tooltipText(0)).toContain('0 answers, fewer than 4');
    expect(tooltipText(2)).not.toContain('%');
  });

  it('says of how many answers naming a tracked brand each share is, best first', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawColumns();
    const words = tooltipText(1);
    expect(words).toContain('Week of Oct 19');
    expect(words).toContain('Of 100 answers naming a tracked brand that week');
    expect(words).toContain('Fynix|40%');
    expect(words.indexOf('Fynix')).toBeLessThan(words.indexOf('HubSpot'));
    expect(words.indexOf('HubSpot')).toBeLessThan(words.indexOf('Zoho'));
  });

  it('names the weeks a pooled week holds, and says the pooling rule in the footnote', async () => {
    serveWorld(weeklySummary({ weeks: POOLED_WEEKS }), entityRows());
    await drawColumns();
    expect(tooltipText(3)).toContain('Week of Nov 2, 4 weeks together (Oct 19 to Nov 9, 2026)');
    expect(screen.getByText(/shows the last 4 weeks together/)).toBeInTheDocument();
  });

  it('names the tracked set in the footnote and draws the boundary on the week a competitor was added', async () => {
    serveWorld(weeklySummary({ versions: [1, 2] }), entityRows(NAMES, { HubSpot: '2026-10-28T09:00:00Z' }));
    const { unmount } = await drawColumns();
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('Tracked brands: you and 2 competitors.');
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('Added in this window: HubSpot on Oct 28.');
    const boundary = drawnSeries().find((entry) => entry.id === 'boundaries');
    expect(boundary?.markLine?.data.map((entry) => entry.xAxis)).toEqual(['Oct 26']);
    unmount();

    serveWorld(weeklySummary(), entityRows());
    await drawColumns();
    expect(drawnSeries().some((entry) => entry.id === 'boundaries')).toBe(false);
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('Tracked brands: you and 2 competitors.');
  });

  it('adds decals with the Patterns toggle', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawColumns();
    expect(drawnOption().aria).toMatchObject({ decal: { show: false } });
    await user.click(screen.getByRole('button', { name: 'Patterns' }));
    expect(drawnOption().aria).toMatchObject({ decal: { show: true } });
  });

  it('toggles a brand from the legend', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawColumns();
    const legend = screen.getByRole('list', { name: `Series in ${TITLE}` });
    await user.click(within(legend).getByRole('button', { name: 'Zoho' }));
    expect(stacked()).not.toContain(id(3));
  });

  it('prints every week in the Table view with its share and its denominator, and no value for an empty column', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawColumns();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Week', 'Fynix', 'HubSpot', 'Zoho']);
    expect(within(table).getByRole('row', { name: /Oct 19/ })).toHaveTextContent(
      '40%, of 100 answers naming a tracked brand',
    );
    // An empty column has no value: the frame's table says "No data" for it, never 0
    const thin = within(table).getByRole('row', { name: /Oct 26/ });
    expect(thin).toHaveTextContent('No data');
    expect(thin).not.toHaveTextContent('0%');
  });

  it('hands its table to the export under the layout item id', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawColumns();
    const [block] = await readExport(user);
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual(['week', 'brand', 'share_of_voice', 'answers_naming_tracked', 'state']);
    expect(block?.rows).toContainEqual(['2026-10-19', 'Fynix', 40, 100, 'ok']);
    expect(block?.rows).toContainEqual(['2026-10-26', 'Fynix', null, 3, 'insufficient']);
  });

  it('has no serious accessibility violation when it is ready', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { container } = await drawColumns();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the share of voice over time card states', () => {
  it('asks for two weeks when only one week has answers', async () => {
    serveWorld(weeklySummary({ weeks: WEEKS.slice(0, 2) }), entityRows());
    renderCard(TYPE, SovOverTimeCard, OPTIONS);
    expect(await screen.findByText('A trend needs two weeks of answers')).toBeInTheDocument();
  });

  it('says too few answers name a tracked brand when no week has enough', async () => {
    const thin = [
      { start: '2026-10-19', answers: 1, numerators: [1, 0, 0], mentions: { n: 10, ks: [1, 0, 0] } },
      { start: '2026-10-26', answers: 1, numerators: [0, 1, 0], mentions: { n: 10, ks: [0, 1, 0] } },
    ];
    serveWorld(weeklySummary({ weeks: thin }), entityRows());
    renderCard(TYPE, SovOverTimeCard, OPTIONS);
    expect(await screen.findByText('Too few answers name a tracked brand (2)')).toBeInTheDocument();
  });

  it('says no competitor is tracked when only you are', async () => {
    serveWorld(weeklySummary({ names: ['Fynix'] }), entityRows(['Fynix']));
    renderCard(TYPE, SovOverTimeCard, OPTIONS);
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
  });

  it('says the engine is not asked when the project has it off', async () => {
    renderCard(TYPE, SovOverTimeCard, { engine: 'google_ai_mode' });
    expect(await screen.findByText('AI Mode is not asked in this scope')).toBeInTheDocument();
  });

  it('shows Try again when the read failed', async () => {
    serveSummaryFailure();
    renderCard(TYPE, SovOverTimeCard, OPTIONS);
    expect(await screen.findByText('Could not load share of voice over time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
