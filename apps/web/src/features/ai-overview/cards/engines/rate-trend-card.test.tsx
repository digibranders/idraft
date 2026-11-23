import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RateTrendCard from './rate-trend-card';
import { cell, engine, promptRow, share, summaryOf, week } from '../competitors/model/summary-fixtures';
import { CardInfoProvider } from '@/components/app/chart/card-info';
import type { CardProps } from '@/features/layouts';
import type { EngineSummary, MetricCell, PromptsSummary, WeekCells } from '@/lib/api/types';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { drawnSeries, tooltipText } from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/components/app/chart/echart', async () => (await import('@/test/weekly-card-kit')).echartStandIn);

const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const WEEKS = ['2026-10-19', '2026-10-26', '2026-11-02'];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A week: `k` of `n` valid answers mention the brand; with `v` it also carries the weekly visibility cell. */
function point(weekStart: string, k: number, n: number, v?: number): WeekCells {
  const base = week(weekStart, { mentioned: cell(k, n), share: share(k, n) });
  return v === undefined ? base : ({ ...base, visibility: cell(v, n) } as WeekCells & { visibility: MetricCell });
}

/** One platform over three weeks, with its outcomes (5 of 10 answers name or cite you) on the prompt row. */
function platform(code: string, rates: readonly number[], visibility = false): EngineSummary {
  return engine(code, {
    mentioned: cell(4, 10),
    outcomes: {
      mentionedAndCited: cell(2, 10),
      mentionedOnly: cell(2, 10),
      citedOnly: cell(1, 10),
      neither: cell(5, 10),
    },
    series: WEEKS.map((weekStart, index) =>
      point(weekStart, rates[index] ?? 0, 10, visibility ? (rates[index] ?? 0) + 1 : undefined),
    ),
  });
}

function serve(...engines: EngineSummary[]): void {
  const summary: PromptsSummary = summaryOf({ total: engines, prompts: [promptRow(1, engines)] });
  server.use(http.get(SUMMARY, () => HttpResponse.json({ data: summary })));
}

function renderCard(searchParams: string, onUrlUpdate?: (url: URL) => void) {
  const Card = (props: CardProps): ReactElement => (
    <CardInfoProvider>
      <RateTrendCard {...props} />
    </CardInfoProvider>
  );
  return renderWithProviders(cardInOverview({ type: 'ai.rate_trend_by_engine', Card, width: 'two_thirds' }), {
    searchParams,
    ...(onUrlUpdate === undefined
      ? {}
      : { onUrlUpdate: ({ searchParams: next }) => onUrlUpdate(new URL(`http://x/?${next.toString()}`)) }),
  });
}

