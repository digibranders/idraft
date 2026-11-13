import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EngineTrend } from './engine-trend';
import { NO_TOPIC } from '@/features/prompts/prompt-model';
import {
  engine,
  pool,
  topicRow,
  week,
  weighted,
  type WeekCellsInput,
} from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineSummary, TopicSummaryRow } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';
import { mswPath } from '@/mocks/respond';
import { server } from '@/test/msw';
import { DRAWER_TOPIC_ID, renderDrawerPart, summaryOf } from '@/test/topic-drawer-harness';

// jsdom has no canvas: the option the frame gives the chart is what these tests read
const drawn = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    drawn.options.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/ai/prompts',
  useSearchParams: () => new URLSearchParams(''),
}));

const SUMMARY_PATH = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary');
const POOL = pool(4, '2026-10-05', '2026-11-01');
const BODY_BASE = {
  window: { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' },
  include_branded: false,
  engine_codes: ['chatgpt_web', 'gemini_web'],
  entities: [],
  entity_config_versions: [],
  prompts: [],
};

const WEEKS = ['2026-10-19', '2026-10-26'] as const;
/** The weekly points of an engine: `inputs` gives the cells of each week. */
const series = (...inputs: WeekCellsInput[]) => inputs.map((input, at) => week(WEEKS[at] ?? '2026-11-02', input));
const rowWith = (engines: readonly EngineSummary[], lastValid: string | null = null): TopicSummaryRow => ({
  ...topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4, engines),
  last_valid_at: lastValid,
});
const bodyOf = (row: TopicSummaryRow): object => ({ data: { ...BODY_BASE, topics: [row] } });
const serve = (row: TopicSummaryRow): void => server.use(http.get(SUMMARY_PATH, () => HttpResponse.json(bodyOf(row))));

const PLAIN = [
  engine('chatgpt_web', {
    series: series({ mentioned: weighted(3, 8, 4), prompts: 4 }, { mentioned: weighted(4, 10, 5), prompts: 5 }),
  }),
  engine('gemini_web', {
    series: series({ mentioned: weighted(2, 8, 4), prompts: 4 }, { mentioned: weighted(5, 10, 5), prompts: 5 }),
  }),
];

const lastOption = (): Record<string, unknown> => drawn.options.at(-1) ?? {};
const seriesOption = (id: string): { data: unknown[] } | undefined =>
  ((lastOption().series ?? []) as { id?: string; data: unknown[] }[]).find((entry) => entry.id === id);

const NOW = new Date('2026-11-12T12:00:00Z');
beforeEach(() => {
  drawn.options.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const renderTrend = (row: TopicSummaryRow = rowWith(PLAIN), options: Parameters<typeof renderDrawerPart>[1] = {}) => {
  serve(row);
  return renderDrawerPart(<EngineTrend />, {
    summary: summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4)]),
    ...options,
  });
};

