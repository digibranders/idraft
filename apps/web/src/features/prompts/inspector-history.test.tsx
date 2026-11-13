import { screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InspectorHistory, type InspectorHistoryProps } from './inspector-history';
import type { PromptAnswers, PromptCounts } from './inspector-reads';
import type { EngineSummary, MetricCell, ObservationSummary, ProjectEngine, PromptSummaryRow } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { readChartTokens } from '@/lib/design/read-tokens';
import { formatTableDateTime } from '@/lib/format';
import { ENGINE_FACTS } from '@/mocks/prompt-fixtures';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

// jsdom has no canvas: the option the frame gives the chart is what these tests read
const drawn = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({ option }: { option: (tokens: ChartTokens) => Record<string, unknown> }) => {
    drawn.options.push(option(readChartTokens()));
    return <div data-testid="echart-canvas" />;
  },
}));

const LABELS: Record<string, string> = { chatgpt_web: 'ChatGPT', gemini_web: 'Gemini' };

const engine = (code: 'chatgpt_web' | 'gemini_web'): ProjectEngine => ({
  active_prompts: 1,
  engine: ENGINE_FACTS[code],
  estimated_monthly_cost_usd: null,
  is_configured: true,
  is_enabled: true,
  location_ids: [2276],
  provider_code: 'openai',
  replicates: 1,
});

const answer = (id: string, code: string, observedAt: string): ObservationSummary =>
  ({
    observation_id: id,
    engine_code: code,
    observed_at: observedAt,
    status: 'complete',
    model_reported: null,
    facts: { is_valid: true, outcome: 'neither' },
  }) as unknown as ObservationSummary;

const noCounts: PromptCounts = {
  status: 'ready',
  row: undefined,
  entities: [],
  brandedIncluded: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
};

const answersOf = (rows: readonly ObservationSummary[], status: PromptAnswers['status'] = 'ready'): PromptAnswers => ({
  status,
  rows,
  hasMore: false,
  errorId: null,
  retry: () => undefined,
  retrying: false,
});

/** ChatGPT answers every 3 days of the window; Gemini on Oct 20 and Oct 30 only. */
const ROWS = [
  ...Array.from({ length: 11 }, (_, at) =>
    answer(`c${String(at)}`, 'chatgpt_web', new Date(Date.UTC(2026, 9, 1 + at * 3, 2)).toISOString()),
  ),
  answer('g1', 'gemini_web', '2026-10-20T02:00:00Z'),
  answer('g2', 'gemini_web', '2026-10-30T02:00:00Z'),
];

function renderHistory(over: Partial<InspectorHistoryProps> = {}): ProvidedRender {
  const ui: ReactElement = (
    <InspectorHistory
      counts={noCounts}
      engines={[engine('chatgpt_web'), engine('gemini_web')]}
      range={{ from: '2026-10-01', to: '2026-11-02' }}
      timeZone="UTC"
      createdAt="2026-09-01T09:00:00Z"
      answers={answersOf(ROWS)}
      labelOf={(code) => LABELS[code] ?? code}
      noCountsReason="No counts"
      onOpenAnswer={undefined}
      {...over}
    />
  );
  return renderWithProviders(ui);
}

const events = (): HTMLElement => screen.getByRole('list', { name: 'Events of this prompt' });

