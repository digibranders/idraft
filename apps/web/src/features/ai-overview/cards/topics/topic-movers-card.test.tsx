import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
  type TermSpec,
} from './topic-card-test-kit';
import TopicMoversCard from './topic-movers-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SUMMARY_PATH = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');
const TITLE = 'Topics gaining or losing';
/** The window before Oct 16 to Nov 12 ends on this day. */
const PREVIOUS_TO = '2026-10-15';

const TERMS: TermSpec[] = ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, name: id, parent: null }));
type Pair = readonly [number, number];

function row(id: string, name: string, counts: Record<string, Pair>) {
  return topicRow(
    id,
    name,
    5,
    Object.entries(counts).map(([code, pair]) =>
      engineCells(code, { mentioned: pair, cited: pair, sov: pair, prompts: 5 }),
    ),
  );
}

const prompt = (id: string, topics: string[]) =>
  promptRow(id, `prompt ${id}`, topics, [engineCells('chatgpt_web', { mentioned: [1, 2] })]);

// SEO tools gained 40 points and Email lost 55 (both detectable), CRM moved 2 points (within normal variation),
// Pricing is not in the window before and Support has 3 answers now: those two cannot be compared.
const NOW: PromptsSummary = summaryOf({
  topics: [
    row('t1', 'SEO tools', { chatgpt_web: [80, 100], gemini_web: [30, 100] }),
    row('t2', 'Email', { chatgpt_web: [20, 100] }),
    row('t3', 'CRM', { chatgpt_web: [52, 100] }),
    row('t4', 'Pricing', { chatgpt_web: [9, 10] }),
    row('t5', 'Support', { chatgpt_web: [3, 3] }),
  ],
  prompts: [
    prompt('p1', ['t1']),
    prompt('p2', ['t1']),
    prompt('p5', ['t1', 't3']),
    prompt('p3', ['t2']),
    prompt('p4', ['t2']),
  ],
});
const BEFORE: PromptsSummary = summaryOf({
  topics: [
    row('t1', 'SEO tools', { chatgpt_web: [40, 100], gemini_web: [30, 100] }),
    row('t2', 'Email', { chatgpt_web: [75, 100] }),
    row('t3', 'CRM', { chatgpt_web: [50, 100] }),
    row('t5', 'Support', { chatgpt_web: [8, 10] }),
  ],
  prompts: [
    prompt('p1', ['t1']),
    prompt('p2', ['t1']),
    prompt('p5', ['t1', 't3']),
    prompt('p3', ['t2']),
    prompt('p9', ['t2']),
  ],
});

const isPrevious = (url: URL): boolean => url.searchParams.get('to') === PREVIOUS_TO;
const periods =
  (now: PromptsSummary, before: PromptsSummary) =>
  (url: URL): PromptsSummary =>
    isPrevious(url) ? before : now;

interface Setup {
  options?: Record<string, string>;
  searchParams?: string;
  summary?: PromptsSummary | ((url: URL) => PromptsSummary | Response);
  vocabularies?: RequestHandler;
}

const ONE_ENGINE = 'engine=chatgpt_web';
const TWO_ENGINES = 'engine=chatgpt_web,gemini_web';