describe('the trend card', () => {
  it('draws a line for each platform of the scope with the Average, titled by the metric of the page', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    renderCard('cmp=off&metric=mention');
    await screen.findByRole('heading', { level: 2, name: 'Mention rate over time' });
    const legend = await screen.findByRole('list', { name: /Series in Mention rate over time/ });
    // Under the chart, each line with its latest rate (the last week: 60% and 40%, their average 50%)
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(expect.arrayContaining(['ChatGPT 60%', 'Gemini 40%', 'Average 50%']));
    expect(screen.getByText('a line per platform, with their average')).toBeInTheDocument();
  });

  it('draws a marker on each line, a different shape for each (20-accessibility.md section 12.2), and names the shape in the legend', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    renderCard('cmp=off&metric=mention');
    await screen.findByTestId('echart-canvas');
    const lines = drawnSeries().filter((entry) => entry.type === 'line' && entry.stack === undefined);
    expect(lines.map((line) => line.symbol)).toEqual(['circle', 'rect', 'triangle']);
    for (const line of lines) expect(line.showSymbol).toBe(true);
    const legend = await screen.findByRole('list', { name: /Series in Mention rate over time/ });
    // ChatGPT and Gemini draw their marker shape, the dashed Average keeps its line
    expect(legend.querySelectorAll('svg')).toHaveLength(2);
  });

  it('keeps the shape of its line on a hollow point over too few answers', async () => {
    const thin = engine('chatgpt_web', {
      mentioned: cell(4, 10),
      // One answer a week: the trailing weeks pool to 3 at most, under the 4 a rate needs
      series: WEEKS.map((weekStart) => point(weekStart, 1, 1)),
    });
    serve(thin);
    renderCard('cmp=off&metric=mention&engine=chatgpt_web');
    await screen.findByTestId('echart-canvas');
    const [line] = drawnSeries().filter((entry) => entry.type === 'line' && entry.stack === undefined);
    expect(line?.symbol).toBe('circle');
    const hollow = (line?.data ?? []).filter(
      (value) => typeof value === 'object' && value !== null && 'symbolSize' in value,
    );
    expect(hollow.length).toBeGreaterThan(0);
    for (const point of hollow) expect(point).toMatchObject({ symbol: 'circle', symbolSize: 5 });
  });

  it('puts the legend under the chart, and takes it away with the chart in the Table view', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    const { user } = renderCard('cmp=off&metric=mention');
    const legend = await screen.findByRole('list', { name: /Series in Mention rate over time/ });
    const canvas = screen.getByRole('img', { name: 'Mention rate over time' });
    expect(canvas.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Table' }).querySelector('svg')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('list', { name: /Series in Mention rate over time/ })).not.toBeInTheDocument();
  });

  it('draws one platform alone, with its 95% interval and no Average', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    renderCard('cmp=off&metric=mention&engine=chatgpt_web');
    expect(await screen.findByText('ChatGPT, with its 95% interval')).toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
  });

  it('says AI visibility is not collected week by week, with the window figures from the outcomes, and draws no mention line instead', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    renderCard('cmp=off');
    expect(await screen.findByText('Not collected yet')).toBeInTheDocument();
    expect(screen.getByText(/Over the period: ChatGPT 50% and Gemini 50%/)).toBeInTheDocument();
    // The Metric tabs stay, so a person can leave this metric
    expect(screen.getByRole('radio', { name: 'Mention' })).toBeInTheDocument();
  });

  it('draws AI visibility from the weekly visibility cell when the API carries it', async () => {
    serve(platform('chatgpt_web', [4, 5, 6], true), platform('gemini_web', [2, 3, 4], true));
    renderCard('cmp=off');
    await screen.findByRole('heading', { level: 2, name: 'AI visibility rate over time' });
    expect(await screen.findByRole('list', { name: /Series in AI visibility rate over time/ })).toBeInTheDocument();
    expect(screen.queryByText('Not collected yet')).not.toBeInTheDocument();
  });

  it('writes the metric of the page to the address when a tab is chosen', async () => {
    const updates: URL[] = [];
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    const { user } = renderCard('cmp=off&metric=mention', (url) => updates.push(url));
    await screen.findByRole('heading', { level: 2, name: 'Mention rate over time' });
    await user.click(screen.getByRole('radio', { name: 'Share of voice' }));
    expect(updates.at(-1)?.searchParams.get('metric')).toBe('sov');
  });

  describe('with the same period last year (cmp=year)', () => {
    const LAST_YEAR_WEEKS = ['2025-10-20', '2025-10-27', '2025-11-03'];
    /** Last year's window ends on 12 November 2025: the read of the same dates a year earlier. */
    const LAST_YEAR_TO = '2025-11-12';

    const lastYearPlatform = (code: string, rates: readonly number[]): EngineSummary =>
      engine(code, {
        mentioned: cell(4, 10),
        series: LAST_YEAR_WEEKS.map((weekStart, index) => point(weekStart, rates[index] ?? 0, 10)),
      });

    function serveBoth(now: EngineSummary[], before: EngineSummary[]): void {
      const summary = (engines: EngineSummary[]): PromptsSummary =>
        summaryOf({ total: engines, prompts: [promptRow(1, engines)] });
      server.use(
        http.get(SUMMARY, ({ request }) =>
          HttpResponse.json({
            data: summary(new URL(request.url).searchParams.get('to') === LAST_YEAR_TO ? before : now),
          }),
        ),
      );
    }

    it('draws last year as one dashed line under the current weeks, not before them, named in the legend and the footnote', async () => {
      serveBoth(
        [platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4])],
        [lastYearPlatform('chatgpt_web', [1, 2, 3]), lastYearPlatform('gemini_web', [3, 4, 5])],
      );
      renderCard('cmp=year&metric=mention');
      const legend = await screen.findByRole('list', { name: /Series in Mention rate over time/ });
      // The Average of last year's last week: (30% + 50%) / 2
      expect(
        within(legend)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ).toContain('Same period last year 40%');
      const drawn = drawnSeries().find((entry) => entry.id === 'last-year');
      expect(drawn?.name).toBe('Same period last year');
      expect(drawn?.data).toHaveLength(3);
      // No week of last year is put before the current ones, and no line marks a boundary between the two
      expect(drawnSeries().some((entry) => entry.markLine !== undefined)).toBe(false);
      expect(screen.getByText('The dashed line is the same period last year, week for week.')).toBeInTheDocument();
    });

    it('says the week of last year in the tooltip and writes last year to the Table view', async () => {
      serveBoth(
        [platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4])],
        [lastYearPlatform('chatgpt_web', [1, 2, 3]), lastYearPlatform('gemini_web', [3, 4, 5])],
      );
      const { user } = renderCard('cmp=year&metric=mention');
      await screen.findByRole('list', { name: /Series in Mention rate over time/ });
      expect(tooltipText(0)).toContain('Same period last year|Week of Oct 20, 2025: Average of 2 platforms');
      await user.click(screen.getByRole('button', { name: 'Table' }));
      const table = await screen.findByRole('table', { name: 'Mention rate over time' });
      expect(within(table).getByRole('columnheader', { name: 'Same period last year' })).toBeInTheDocument();
    });

    it('draws no last year line, and says nothing of it, when last year has no rate', async () => {
      // Three weeks with no valid answer: gaps, which are never drawn as a rate of 0%
      const silent = engine('chatgpt_web', { series: LAST_YEAR_WEEKS.map((weekStart) => point(weekStart, 0, 0)) });
      serveBoth([platform('chatgpt_web', [4, 5, 6])], [silent]);
      renderCard('cmp=year&metric=mention&engine=chatgpt_web');
      await screen.findByRole('heading', { level: 2, name: 'Mention rate over time' });
      await screen.findByTestId('echart-canvas');
      expect(drawnSeries().some((entry) => entry.id === 'last-year')).toBe(false);
      expect(
        screen.queryByText('The dashed line is the same period last year, week for week.'),
      ).not.toBeInTheDocument();
    });

    it('keeps the previous period before the current weeks, with its boundary line, when cmp is left out', async () => {
      serveBoth([platform('chatgpt_web', [4, 5, 6])], [platform('chatgpt_web', [1, 2, 3])]);
      renderCard('metric=mention&engine=chatgpt_web');
      await screen.findByRole('heading', { level: 2, name: 'Mention rate over time' });
      await screen.findByTestId('echart-canvas');
      expect(drawnSeries().some((entry) => entry.id === 'last-year')).toBe(false);
    });
  });

  it('puts the weeks in a table as an alternative to the chart', async () => {
    serve(platform('chatgpt_web', [4, 5, 6]), platform('gemini_web', [2, 3, 4]));
    const { user } = renderCard('cmp=off&metric=mention');
    await screen.findByRole('list', { name: /Series in Mention rate over time/ });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: 'Mention rate over time' });
    expect(within(table).getByRole('columnheader', { name: 'Average' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
  });
});
