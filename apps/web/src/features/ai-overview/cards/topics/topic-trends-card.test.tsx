import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { Suspense, type ReactElement } from 'react';
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
import TopicTrendsCard from './topic-trends-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { OverviewProvider } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptsSummary } from '@/lib/api/types';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { CARD_ID, cardInOverview, overviewProject } from '@/test/ai-overview-harness';
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
const TITLE = 'Mention rate by week, topic and engine';

const NAMES = ['SEO tools', 'Email', 'CRM', 'Pricing', 'Support', 'Billing', 'Reports'] as const;
const PROMPTS = [12, 8, 6, 5, 4, 3, 2] as const;
const TERMS: TermSpec[] = NAMES.map((name, index) => ({ id: `t${String(index + 1)}`, name, parent: null }));

const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';
const W4 = '2026-11-09';

/** A good week, a thin one (3 answers), one with no valid answer and a last one, as the API sends them. */
const rough = (pooled: boolean): WeekSpec[] => [
  { weekStart: W1, prompts: 10, mentioned: [4, 20], sov: [10, 20] },
  { weekStart: W2, prompts: 3, mentioned: [1, 3], sov: [2, 3] },
  { weekStart: W3, prompts: 9, mentioned: [0, 0] },
  { weekStart: W4, prompts: 5, mentioned: [10, 40], sov: [8, 40], ...(pooled ? { pool: { weeks: 4 } } : {}) },
];
const steady = (k: number): WeekSpec[] =>
  [W1, W2, W3, W4].map((weekStart) => ({ weekStart, prompts: 10, mentioned: [k, 20], sov: [k, 20] }));

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
    return <TopicTrendsCard {...props} options={{ ...props.options, topics: '3', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_trends', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const charts = (): Promise<HTMLElement[]> => screen.findAllByTestId('echart-canvas');
const topicNames = (): string[] => screen.getAllByRole('heading', { level: 3 }).map((entry) => entry.textContent);
const figureOf = (name: string): HTMLElement => {
  const figure = screen.getByRole('img', { name }).closest('figure');
  if (figure === null) throw new Error(`No figure for ${name}`);
  return figure;
};

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_trends' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicTrendsCard', () => {
  it('a row per top topic by prompts and a panel per asked engine', async () => {
    render();
    await charts();
    expect(topicNames()).toEqual(['SEO tools', 'Email', 'CRM']);
    for (const topic of ['SEO tools', 'Email', 'CRM']) {
      for (const engine of ['ChatGPT', 'Gemini']) {
        expect(screen.getByRole('img', { name: `${topic}, ${engine}` })).toBeInTheDocument();
      }
    }
    expect(screen.queryByRole('img', { name: /AI Mode/ })).not.toBeInTheDocument();
  });

  it('topics 3 or 6 cut the panels', async () => {
    const three = render();
    await charts();
    expect(topicNames()).toHaveLength(3);
    three.unmount();
    render({ options: { topics: '6' } });
    await charts();
    // Seven topics are in the read; the six with the most prompts are drawn
    expect(topicNames()).toEqual(['SEO tools', 'Email', 'CRM', 'Pricing', 'Support', 'Billing']);
    expect(screen.getAllByRole('img')).toHaveLength(12);
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

  it('every panel has the one ceiling', async () => {
    render();
    await charts();
    // A panel is drawn under the id of its topic and engine
    const ceilings = ['t1', 't2', 't3'].flatMap((topic) =>
      ['chatgpt_web', 'gemini_web'].flatMap((code) => {
        const id = `${topic}:${code}`;
        return built.canvases.has(id) ? [(drawnOf(id).option.yAxis as { max: number }).max] : [];
      }),
    );
    expect(ceilings.length).toBeGreaterThan(3);
    expect(new Set(ceilings).size).toBe(1);
    // The ceiling fits the highest panel, which is not the first: nothing drawn is above it
    const [ceiling] = ceilings;
    const drawn = [...built.canvases.values()].flatMap((entry) =>
      ((entry as Drawn).option.series as { data: unknown[] }[]).flatMap((series) => series.data),
    );
    const numbers = drawn.flatMap((entry) => {
      const value = typeof entry === 'object' && entry !== null ? (entry as { value?: unknown }).value : entry;
      return typeof value === 'number' ? [value] : [];
    });
    expect(Math.max(...numbers)).toBeLessThanOrEqual(ceiling ?? 0);
    expect(ceiling ?? 0).toBeGreaterThan(0.5);
  });

  it('panels of one topic share a crosshair group and different topics do not', async () => {
    render();
    await charts();
    const groupOf = (topic: string, code: string): string | undefined => drawnOf(`${topic}:${code}`).group;
    expect(groupOf('t1', 'chatgpt_web')).toBeDefined();
    // Email on Gemini has no series, so a row may hold one chart: the topics with two charts share a group
    expect(groupOf('t1', 'chatgpt_web')).toBe(groupOf('t1', 'gemini_web'));
    expect(groupOf('t3', 'chatgpt_web')).toBe(groupOf('t3', 'gemini_web'));
    expect(groupOf('t1', 'chatgpt_web')).not.toBe(groupOf('t3', 'chatgpt_web'));
    expect(groupOf('t2', 'chatgpt_web')).not.toBe(groupOf('t3', 'chatgpt_web'));
  });

  it('the pooled sentence appears only when a point is pooled', async () => {
    const plain = render({ summary: summaryOf7(false) });
    const frame = await frameOf();
    await charts();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    expect(within(frame).queryByText(/shows the last 4 weeks together/)).not.toBeInTheDocument();
    plain.unmount();
    render({ summary: summaryOf7(true) });
    const pooledFrame = await frameOf();
    await charts();
    expect(within(pooledFrame).getByText(/fewer than 10 prompts answering that week/)).toBeInTheDocument();
    // The pooled week says so in its own words, with the weeks it holds and where they end
    expect(within(figureOf('SEO tools, ChatGPT')).getByText(/4 weeks to Nov 12/)).toBeInTheDocument();
  });

  it('the overlap footnote', async () => {
    render();
    const frame = await frameOf();
    await charts();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    expect(within(frame).getByText(/Prompt weighted/)).toBeInTheDocument();
    // The rows hold no prompt rows, so the footnote does not claim how many prompts are in two topics
    expect(within(frame).queryByText(/in more than one topic/)).not.toBeInTheDocument();
  });

  it('the latest week is named in each panel, with its counts', async () => {
    render();
    await charts();
    expect(
      within(figureOf('SEO tools, ChatGPT')).getByText(/Nov 9: 25\.0%, 10 of 40 answers.*5 prompts/),
    ).toBeInTheDocument();
    expect(within(figureOf('CRM, Gemini')).getByText(/Nov 9: 25\.0%, 5 of 20 answers/)).toBeInTheDocument();
  });

  it('a panel with no series says no weekly data in text, never a line at 0', async () => {
    render();
    await charts();
    const figure = figureOf('Email, Gemini');
    expect(within(figure).getAllByText('No weekly data').length).toBeGreaterThan(0);
    expect(within(figure).queryByTestId('echart-canvas')).not.toBeInTheDocument();
    expect(built.canvases.has('t2:gemini_web')).toBe(false);
  });

  it('the summary sentence names the metric and the engines', async () => {
    render({ options: { metric: 'share_of_voice' } });
    await charts();
    expect(
      screen.getByText(/Share of voice week by week for the 3 topics with the most prompts, on ChatGPT and Gemini/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Share of voice by week, topic and engine' }),
    ).toBeInTheDocument();
  });

  it('metric share of voice says the answers that name a brand and draws no band', async () => {
    render({ options: { metric: 'share_of_voice' } });
    await charts();
    expect(
      within(figureOf('SEO tools, ChatGPT')).getByText(/40 valid answers name a tracked brand/),
    ).toBeInTheDocument();
    const series = drawnOf('t1:chatgpt_web').option.series as { id: string }[];
    expect(series.some((entry) => entry.id.endsWith(':band'))).toBe(false);
  });

  it('the Table form has a column per panel with k of n answers', async () => {
    const { user } = render();
    await charts();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      'Week',
      'SEO tools, ChatGPT',
      'SEO tools, Gemini',
      'Email, ChatGPT',
      'Email, Gemini',
      'CRM, ChatGPT',
      'CRM, Gemini',
    ]);
    const first = within(grid).getByRole('row', { name: /^Oct 19/ });
    expect(first).toHaveTextContent(/4 of 20 answers/);
    // The thin week says its answers and no percent; the week with no valid answer says so in words
    expect(within(grid).getByRole('row', { name: /^Oct 26/ })).toHaveTextContent(/3 answers, fewer than 4/);
    expect(within(grid).getByRole('row', { name: /^Nov 2/ })).toHaveTextContent('No data');
    expect(within(grid).getByRole('row', { name: /^Oct 19/ })).toHaveTextContent('No data');
  });

  it('the legend toggles an engine column and keeps at least one', async () => {
    const { user } = render();
    await charts();
    const legend = screen.getByRole('list', { name: `Series in ${TITLE}` });
    await user.click(within(legend).getByRole('button', { name: 'Gemini' }));
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'CRM, Gemini' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('img', { name: 'CRM, ChatGPT' })).toBeInTheDocument();
    // The one engine left cannot be turned off
    await user.click(within(legend).getByRole('button', { name: 'ChatGPT' }));
    expect(screen.getByRole('img', { name: 'CRM, ChatGPT' })).toBeInTheDocument();
    expect(within(legend).getByRole('button', { name: 'ChatGPT' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(legend).getByRole('button', { name: 'Gemini' }));
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'CRM, Gemini' })).toBeInTheDocument();
    });
  });

  it('the ceiling stays when an engine is turned off', async () => {
    const { user } = render();
    await charts();
    const before = (drawnOf('t3:chatgpt_web').option.yAxis as { max: number }).max;
    await user.click(
      within(screen.getByRole('list', { name: `Series in ${TITLE}` })).getByRole('button', { name: 'Gemini' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'CRM, Gemini' })).not.toBeInTheDocument();
    });
    expect((drawnOf('t3:chatgpt_web').option.yAxis as { max: number }).max).toBe(before);
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
    expect(topicNames()).toHaveLength(3);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await charts();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the legend buttons and the Table toggle are tab stops, the canvas is not', async () => {
    const { user } = render();
    await charts();
    for (const canvas of screen.getAllByTestId('echart-canvas')) expect(canvas.tabIndex).toBeLessThan(0);
    const stops = [
      within(screen.getByRole('list', { name: `Series in ${TITLE}` })).getByRole('button', { name: 'ChatGPT' }),
      within(screen.getByRole('list', { name: `Series in ${TITLE}` })).getByRole('button', { name: 'Gemini' }),
    ];
    for (let press = 0; press < 20 && document.activeElement !== stops[0]; press += 1) await user.tab();
    expect(stops[0]).toHaveFocus();
    await user.tab();
    expect(stops[1]).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: 'CRM, Gemini' })).not.toBeInTheDocument();
    });
    const toggle = screen.getByRole('button', { name: 'Table' });
    for (let press = 0; press < 20 && document.activeElement !== toggle; press += 1) await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('TopicTrendsCard states', () => {
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

  it('no engine asked is an empty state with its action', async () => {
    document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('admin').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
    renderWithProviders(
      <PermissionProvider membership={membershipFactory('admin')}>
        <Suspense fallback={null}>
          <OverviewProvider
            workspaceId={MOCK_WORKSPACE.workspace_id}
            workspaceSlug={MOCK_WORKSPACE.slug}
            project={overviewProject('cleanstart')}
          >
            <TopicTrendsCard
              item={{ id: CARD_ID, type: 'ai.topic_trends', width: 'two_thirds', options: {} }}
              options={{ metric: 'mention', topics: '3' }}
              width="two_thirds"
              mode="view"
              live
            />
          </OverviewProvider>
        </Suspense>
      </PermissionProvider>,
    );
    expect(await screen.findByText('No engine is part of this view')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turn on engines' })).toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web'] }) });
    const title = await screen.findByRole('heading', { name: 'No topics yet' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no valid answer in any week names the engines and has one action', async () => {
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
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_trends/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await charts();
    expect(topicNames()).toHaveLength(3);
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

  it('partial names an engine that has no valid answer in any topic', async () => {
    render({ searchParams: 'engine=chatgpt_web,google_ai_mode', threeEngines: true });
    await charts();
    expect(screen.getByText('Partial data: AI Mode has no valid answer in this window')).toBeInTheDocument();
    expect(within(figureOf('CRM, AI Mode')).getAllByText('No weekly data').length).toBeGreaterThan(0);
  });
});

describe('TopicTrendsCard export block', () => {
  it('registers a block under the item id with the weekly rows, an unknown as an empty cell with a status', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicTrendsCard {...props} options={{ ...props.options, topics: '3' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(summaryOf7()), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.topic_trends', Card, width: 'two_thirds' }), {
      searchParams: TWO_ENGINES,
    });
    await charts();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['topic', 'engine', 'week', 'rate_percent', 'answers', 'status']);
    const rows = block?.rows ?? [];
    expect(rows).toHaveLength(3 * 2 * 4);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W1, 20, 20, 'ok']);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W2, null, 3, 'insufficient']);
    expect(rows).toContainEqual(['SEO tools', 'chatgpt_web', W3, null, 0, 'no_answers']);
    expect(rows).toContainEqual(['Email', 'gemini_web', W1, null, 0, 'no_series']);
    expect(rows.filter((row) => row[3] === 0)).toEqual([]);
  });
});