beforeEach(() => {
  drawn.options.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the events of the History tab', () => {
  it('lists a stale engine with its days and its date, newest first among the events', () => {
    renderHistory();
    const items = within(events()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Oct 20'),
      expect.stringContaining('Sep 1'),
    ]);
    expect(items[0]).toHaveTextContent('No valid answer on Gemini for 10 days');
    expect(items[1]).toHaveTextContent('Prompt added');
    // ChatGPT answers every 3 days: not stale
    expect(within(events()).queryByText(/on ChatGPT/)).toBeNull();
  });

  it('measures the last gap to now when the window reaches past it', () => {
    // The window runs to Nov 30, but it is Nov 6, 02:00: 7 days since the last Gemini answer of Oct 30
    vi.setSystemTime(new Date('2026-11-06T02:00:00Z'));
    renderHistory({ range: { from: '2026-10-01', to: '2026-11-30' } });
    expect(within(events()).getByText('No valid answer on Gemini for 7 days')).toBeInTheDocument();
    // Measured to the end of the window it would be 31 days
    expect(within(events()).queryByText(/for 31 days/)).toBeNull();
  });

  it('gives an engine with no valid answer in the window one event from the start of the window', () => {
    renderHistory({ answers: answersOf(ROWS.filter((row) => row.engine_code === 'chatgpt_web')) });
    expect(within(events()).getByText('No valid answer on Gemini for 33 days')).toBeInTheDocument();
  });

  it('adds no stale event while the answers are loading or failed to load', () => {
    const first = renderHistory({ answers: answersOf([], 'loading') });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
    first.unmount();
    renderHistory({ answers: answersOf([], 'error') });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
  });

  it('adds no stale event for the days before the prompt was added', () => {
    renderHistory({ answers: answersOf([]), createdAt: '2026-10-30T09:00:00Z' });
    expect(screen.queryByText(/No valid answer on/)).toBeNull();
  });
});

const cell = (k: number, n: number): MetricCell => ({
  numerator: k,
  denominator: n,
  n_observations: n,
  value: n === 0 ? null : k / n,
});
const seriesOf = (code: string): EngineSummary =>
  ({
    engine_code: code,
    mentioned: cell(6, 8),
    cited: cell(0, 8),
    share_of_voice: cell(0, 0),
    series: ['2026-10-19', '2026-10-26'].map((weekStart) => ({
      week_start: weekStart,
      mentioned: cell(3, 4),
      cited: cell(0, 4),
      share_of_voice: cell(0, 0),
    })),
  }) as unknown as EngineSummary;
/** Two weeks of both engines, Mondays Oct 19 and Oct 26: a chart with a point for each. */
const withSeries: PromptCounts = {
  ...noCounts,
  row: { engines: [seriesOf('chatgpt_web'), seriesOf('gemini_web')] } as unknown as PromptSummaryRow,
};
const modelAnswer = (id: string, code: string, observedAt: string, model: string): ObservationSummary => ({
  ...answer(id, code, observedAt),
  model_reported: model,
});

/** The option the chart was last given, and its dashed boundary lines. */
const lastOption = (): Record<string, unknown> => drawn.options.at(-1) ?? {};
const boundaryLines = (): { at: string; label: string }[] => {
  const series = (lastOption().series ?? []) as { id?: string; markLine?: { data: unknown[] } }[];
  const lines = series.find((entry) => entry.id === 'boundaries')?.markLine?.data ?? [];
  return (lines as { xAxis: string; label: { formatter: () => string } }[]).map((line) => ({
    at: line.xAxis,
    label: line.label.formatter(),
  }));
};
const gridTop = (): unknown => (lastOption().grid as { top?: unknown } | undefined)?.top;

