import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  engineCells,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
  type TermSpec,
  type WeekSpec,
} from './topic-card-test-kit';
import TopicSmallMultiplesCard from './topic-small-multiples-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptsSummary } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { TOKENS } from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

// The options each canvas was given, by the id of its first series: jsdom has no canvas
interface Drawn {
  option: Record<string, unknown>;
  group: string | undefined;
}
const built = vi.hoisted(() => ({ canvases: new Map<string, unknown>() }));
vi.mock('@/components/app/chart/echart', () => ({
  EChart: ({
    option,
    group,
  }: {
    option: (tokens: ChartTokens) => Record<string, unknown>;
    height: number;
    group?: string;
  }) => {
    // `TOKENS` is read when a canvas renders, long after the module has loaded
    const drawn = option(TOKENS);
    const first = (drawn.series as { id: string }[])[0];
    if (first !== undefined) built.canvases.set(first.id, { option: drawn, group });
    return <div data-testid="echart-canvas" />;
  },
}));
const drawnOf = (id: string): Drawn => {
  const drawn = built.canvases.get(id) as Drawn | undefined;
  if (drawn === undefined) throw new Error(`No canvas was drawn for ${id}`);
  return drawn;
};

beforeEach(() => {
  built.canvases.clear();
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SUMMARY_PATH = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');
const TITLE_CHATGPT = 'Mention rate by topic on ChatGPT';

const NAMES = ['SEO tools', 'Email', 'CRM', 'Pricing', 'Support', 'Billing', 'Reports'] as const;
const PROMPTS = [12, 8, 6, 5, 4, 3, 2] as const;
const TERMS: TermSpec[] = NAMES.map((name, index) => ({ id: `t${String(index + 1)}`, name, parent: null }));

const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';
const W4 = '2026-11-09';

/** A good week, a thin one (3 answers), one with no valid answer and a last one, as the API sends them. */
const rough = (pooled: boolean): WeekSpec[] => [
  { weekStart: W1, prompts: 10, mentioned: [4, 20] },
  { weekStart: W2, prompts: 3, mentioned: [1, 3] },
  { weekStart: W3, prompts: 9, mentioned: [0, 0] },
  { weekStart: W4, prompts: 5, mentioned: [10, 40], ...(pooled ? { pool: { weeks: 4 } } : {}) },
];
const steady = (k: number): WeekSpec[] =>
  [W1, W2, W3, W4].map((weekStart) => ({ weekStart, prompts: 10, mentioned: [k, 20] }));

/** SEO tools on ChatGPT is the rough series; Email on Gemini has none; the rest are steady. */
function summaryOf7(pooled = false): PromptsSummary {
  return summaryOf({
    topics: NAMES.map((name, index) =>
      topicRow(`t${String(index + 1)}`, name, PROMPTS[index] ?? 1, [
        engineCells('chatgpt_web', {
          mentioned: [15, 63],
          prompts: PROMPTS[index] ?? 1,
          series: index === 0 ? rough(pooled) : steady(6 + index),
        }),
        engineCells('gemini_web', {
          mentioned: [8, 40],
          prompts: PROMPTS[index] ?? 1,
          ...(index === 1 ? {} : { series: steady(3 + index) }),
        }),
      ]),
    ),
  });
}

const TWO_ENGINES = 'engine=chatgpt_web,gemini_web';

/** No mock project has AI Mode on, so the three engines are served as the project's. */
const THREE_ENGINES = http.get(mswPath('/api/v1/workspaces/:w/projects/:p/engines'), () =>
  HttpResponse.json({
    data: (['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const).map((code) => projectEngine(code)),
  }),
);

interface Setup {
  options?: Record<string, string>;
  searchParams?: string;
  summary?: PromptsSummary | ((url: URL) => PromptsSummary | Response);
  threeEngines?: boolean;
  /** Holds the vocabulary read until it is released. */
  vocabularies?: Promise<void>;
}

/** A vocabulary read that waits for `release`, then falls through to the served vocabularies. */
const heldVocabularies = (release: Promise<void>): RequestHandler =>
  http.get(mswPath('/api/v1/workspaces/:w/vocabularies'), async () => {
    await release;
    return undefined;
  });

function render({
  options = {},
  searchParams = TWO_ENGINES,
  summary = summaryOf7(),
  threeEngines = false,
  vocabularies,
}: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (vocabularies !== undefined) server.use(heldVocabularies(vocabularies));
  if (threeEngines) server.use(THREE_ENGINES);
  return renderCard({ options, searchParams });
}

function renderCard({ options = {}, searchParams = TWO_ENGINES }: Setup) {
  function Card(props: CardProps): ReactElement {
    return (
      <TopicSmallMultiplesCard
        {...props}
        options={{ ...props.options, engine: 'chatgpt_web', topics: '6', ...options }}
      />
    );
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_small_multiples', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (title = TITLE_CHATGPT): Promise<HTMLElement> =>
  screen.findByRole('heading', { level: 2, name: title });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const charts = (): Promise<HTMLElement[]> => screen.findAllByTestId('echart-canvas');
const figureOf = (name: string): HTMLElement => {
  const figure = screen.getByRole('img', { name }).closest('figure');
  if (figure === null) throw new Error(`No figure for ${name}`);
  return figure;
};

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_multiples' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicSmallMultiplesCard', () => {
  it('a panel per top topic by prompts, named with its prompts', async () => {
    render();
    await charts();
    const names = screen.getAllByRole('img').map((panel) => panel.getAttribute('aria-label'));
    expect(names).toEqual([
      'SEO tools (12 prompts)',
      'Email (8 prompts)',
      'CRM (6 prompts)',
      'Pricing (5 prompts)',
      'Support (4 prompts)',
      'Billing (3 prompts)',
    ]);
  });

  it('topics 6 or 9 cut the panels', async () => {
    const nine = render({ options: { topics: '9' } });
    await charts();
    // Seven topics are in the read, and all of them are drawn
    expect(screen.getAllByRole('img')).toHaveLength(7);
    nine.unmount();
    render({ options: { topics: '6' } });
    await charts();
    expect(screen.getAllByRole('img')).toHaveLength(6);
    expect(screen.queryByRole('img', { name: /Reports/ })).not.toBeInTheDocument();
  });

  it('draws every panel for the engine chosen and says it in the title', async () => {
    render({ options: { engine: 'gemini_web' } });
    expect(await heading('Mention rate by topic on Gemini')).toBeInTheDocument();
    await charts();
    // The marker of an engine is its place in the fixed order: Gemini is a square, ChatGPT a circle
    const symbolOf = (id: string): unknown => (drawnOf(id).option.series as { symbol?: string }[])[0]?.symbol;
    expect(symbolOf('t3:gemini_web')).toBe('rect');
    expect(built.canvases.has('t3:chatgpt_web')).toBe(false);
  });

  it('ask the summary with include=series and rows=topics and nothing else', async () => {
    const asked: URL[] = [];
    const listener = ({ request }: { request: Request }): void => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url);
    };
    server.events.on('request:start', listener);
    render({ searchParams: `${TWO_ENGINES}&cmp=on` });
    await charts();
    server.events.removeListener('request:start', listener);
    // One read: no previous series is read, however the comparison is set
    expect(asked).toHaveLength(1);
    expect(asked[0]?.searchParams.get('include')).toBe('series');
    expect(asked[0]?.searchParams.get('rows')).toBe('topics');
    for (const key of ['compare', 'cells', 'total', 'co_mentions']) expect(asked[0]?.searchParams.has(key)).toBe(false);
  });

  it('every panel has the one ceiling and one crosshair', async () => {
    render();
    await charts();
    const drawn = ['t1', 't2', 't3', 't4', 't5', 't6'].map((topic) => drawnOf(`${topic}:chatgpt_web`));
    expect(new Set(drawn.map((entry) => (entry.option.yAxis as { max: number }).max)).size).toBe(1);
    expect(new Set(drawn.map((entry) => entry.group)).size).toBe(1);
    expect(drawn[0]?.group).toBeDefined();
  });

  it('the pooled sentence appears only when a point is pooled', async () => {
    const plain = render({ summary: summaryOf7(false) });
    const frame = await frameOf();
    await charts();
    expect(within(frame).queryByText(/shows the last 4 weeks together/)).not.toBeInTheDocument();
    plain.unmount();
    render({ summary: summaryOf7(true) });
    const pooledFrame = await frameOf();
    await charts();
    expect(within(pooledFrame).getByText(/fewer than 10 prompts answering that week/)).toBeInTheDocument();
    expect(within(figureOf('SEO tools (12 prompts)')).getByText(/4 weeks to Nov 12/)).toBeInTheDocument();
  });

  it('the overlap footnote', async () => {
    render();
    const frame = await frameOf();
    await charts();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    expect(within(frame).getByText(/Prompt weighted/)).toBeInTheDocument();
    expect(within(frame).getByText(/95 percent interval/)).toBeInTheDocument();
    expect(within(frame).queryByText(/in more than one topic/)).not.toBeInTheDocument();
  });

  it('the latest week is named in each panel, with its counts', async () => {
    render();
    await charts();
    expect(
      within(figureOf('SEO tools (12 prompts)')).getByText(/Nov 9: 25\.0%, 10 of 40 answers.*5 prompts/),
    ).toBeInTheDocument();
    expect(within(figureOf('CRM (6 prompts)')).getByText(/Nov 9: 40\.0%, 8 of 20 answers/)).toBeInTheDocument();
  });

  it('a topic with no series says no weekly data in text, never a line at 0', async () => {
    render({ options: { engine: 'gemini_web' } });
    await charts();
    const figure = figureOf('Email (8 prompts)');
    expect(within(figure).getAllByText('No weekly data').length).toBeGreaterThan(0);
    expect(within(figure).queryByTestId('echart-canvas')).not.toBeInTheDocument();
  });

  it('the summary sentence names the metric, the engine and the topics', async () => {
    render();
    await charts();
    expect(
      screen.getByText(/Mention rate week by week for the 6 topics with the most prompts on ChatGPT/),
    ).toBeInTheDocument();
  });

  it('the Table form has a column per topic with k of n answers', async () => {
    const { user } = render();
    await charts();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Week',
      'SEO tools (12 prompts)',
      'Email (8 prompts)',
      'CRM (6 prompts)',
      'Pricing (5 prompts)',
      'Support (4 prompts)',
      'Billing (3 prompts)',
    ]);
    expect(within(grid).getByRole('row', { name: /^Oct 19/ })).toHaveTextContent(/4 of 20 answers/);
    expect(within(grid).getByRole('row', { name: /^Oct 26/ })).toHaveTextContent(/3 answers, fewer than 4/);
    expect(within(grid).getByRole('row', { name: /^Nov 2/ })).toHaveTextContent('No data');
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the panels', async () => {
    const release = gate();
    let served = false;
    render({
      vocabularies: release.promise,
      summary: () => {
        served = true;
        return summaryOf7();
      },
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(served).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryAllByTestId('echart-canvas')).toHaveLength(0);
    release.open();
    await charts();
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await charts();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the Table toggle is a tab stop, the canvas is not', async () => {
    const { user } = render();
    await charts();
    for (const canvas of screen.getAllByTestId('echart-canvas')) expect(canvas.tabIndex).toBeLessThan(0);
    const toggle = screen.getByRole('button', { name: 'Table' });
    for (let press = 0; press < 20 && document.activeElement !== toggle; press += 1) await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('TopicSmallMultiplesCard states', () => {
  it('loading is the skeleton at the frame height, with no chart', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await release.promise;
        return HttpResponse.json({ data: summaryOf7() });
      }),
      ...vocabularyHandlers(TERMS),
    );
    renderCard({});
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[style*="height: 280px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryAllByTestId('echart-canvas')).toHaveLength(0);
    release.open();
    await charts();
  });

  it('an engine the view does not ask is an empty state that can clear the filter', async () => {
    const { user } = render({
      options: { engine: 'google_ai_mode' },
      searchParams: 'engine=chatgpt_web',
      threeEngines: true,
    });
    expect(await screen.findByText('AI Mode is not part of this view')).toBeInTheDocument();
    expect(screen.queryAllByTestId('echart-canvas')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(screen.queryByText('AI Mode is not part of this view')).not.toBeInTheDocument();
    });
    expect(await heading('Mention rate by topic on AI Mode')).toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web'] }) });
    const title = await screen.findByRole('heading', { name: 'No topics yet' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no valid answer in any week names the engine and has one action', async () => {
    render({
      searchParams: 'engine=chatgpt_web',
      summary: summaryOf({
        topics: [
          topicRow('t1', 'SEO tools', 4, [
            engineCells('chatgpt_web', {
              mentioned: [0, 0],
              prompts: 4,
              series: [{ weekStart: W1, prompts: 0, mentioned: [0, 0] }],
            }),
          ]),
        ],
      }),
    });
    const title = await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getAllByRole('link')).toHaveLength(1);
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = render({ summary: () => (calls++ === 0 ? failing() : summaryOf7()) });
    expect(await screen.findByText(`${TITLE_CHATGPT} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_multiples/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await charts();
    expect(screen.getAllByRole('img')).toHaveLength(6);
  });

  it('refetching keeps the panels and shows the refetch bar', async () => {
    const { queryClient } = render();
    await charts();
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await release.promise;
        return HttpResponse.json({ data: summaryOf7() });
      }),
    );
    act(() => {
      void queryClient.invalidateQueries();
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(screen.getAllByTestId('echart-canvas').length).toBeGreaterThan(0);
    release.open();
  });

  it('a failed refresh keeps the panels and says these are the last figures', async () => {
    const { queryClient } = render();
    await charts();
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getAllByTestId('echart-canvas').length).toBeGreaterThan(0);
  });
});

describe('TopicSmallMultiplesCard export block', () => {
  it('registers a block under the item id with the weekly rows, an unknown as an empty cell with a status', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicSmallMultiplesCard {...props} options={{ ...props.options, engine: 'gemini_web', topics: '6' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(summaryOf7()), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.topic_small_multiples', Card, width: 'two_thirds' }), {
      searchParams: TWO_ENGINES,
    });
    await charts();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['topic', 'engine', 'week', 'rate_percent', 'answers', 'status']);
    const rows = block?.rows ?? [];
    expect(rows).toHaveLength(6 * 4);
    expect(rows).toContainEqual(['SEO tools', 'gemini_web', W1, 15, 20, 'ok']);
    expect(rows).toContainEqual(['Email', 'gemini_web', W1, null, 0, 'no_series']);
    expect(rows.filter((row) => row[3] === 0)).toEqual([]);
  });
});