describe('EngineTrend: the weekly rate of the topic on each engine', () => {
  it('draws one line per engine with the weekly rate and a table form with the same words', async () => {
    const { user } = renderTrend();
    await screen.findByTestId('echart-canvas');
    expect(seriesOption('chatgpt_web')?.data).toEqual([0.375, 0.4]);
    expect(seriesOption('gemini_web')?.data).toEqual([0.25, 0.5]);
    expect(screen.getByRole('heading', { name: 'Trend by engine' })).toBeInTheDocument();
    expect(screen.getByText('Mention, weekly')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = screen.getByRole('table', { name: 'Trend by engine' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Week', 'ChatGPT', 'Gemini']);
    const [, first, second] = within(table).getAllByRole('row');
    expect(first).toHaveTextContent('Oct 19');
    expect(first).toHaveTextContent('38%, 3 of 8 answers, 4 prompts');
    expect(first).toHaveTextContent('25%, 2 of 8 answers, 4 prompts');
    expect(second).toHaveTextContent('40%, 4 of 10 answers, 5 prompts');
  });

  it('says the C-18 sentence in the footnote only when a point is pooled', async () => {
    const plain = renderTrend();
    await screen.findByTestId('echart-canvas');
    expect(screen.getByText(/The band is the 95% interval of the pooled answers/)).toBeInTheDocument();
    expect(screen.queryByText(/shows the last 4 weeks together/)).toBeNull();
    plain.unmount();

    const pooled = [
      engine('chatgpt_web', {
        series: series(
          { mentioned: weighted(3, 8, 4), prompts: 4 },
          { mentioned: weighted(4, 10, 5), prompts: 5, pool: POOL },
        ),
      }),
    ];
    renderTrend(rowWith(pooled));
    expect(
      await screen.findByText(
        'A topic point with fewer than 10 prompts answering that week shows the last 4 weeks together, clipped to the window. A prompt point always shows 4 weeks.',
      ),
    ).toBeInTheDocument();
  });

  it('the table row of a pooled point names the weeks it holds', async () => {
    const pooled = [
      engine('chatgpt_web', {
        series: series(
          { mentioned: weighted(3, 8, 4), prompts: 4 },
          { mentioned: weighted(4, 10, 5), prompts: 5, pool: POOL },
        ),
      }),
    ];
    const { user } = renderTrend(rowWith(pooled));
    await screen.findByTestId('echart-canvas');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const [, first, second] = within(screen.getByRole('table', { name: 'Trend by engine' })).getAllByRole('row');
    expect(second).toHaveTextContent('4 weeks to Oct 26');
    // A week that holds only itself says nothing of pooling
    expect(first?.textContent).not.toMatch(/weeks to/);
  });

  it('says nothing of pooling for a point pooled over its own week alone', async () => {
    const alone = [
      engine('chatgpt_web', {
        series: series(
          { mentioned: weighted(3, 8, 4), prompts: 4, pool: pool(1, '2026-10-19', '2026-10-25') },
          { mentioned: weighted(4, 10, 5), prompts: 5 },
        ),
      }),
    ];
    const { user } = renderTrend(rowWith(alone));
    await screen.findByTestId('echart-canvas');
    expect(screen.queryByText(/shows the last 4 weeks together/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = screen.getByRole('table', { name: 'Trend by engine' });
    expect(grid.textContent).not.toMatch(/weeks? to/);
  });

  it('a point under 4 answers is hollow with no band', async () => {
    const thin = [
      engine('chatgpt_web', {
        series: series({ mentioned: weighted(3, 8, 4), prompts: 4 }, { mentioned: weighted(1, 3, 2), prompts: 2 }),
      }),
    ];
    renderTrend(rowWith(thin));
    await screen.findByTestId('echart-canvas');
    const line = seriesOption('chatgpt_web')?.data ?? [];
    expect(typeof line[0]).toBe('number');
    // The hollow point is a styled marker of its value, not a plain number
    expect(typeof line[1]).toBe('object');
    const low = seriesOption('chatgpt_web:band-low')?.data ?? [];
    expect(low[0]).not.toBeNull();
    expect(low[1]).toBeNull();
  });

  it('a week with no valid answer is a gap, never 0', async () => {
    const gap = [
      engine('chatgpt_web', {
        series: series({ mentioned: weighted(3, 8, 4), prompts: 4 }, { mentioned: weighted(0, 0, 0), prompts: 0 }),
      }),
    ];
    const { user } = renderTrend(rowWith(gap));
    await screen.findByTestId('echart-canvas');
    expect(seriesOption('chatgpt_web')?.data).toEqual([0.375, null]);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const [, , second] = within(screen.getByRole('table', { name: 'Trend by engine' })).getAllByRole('row');
    // The table says "No data" for a point with no value, never 0
    expect(second).toHaveTextContent('No data');
    expect(second?.textContent).not.toMatch(/0%/);
  });

  it('an engine without a series is not drawn and the table form says so', async () => {
    const partial = [PLAIN[0] ?? engine('chatgpt_web'), engine('gemini_web')];
    const { user } = renderTrend(rowWith(partial));
    await screen.findByTestId('echart-canvas');
    expect(seriesOption('gemini_web')?.data).toEqual([null, null]);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const [, first] = within(screen.getByRole('table', { name: 'Trend by engine' })).getAllByRole('row');
    expect(first).toHaveTextContent('38%, 3 of 8 answers, 4 prompts');
    expect(first).toHaveTextContent('No data');
  });

  it('says there are no weekly points yet when the series is absent', async () => {
    renderTrend(rowWith([engine('chatgpt_web'), engine('gemini_web')]));
    expect(await screen.findByText('No weekly points yet')).toBeInTheDocument();
    expect(screen.getByText('This topic has no answer in the weeks of the window.')).toBeInTheDocument();
    expect(screen.queryByTestId('echart-canvas')).toBeNull();
  });

  it('follows the metric of the address', async () => {
    const cited = [
      engine('chatgpt_web', {
        series: series({ cited: weighted(1, 8, 4), prompts: 4 }, { cited: weighted(2, 8, 4), prompts: 4 }),
      }),
    ];
    renderTrend(rowWith(cited), { searchParams: '?metric=citation' });
    await screen.findByTestId('echart-canvas');
    expect(seriesOption('chatgpt_web')?.data).toEqual([0.125, 0.25]);
    expect(screen.getByText('Citation, weekly')).toBeInTheDocument();
  });

  it('says how long the topic has been silent in the meta line', async () => {
    renderTrend(rowWith(PLAIN, '2026-10-30T02:00:00Z'));
    await screen.findByTestId('echart-canvas');
    expect(screen.getByText(/No valid answer since Oct 30\./)).toBeInTheDocument();
  });

  it('keeps the chart while it refetches', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { queryClient } = renderTrend();
    await screen.findByTestId('echart-canvas');
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await gate;
        return HttpResponse.json(bodyOf(rowWith(PLAIN)));
      }),
    );
    void queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Trend by engine' }).closest('section')).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    expect(screen.getByTestId('echart-canvas')).toBeInTheDocument();
    release();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Trend by engine' }).closest('section')).not.toHaveAttribute(
        'aria-busy',
      ),
    );
  });

  it('reads the weeks of filter[term] for a topic and the page row for No topic', async () => {
    const asked: URLSearchParams[] = [];
    server.use(
      http.get(SUMMARY_PATH, ({ request }) => {
        asked.push(new URL(request.url).searchParams);
        return HttpResponse.json(bodyOf(rowWith(PLAIN)));
      }),
    );
    const first = renderDrawerPart(<EngineTrend />, {
      summary: summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4)]),
    });
    await screen.findByTestId('echart-canvas');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.get('filter[term]')).toBe(DRAWER_TOPIC_ID);
    expect(asked[0]?.get('rows')).toBe('topics');
    expect(asked[0]?.getAll('include').join(',')).toBe('series,entities');
    first.unmount();
    drawn.options.length = 0;

    const none = topicRow(null, null, 2, PLAIN);
    renderDrawerPart(<EngineTrend />, { topicKey: NO_TOPIC, summary: summaryOf([none]) });
    await screen.findByTestId('echart-canvas');
    expect(seriesOption('chatgpt_web')?.data).toEqual([0.375, 0.4]);
    // Nothing more was asked
    expect(asked).toHaveLength(1);
  });

  it('is a skeleton while the first read is on its way, and a failed read has Retry', async () => {
    let fail = true;
    server.use(
      http.get(SUMMARY_PATH, () =>
        fail
          ? HttpResponse.json({ status: 500, code: 'internal_error', title: 'x' }, { status: 500 })
          : HttpResponse.json(bodyOf(rowWith(PLAIN))),
      ),
    );
    const { user } = renderDrawerPart(<EngineTrend />, {
      summary: summaryOf([topicRow(DRAWER_TOPIC_ID, 'Technical SEO', 4)]),
    });
    expect(screen.getByRole('heading', { name: 'Trend by engine' }).closest('section')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    const retry = await screen.findByRole('button', { name: 'Try again' });
    // The other content of the drawer is not touched: this section alone says it failed
    fail = false;
    await user.click(retry);
    expect(await screen.findByTestId('echart-canvas')).toBeInTheDocument();
  });
});