describe('the model change marker on the chart', () => {
  const CHANGE = [
    modelAnswer('m1', 'chatgpt_web', '2026-10-22T02:00:00Z', 'gpt-4o'),
    modelAnswer('m2', 'chatgpt_web', '2026-10-28T02:00:00Z', 'gpt-5'),
  ];

  it('draws a dashed marker for each model change and says it under the Table view', async () => {
    const { user } = renderHistory({ counts: withSeries, answers: answersOf(CHANGE) });
    // The canvas loads on demand
    await screen.findByTestId('echart-canvas');
    // The change of Wed Oct 28 sits on the week of Mon Oct 26, named by its engine and the new model
    expect(boundaryLines()).toEqual([{ at: 'Oct 26', label: 'ChatGPT: gpt-5' }]);
    // The label sits above the plot: the grid has room for it
    expect(gridTop()).toBe(24);
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getByRole('table', { name: 'Mention rate by engine' })).toBeInTheDocument();
    expect(screen.getByText('Model change on ChatGPT, week of Oct 26: gpt-4o to gpt-5')).toBeInTheDocument();
  });

  it('gives two engines that change in one week a marker each, never one pooled label', async () => {
    renderHistory({
      counts: withSeries,
      answers: answersOf([
        ...CHANGE,
        modelAnswer('g1', 'gemini_web', '2026-10-21T02:00:00Z', 'gemini-2.5'),
        modelAnswer('g2', 'gemini_web', '2026-10-29T02:00:00Z', 'gemini-3'),
      ]),
    });
    await screen.findByTestId('echart-canvas');
    expect(boundaryLines()).toEqual(
      expect.arrayContaining([
        { at: 'Oct 26', label: 'ChatGPT: gpt-5' },
        { at: 'Oct 26', label: 'Gemini: gemini-3' },
      ]),
    );
    expect(boundaryLines()).toHaveLength(2);
    expect(screen.getByText('Model change on Gemini, week of Oct 26: gemini-2.5 to gemini-3')).toBeInTheDocument();
    expect(screen.getByText('Model change on ChatGPT, week of Oct 26: gpt-4o to gpt-5')).toBeInTheDocument();
  });

  it('draws no marker, no note and no extra room when no engine changed its model', async () => {
    renderHistory({ counts: withSeries });
    await screen.findByTestId('echart-canvas');
    // The chart is drawn (it has its lines) and has no boundary
    expect((lastOption().series as unknown[]).length).toBeGreaterThan(0);
    expect(boundaryLines()).toEqual([]);
    expect(gridTop()).not.toBe(24);
    expect(screen.queryByText(/Model change on/)).toBeNull();
  });

  it('lets the legend hide an engine', async () => {
    const { user } = renderHistory({ counts: withSeries });
    const legend = screen.getByRole('list', { name: 'Series in Mention rate by engine' });
    const gemini = within(legend).getByRole('button', { name: 'Gemini' });
    expect(gemini).toHaveAttribute('aria-pressed', 'true');
    await user.click(gemini);
    expect(gemini).toHaveAttribute('aria-pressed', 'false');
    expect(within(legend).getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('the latest answers of the History tab', () => {
  const OUTCOMES = ['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither'] as const;
  const WORDS = ['Mentioned and cited', 'Mentioned only', 'Cited only', 'Neither'];
  /** Twelve answers, newest first, one a day at 02:00 from Nov 12 back. */
  const newestFirst = Array.from({ length: 12 }, (_, at): ObservationSummary => {
    const base = answer(`o${String(at)}`, at % 2 === 0 ? 'chatgpt_web' : 'gemini_web', '');
    return {
      ...base,
      observed_at: new Date(Date.UTC(2026, 10, 12 - at, 2)).toISOString(),
      facts: { is_valid: true, outcome: OUTCOMES[at % 4] },
    } as unknown as ObservationSummary;
  });
  const when = (row: ObservationSummary): string => formatTableDateTime(row.observed_at, 'UTC');
  const bodyRows = (): HTMLElement[] =>
    within(screen.getByRole('table', { name: 'Answers to this prompt' }))
      .getAllByRole('row')
      .slice(1);

  it('lists at most 10 rows, one for each answer, newest first, with the outcome in words', () => {
    renderHistory({ answers: answersOf(newestFirst) });
    const rows = bodyRows();
    expect(rows).toHaveLength(10);
    rows.forEach((row, at) => {
      const source = newestFirst[at];
      if (source === undefined) throw new Error('A fixture answer is missing');
      expect(row).toHaveTextContent(when(source));
      expect(row).toHaveTextContent(at % 2 === 0 ? 'ChatGPT' : 'Gemini');
      expect(row).toHaveTextContent(WORDS[at % 4] ?? '');
    });
    // The two oldest answers are past the cap
    for (const left of newestFirst.slice(10)) expect(screen.queryByText(when(left))).toBeNull();
    expect(screen.getByText('The latest 10 answers of this window.')).toBeInTheDocument();
  });

  it('says an answer that is not counted or still being read in words, never as a rate', () => {
    const invalid = { ...newestFirst[0], facts: { is_valid: false, outcome: null } } as unknown as ObservationSummary;
    const unread = { ...newestFirst[1], facts: null } as unknown as ObservationSummary;
    renderHistory({ answers: answersOf([invalid, unread]) });
    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Not counted');
    expect(rows[1]).toHaveTextContent('Being read');
    expect(screen.queryByText(/latest 10 answers/)).toBeNull();
  });
});