function renderCard({
  options = {},
  searchParams = ONE_ENGINE,
  summary = periods(NOW, BEFORE),
  vocabularies,
}: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (vocabularies !== undefined) server.use(vocabularies);
  function Card(props: CardProps): ReactElement {
    return <TopicMoversCard {...props} options={{ ...props.options, rows: '5', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_movers', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const listOf = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^Topics gaining or losing/ });
const itemsOf = async (): Promise<HTMLElement[]> => within(await listOf()).getAllByRole('listitem');
const labelsOf = async (): Promise<string[]> =>
  (await itemsOf()).map((item) => item.querySelector('[class*="truncate"]')?.textContent ?? '');

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_movers' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicMoversCard', () => {
  it('lists the detectable moves first by absolute points, one row per topic and engine', async () => {
    renderCard({ searchParams: TWO_ENGINES });
    expect(await labelsOf()).toEqual(['Email, ChatGPT', 'SEO tools, ChatGPT']);
  });

  it('colours a bar only when detectable (tone from formatMetricDelta)', async () => {
    renderCard();
    const items = await itemsOf();
    // Only the two detectable moves are drawn; CRM moved within normal variation and has no bar at all
    const bars = items.flatMap((item) => [...item.querySelectorAll('[data-slot="interval-bar"]')]);
    expect(bars).toHaveLength(2);
    const [loss, gain] = bars;
    expect(loss?.className).toContain('bg-negative-solid');
    expect(gain?.className).toContain('bg-positive-solid');
    expect(items.some((item) => /CRM/.test(item.textContent ?? ''))).toBe(false);
    expect(items[0]).toHaveTextContent(/Email, ChatGPT: .*55\.0 pts/);
    expect(items[1]).toHaveTextContent(/SEO tools, ChatGPT: \+40\.0 pts/);
  });

  it('folds the others into counted lines', async () => {
    renderCard();
    await listOf();
    expect(screen.getByText('1 topic moved within normal variation')).toBeInTheDocument();
    expect(screen.getByText('2 topics could not be compared')).toBeInTheDocument();
  });

  it('direction down keeps only the losses', async () => {
    renderCard({ options: { direction: 'down' } });
    expect(await labelsOf()).toEqual(['Email, ChatGPT']);
  });

  it('the interim label unpaired, pooled counts is in the footnote', async () => {
    renderCard();
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText(/unpaired, pooled counts/)).toBeInTheDocument();
  });

  it('says how many prompts are in both windows', async () => {
    renderCard();
    const items = await itemsOf();
    expect(items[0]).toHaveTextContent('1 of 2 prompts in both windows');
    expect(items[1]).toHaveTextContent('same 3 prompts');
  });

  it('share of voice has no test, so its rows say the change cannot be tested and draw no bar', async () => {
    renderCard({ options: { metric: 'share_of_voice' } });
    const items = await itemsOf();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.querySelector('[data-slot="interval-bar"]')).toBeNull();
    expect(items[0]).toHaveTextContent(/Change cannot be tested/);
  });

  it('a listed change that no test could judge is drawn with no colour', async () => {
    // CRM: the weighted rate fell 1 point while the pooled answers rose 2 points, so the test cannot speak for the
    // weighted change (detectable is null) and the bar is drawn with its interval but must stay neutral
    const crm = (pair: Pair, value: number) => {
      const base = row('t3', 'CRM', { chatgpt_web: pair });
      return {
        ...base,
        engines: base.engines.map((cells) => ({
          ...cells,
          mentioned: { ...cells.mentioned, value, numerator: value * 5 },
        })),
      };
    };
    renderCard({
      summary: periods(
        summaryOf({ topics: [row('t1', 'SEO tools', { chatgpt_web: [80, 100] }), crm([52, 100], 0.49)] }),
        summaryOf({ topics: [row('t1', 'SEO tools', { chatgpt_web: [40, 100] }), crm([50, 100], 0.5)] }),
      ),
    });
    const items = await itemsOf();
    const untested = items.find((item) => /CRM, ChatGPT/.test(item.textContent ?? ''));
    expect(untested).toBeDefined();
    expect(untested).toHaveTextContent(/not tested/);
    const bar = untested?.querySelector('[data-slot="interval-bar"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain('bg-chart-reference');
    expect(bar?.className).not.toMatch(/positive|negative/);
    expect(untested?.querySelector('[class*="text-negative-text"], [class*="text-positive-text"]')).toBeNull();
    // The detectable gain beside it is still coloured
    const gain = items.find((item) => /SEO tools, ChatGPT/.test(item.textContent ?? ''));
    expect(gain?.querySelector('[data-slot="interval-bar"]')?.className).toContain('bg-positive-solid');
  });

  it('compare off is an empty state with Compare with the previous period that turns it on', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(periods(NOW, BEFORE)), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <TopicMoversCard {...props} />;
    }
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.topic_movers', Card, width: 'two_thirds' }), {
      searchParams: `${ONE_ENGINE}&cmp=off`,
      onUrlUpdate: ({ queryString }) => {
        updates.push(queryString);
      },
    });
    const title = await screen.findByRole('heading', { name: 'Comparison is off' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('button'), ...box.queryAllByRole('link')]).toHaveLength(1);
    await user.click(box.getByRole('button', { name: 'Compare with the previous period' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('cmp=off');
  });

  it('an empty previous window says so', async () => {
    renderCard({
      summary: periods(
        NOW,
        summaryOf({
          topics: [row('t1', 'SEO tools', { chatgpt_web: [0, 0] })],
          prompts: [prompt('p1', ['t1'])],
          engineCodes: ['chatgpt_web'],
        }),
      ),
    });
    expect(await screen.findByRole('heading', { name: 'No answers in the previous 28 days' })).toBeInTheDocument();
  });

  it('nothing moved is an empty state with an action', async () => {
    renderCard({ options: { direction: 'up' }, summary: periods(BEFORE, BEFORE) });
    const title = await screen.findByRole('heading', { name: 'No topic moved' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('not paired shows refetching and no change', async () => {
    // The window now is read and the window before is still on its way: the two are not paired
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const previous = isPrevious(new URL(request.url));
        if (previous) await release.promise;
        return HttpResponse.json({ data: previous ? BEFORE : NOW });
      }),
      ...vocabularyHandlers(TERMS),
    );
    renderWithProviders(cardInOverview({ type: 'ai.topic_movers', Card: TopicMoversCard, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    const frame = await frameOf();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list', { name: /^Topics gaining or losing/ })).not.toBeInTheDocument();
    expect(frame).not.toHaveTextContent(/\d pts/);
    expect(screen.queryByRole('heading', { name: 'Comparison is off' })).not.toBeInTheDocument();
    release.open();
    expect(await itemsOf()).toHaveLength(2);
  });

  it('a row links to the drawer', async () => {
    renderCard();
    const link = within((await itemsOf())[1] as HTMLElement).getByRole('link');
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('inspect')).toBe('topic:t1');
  });

  it('the overlap footnote', async () => {
    renderCard();
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
  });

  it('requests: current and previous, no include', async () => {
    const urls: URL[] = [];
    renderCard({
      summary: (url) => {
        urls.push(url);
        return isPrevious(url) ? BEFORE : NOW;
      },
    });
    await listOf();
    expect(new Set(urls.map((url) => url.searchParams.get('to')))).toEqual(new Set(['2026-11-12', PREVIOUS_TO]));
    for (const url of urls) {
      expect(url.searchParams.has('include')).toBe(false);
      expect(url.searchParams.has('rows')).toBe(false);
      expect(url.searchParams.has('compare')).toBe(false);
    }
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the rows', async () => {
    const release = gate();
    renderCard({
      vocabularies: http.get(mswPath('/api/v1/workspaces/:w/vocabularies'), async () => {
        await release.promise;
        return undefined;
      }),
    });
    const frame = await frameOf();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /^Topics gaining or losing/ })).not.toBeInTheDocument();
    release.open();
    expect(await labelsOf()).toEqual(['Email, ChatGPT', 'SEO tools, ChatGPT']);
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    renderCard({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web'] }) });
    expect(await screen.findByRole('heading', { name: 'No topics yet' })).toBeInTheDocument();
  });

  it('no valid answers now names the engine and the days', async () => {
    renderCard({
      summary: periods(summaryOf({ topics: [row('t1', 'SEO tools', { chatgpt_web: [0, 0] })] }), BEFORE),
    });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' }),
    ).toBeInTheDocument();
  });

  it('partial names an engine with no valid answer in any topic', async () => {
    renderCard({ searchParams: TWO_ENGINES, summary: periods(NOW, BEFORE) });
    await listOf();
    expect(screen.queryByText(/Partial data/)).not.toBeInTheDocument();
    renderCard({
      searchParams: TWO_ENGINES,
      summary: periods(
        summaryOf({ topics: [row('t1', 'SEO tools', { chatgpt_web: [80, 100], gemini_web: [0, 0] })] }),
        summaryOf({ topics: [row('t1', 'SEO tools', { chatgpt_web: [40, 100], gemini_web: [0, 0] })] }),
      ),
    });
    expect(await screen.findByText('Partial data: Gemini has no valid answer in this window')).toBeInTheDocument();
  });

  it('the Table form has the change and its interval per row', async () => {
    const { user } = renderCard();
    await listOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Topic and engine', 'Change', '95% interval']);
    const gain = within(grid).getByRole('row', { name: /^SEO tools, ChatGPT/ });
    // The topic and engine is the row header; the cells are the change and its interval
    expect(within(gain).getByRole('rowheader')).toHaveTextContent('SEO tools, ChatGPT');
    expect(within(gain).getAllByRole('cell')[0]).toHaveTextContent('+40.0 pts');
  });

  it('has no axe violations', async () => {
    const { container } = renderCard();
    await listOf();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the rows are links and Tab visits them in order', async () => {
    const { user } = renderCard();
    const links = within(await listOf()).getAllByRole('link');
    for (let press = 0; press < 12 && document.activeElement !== links[0]; press += 1) await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
  });
});

describe('TopicMoversCard states', () => {
  it('loading is the skeleton at the frame height, with no list', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        await release.promise;
        return HttpResponse.json({ data: isPrevious(new URL(request.url)) ? BEFORE : NOW });
      }),
      ...vocabularyHandlers(TERMS),
    );
    renderWithProviders(cardInOverview({ type: 'ai.topic_movers', Card: TopicMoversCard, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[style*="height: 240px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /^Topics gaining or losing/ })).not.toBeInTheDocument();
    release.open();
    await listOf();
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = renderCard({ summary: (url) => (calls++ === 0 ? failing() : isPrevious(url) ? BEFORE : NOW) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_movers/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await itemsOf()).toHaveLength(2);
  });

  it('a previous window that fails is an error, never a change from nothing', async () => {
    const { user } = renderCard({ summary: (url) => (isPrevious(url) ? failing() : NOW) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /^Topics gaining or losing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    void user;
  });

  // The current window refetching shows the bar; the previous window alone refetching is the same scope's data
  // still on screen, so it keeps the rows (and the change) without the bar
  it.each([
    ['both windows', () => true, true],
    ['the previous window alone', isPrevious, false],
  ])('a refetch of %s keeps the rows, never a skeleton', async (_name, held, bar) => {
    const { queryClient } = renderCard();
    await listOf();
    const release = gate();
    let asked = false;
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const url = new URL(request.url);
        if (held(url)) {
          asked = true;
          await release.promise;
        }
        return HttpResponse.json({ data: isPrevious(url) ? BEFORE : NOW });
      }),
    );
    act(() => {
      void queryClient.invalidateQueries();
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(asked).toBe(true);
    });
    if (bar) {
      await waitFor(() => {
        expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
      });
    } else {
      // The current window is served at once, so its own refetch ends; the held previous one shows no bar
      await waitFor(() => {
        expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
      });
    }
    expect(await itemsOf()).toHaveLength(2);
    expect(frame.querySelector('[data-slot="skeleton"]')).toBeNull();
    release.open();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
    expect(await itemsOf()).toHaveLength(2);
  });
});

describe('TopicMoversCard export block', () => {
  it('registers a block under the item id, with an empty cell and a status for an unknown, never 0', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicMoversCard {...props} options={{ ...props.options, rows: '5' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(periods(NOW, BEFORE)), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.topic_movers', Card, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    await listOf();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'topic',
      'engine',
      'now_rate_percent',
      'now_answers',
      'now_status',
      'before_rate_percent',
      'before_answers',
      'before_status',
      'change_points',
      'reading',
    ]);
    const rows = block?.rows ?? [];
    expect(rows.find((entry) => entry[0] === 'SEO tools')).toEqual([
      'SEO tools',
      'chatgpt_web',
      80,
      100,
      'ok',
      40,
      100,
      'ok',
      40,
      'detectable',
    ]);
    // Pricing is not in the window before: its before side is empty with a status and no change is written
    expect(rows.find((entry) => entry[0] === 'Pricing')).toEqual([
      'Pricing',
      'chatgpt_web',
      90,
      10,
      'ok',
      null,
      0,
      'no_answers',
      null,
      'not_compared',
    ]);
  });
});
