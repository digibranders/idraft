import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CompetitorTrendCard from './competitor-trend-card';
import { id } from './model/summary-fixtures';
import { loadingBodyHeight } from './skeletons';
import { axe } from '@/test/axe';
import { chartSummaryText } from '@/test/chart-summary';
import { stubViewport } from '@/test/customize-harness';
import {
  drawnCategories,
  drawnOption,
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
} from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const TYPE = 'ai.competitor_trend';
const TITLE = 'Mention rate on ChatGPT';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The card on the engine of the fixtures; the chart is drawn once its heading and canvas are in. */
async function drawTrend(
  options: Record<string, string> = { engine: ENGINE, competitors: '3' },
): Promise<ReturnType<typeof renderCard>> {
  const rendered = renderCard(TYPE, CompetitorTrendCard, options);
  await screen.findByTestId('echart-canvas');
  return rendered;
}

const lineIds = (): string[] =>
  drawnSeries()
    .filter((entry) => entry.type === 'line' && entry.id !== 'boundaries')
    .map((entry) => entry.id);

describe('the competitor trend card (CH-06)', () => {
  it('reserves the height of its skeleton panel while its read loads', async () => {
    serveWorld(weeklySummary(), entityRows());
    renderCard(TYPE, CompetitorTrendCard, { engine: ENGINE, competitors: '3' });
    const frame = (await screen.findByRole('heading', { level: 2, name: TITLE })).closest('section');
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame?.querySelector(`[style*="height: ${loadingBodyHeight('ai.competitor_trend')}px"]`)).not.toBeNull();
  });

  it('draws you and the top 3 competitors by window mention rate, and 5 with the option 5', async () => {
    serveWorld(weeklySummary({ weeks: SIX_WEEKS, names: SIX_NAMES }), entityRows(SIX_NAMES));
    await drawTrend({ engine: ENGINE, competitors: '3' });
    // You first, then HubSpot 50%, Pipedrive 40% and Zoho 20%: Salesforce 15% and Freshworks 10% are not drawn
    expect(lineIds()).toEqual([id(1), id(2), id(4), id(3)]);
    expect(screen.getByTestId('trend-footnote')).toHaveTextContent('3 competitors of 5 drawn');
  });

  it('draws all five competitors with the option 5', async () => {
    serveWorld(weeklySummary({ weeks: SIX_WEEKS, names: SIX_NAMES }), entityRows(SIX_NAMES));
    await drawTrend({ engine: ENGINE, competitors: '5' });
    expect(lineIds()).toHaveLength(6);
    expect(lineIds()[0]).toBe(id(1));
  });

  it('is a mention rate chart on a 0 to 1 axis in the height of its skeleton', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawTrend();
    expect(screen.getByRole('heading', { level: 2, name: TITLE })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: TITLE })).toHaveStyle({ height: '240px' });
    expect(yAxisOf()).toMatchObject({ min: 0 });
    expect(yAxisOf().max).toBeLessThanOrEqual(1);
    // Own is chart-1 and a competitor takes the slot the project gave it
    expect(drawnSeries().find((entry) => entry.id === id(1))?.color).toBe('#c1');
    expect(drawnSeries().find((entry) => entry.id === id(2))?.color).toBe('#c2');
  });

  it('says the value of a week with its k of n and the interval, best first', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawTrend();
    const words = tooltipText(0);
    expect(words).toContain('Week of Oct 19');
    expect(words).toContain('40.0%, 80 of 200 answers');
    expect(words).toContain('35.0%, 70 of 200 answers');
    expect(words.indexOf('Fynix')).toBeLessThan(words.indexOf('HubSpot'));
    expect(words.indexOf('HubSpot')).toBeLessThan(words.indexOf('Zoho'));
    // A later week where HubSpot leads lists it before you
    const later = tooltipText(2);
    expect(later.indexOf('HubSpot')).toBeLessThan(later.indexOf('Fynix'));
  });

  it('draws a thin week as a hollow point with its count and never as a percent, and a week with no answers as a gap', async () => {
    serveWorld(weeklySummary(), entityRows());
    await drawTrend();
    const own = drawnSeries().find((entry) => entry.id === id(1));
    expect(own?.data[1]).toMatchObject({ symbolSize: 5, itemStyle: { color: '#elevated', borderColor: '#c1' } });
    // Its place is the share of its 3 answers (1 of 3), not 0
    expect((own?.data[1] as { value: number }).value).toBeCloseTo(1 / 3, 10);
    expect(own?.data[0]).toBeCloseTo(0.4, 10);
    const thin = tooltipText(1);
    expect(thin).toContain('3 answers, fewer than 4');
    expect(thin).not.toMatch(/33\.3%|66\.7%/);
  });

  it('starts the axis at the first week with answers and ends at the last, and keeps an empty week between as a gap', async () => {
    serveWorld(
      weeklySummary({ weeks: [idleWeek('2026-10-05'), ...WEEKS_WITH_GAP, idleWeek('2026-11-16')] }),
      entityRows(),
    );
    await drawTrend();
    expect(drawnCategories()).toEqual(['Oct 19', 'Oct 26', 'Nov 2', 'Nov 9']);
    const own = drawnSeries().find((entry) => entry.id === id(1));
    expect(own?.data[1]).toBeNull();
    expect(tooltipText(1)).toContain('No answers');
  });

  it('toggles a series from the legend and keeps its colour', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawTrend();
    const legend = screen.getByRole('list', { name: 'Series in Mention rate on ChatGPT' });
    const hubspot = within(legend).getByRole('button', { name: 'HubSpot' });
    expect(hubspot).toHaveAttribute('aria-pressed', 'true');
    await user.click(hubspot);
    expect(hubspot).toHaveAttribute('aria-pressed', 'false');
    expect(lineIds()).not.toContain(id(2));
    expect(hubspot.querySelector('span')).toHaveStyle({ backgroundColor: 'var(--chart-2)' });
  });

  it('names the weeks a pooled week holds in its tooltip, and says the pooling rule in the footnote only then', async () => {
    serveWorld(weeklySummary({ weeks: POOLED_WEEKS }), entityRows());
    const { unmount } = await drawTrend();
    expect(tooltipText(2)).toContain('Week of Nov 2, 4 weeks together (Oct 19 to Nov 9, 2026)');
    // A week the API pooled over one week is a plain week
    expect(tooltipText(0)).toContain('Week of Oct 19');
    expect(tooltipText(0)).not.toContain('together');
    expect(screen.getByText(/shows the last 4 weeks together/)).toBeInTheDocument();
    unmount();

    serveWorld(weeklySummary(), entityRows());
    await drawTrend();
    expect(screen.queryByText(/shows the last 4 weeks together/)).not.toBeInTheDocument();
  });

  it('draws a boundary on the week a competitor was added when the set changed, and not otherwise', async () => {
    serveWorld(weeklySummary({ versions: [1, 2] }), entityRows(NAMES, { HubSpot: '2026-10-28T09:00:00Z' }));
    const { unmount } = await drawTrend();
    const boundary = drawnSeries().find((entry) => entry.id === 'boundaries');
    expect(boundary?.markLine?.data.map((entry) => entry.xAxis)).toEqual(['Oct 26']);
    expect(screen.getByTestId('tracked-footnote')).toHaveTextContent('HubSpot on Oct 28');
    unmount();

    serveWorld(weeklySummary({ versions: [1] }), entityRows(NAMES, { HubSpot: '2026-10-28T09:00:00Z' }));
    await drawTrend();
    expect(drawnSeries().some((entry) => entry.id === 'boundaries')).toBe(false);
  });

  it('states the gap in points with both counts, and larger than normal variation only when the test says so', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { unmount } = await drawTrend();
    expect(screen.getByRole('img', { name: TITLE })).toHaveAccessibleDescription(
      'You 35% (225 of 643 answers), HubSpot 45% (292 of 643 answers): gap 10 points, larger than normal variation',
    );
    unmount();

    // 50% and 53% over 200 answers each cannot be told apart
    const close = [
      { start: '2026-10-19', answers: 100, numerators: [50, 50], mentions: { n: 100, ks: [50, 53] } },
      { start: '2026-10-26', answers: 100, numerators: [50, 50], mentions: { n: 100, ks: [50, 53] } },
    ];
    serveWorld(weeklySummary({ weeks: close, names: ['Fynix', 'HubSpot'] }), entityRows(['Fynix', 'HubSpot']));
    await drawTrend();
    expect(screen.getByRole('img', { name: TITLE })).toHaveAccessibleDescription(
      'You 50% (100 of 200 answers), HubSpot 53% (106 of 200 answers): gap 3 points, within normal variation',
    );
  });

  it('prints every week with its value and k of n in the Table view', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawTrend();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Week', 'Fynix', 'HubSpot', 'Zoho']);
    // The header and the four weeks the chart draws: the leading week with no answers is not a row
    expect(within(table).getAllByRole('row')).toHaveLength(WEEKS.length);
    expect(within(table).queryByRole('row', { name: /Oct 12/ })).not.toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Oct 19/ })).toHaveTextContent('40.0%, 80 of 200 answers');
    const thin = within(table).getByRole('row', { name: /Oct 26/ });
    expect(thin).toHaveTextContent('3 answers, fewer than 4');
    expect(thin).not.toHaveTextContent('33.3%');
  });

  it('hands its table to the export under the layout item id', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { user } = await drawTrend();
    const [block, ...rest] = await readExport(user);
    expect(rest).toEqual([]);
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'Week',
      'Brand',
      'Mention rate',
      'Answers naming the brand',
      'Valid answers',
      'Status',
    ]);
    // The week of Oct 19 for you: 40 percent, 80 of 200; the leading week with no answers is not drawn, so not exported
    expect(block?.rows).toContainEqual(['2026-10-19', 'Fynix', 40, 80, 200, 'ok']);
    expect(block?.rows.some((row) => row[0] === '2026-10-12')).toBe(false);
    expect(block?.rows).toContainEqual(['2026-10-26', 'Fynix', null, 1, 3, 'insufficient']);
  });

  it('has no serious accessibility violation when it is ready', async () => {
    serveWorld(weeklySummary(), entityRows());
    const { container } = await drawTrend();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the competitor trend card states', () => {
  it('asks for two weeks when only one week has answers', async () => {
    serveWorld(
      weeklySummary({ weeks: [WEEKS[0] as (typeof WEEKS)[number], WEEKS[1] as (typeof WEEKS)[number]] }),
      entityRows(),
    );
    renderCard(TYPE, CompetitorTrendCard, { engine: ENGINE, competitors: '3' });
    expect(await screen.findByText('A trend needs two weeks of answers')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('says no competitor is tracked when only you are', async () => {
    serveWorld(weeklySummary({ names: ['Fynix'] }), entityRows(['Fynix']));
    renderCard(TYPE, CompetitorTrendCard, { engine: ENGINE, competitors: '3' });
    expect(await screen.findByText('No competitor is tracked')).toBeInTheDocument();
  });

  it('says the engine is not asked when the page filter leaves it out', async () => {
    renderCard(
      TYPE,
      CompetitorTrendCard,
      { engine: ENGINE, competitors: '3' },
      { searchParams: 'cmp=off&engine=gemini_web' },
    );
    expect(await screen.findByText('ChatGPT is not asked in this scope')).toBeInTheDocument();
    expect(screen.getByText(/outside the engine filter/)).toBeInTheDocument();
  });

  it('tells assistive technology no figure for an engine that is not asked, and the figures for one that is', async () => {
    const { unmount } = renderCard(TYPE, CompetitorTrendCard, { engine: 'google_ai_mode', competitors: '3' });
    const off = chartSummaryText(await screen.findByRole('heading', { level: 2, name: 'Mention rate on AI Mode' }));
    expect(off).toBe('');
    expect(off).not.toMatch(/\d|too few/i);
    unmount();
    serveWorld(weeklySummary(), entityRows());
    await drawTrend();
    expect(chartSummaryText(screen.getByRole('heading', { level: 2, name: TITLE }))).toMatch(/^You \d+%/);
  });

  it('says the engine is not asked when the project has it off, with the way to turn it on', async () => {
    renderCard(TYPE, CompetitorTrendCard, { engine: 'google_ai_mode', competitors: '3' });
    expect(await screen.findByText('AI Mode is not asked in this scope')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on engines' })).toBeInTheDocument();
  });

  it('shows Retry when the read failed, and reads again with it', async () => {
    serveSummaryFailure();
    const { user } = renderCard(TYPE, CompetitorTrendCard, { engine: ENGINE, competitors: '3' });
    expect(await screen.findByText('Could not load mention rate')).toBeInTheDocument();
    serveWorld(weeklySummary(), entityRows());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
    });
    expect(drawnOption()).toBeDefined();
  });
});
