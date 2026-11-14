import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TopicEngineGapCard from './topic-engine-gap-card';
import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
  type TermSpec,
} from './topic-card-test-kit';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
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
const TITLE = 'Where engines disagree';

const TERMS: TermSpec[] = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id) => ({ id, name: id, parent: null }));
type Pair = readonly [number, number];

function row(id: string, name: string, prompts: number, counts: Record<string, Pair>) {
  return topicRow(
    id,
    name,
    prompts,
    Object.entries(counts).map(([code, pair]) =>
      engineCells(code, { mentioned: pair, cited: pair, sov: pair, prompts }),
    ),
  );
}

// Spread on ChatGPT and Gemini: Email 42, Support 40, CRM 33.3, SEO tools 17.1, Billing 10.
// Pricing has one engine with a rate (Gemini has 3 answers), so it cannot be compared.
const SUMMARY: PromptsSummary = summaryOf({
  topics: [
    row('t1', 'SEO tools', 12, { chatgpt_web: [64, 136], gemini_web: [30, 100] }),
    row('t2', 'Email', 8, { chatgpt_web: [40, 80], gemini_web: [4, 50] }),
    row('t3', 'CRM', 6, { chatgpt_web: [10, 60], gemini_web: [28, 56] }),
    row('t4', 'Pricing', 5, { chatgpt_web: [2, 40], gemini_web: [3, 3] }),
    row('t5', 'Support', 2, { chatgpt_web: [9, 10], gemini_web: [5, 10] }),
    row('t6', 'Billing', 4, { chatgpt_web: [11, 20], gemini_web: [9, 20] }),
  ],
  prompts: [promptRow('p1', 'best seo tools', ['t1', 't2'], [engineCells('chatgpt_web', { mentioned: [3, 4] })])],
});

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
  summary = SUMMARY,
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
    return <TopicEngineGapCard {...props} options={{ ...props.options, rows: '10', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_engine_gap', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const plotOf = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^Engine range of topics/ });
const itemsOf = async (): Promise<HTMLElement[]> => within(await plotOf()).getAllByRole('listitem');
const labelOf = (item: HTMLElement): string => item.querySelector('[data-slot="range-label"]')?.textContent ?? '';

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_gap' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicEngineGapCard', () => {
  it('rows ordered by spread', async () => {
    render();
    expect((await itemsOf()).map(labelOf)).toEqual(['Email', 'Support', 'CRM', 'SEO tools', 'Billing']);
  });

  it('rows 5 and 10 cut the list to the topics with the largest spread', async () => {
    render({ options: { rows: '2' } });
    expect((await itemsOf()).map(labelOf)).toEqual(['Email', 'Support']);
  });

  it('a row says the spread in points and the verdict words', async () => {
    render();
    const items = await itemsOf();
    expect(items[0]).toHaveTextContent(/Email: 42 points between ChatGPT and Gemini, detectable difference/);
    const billing = items[4];
    expect(billing).toHaveTextContent(/Billing: 10 points between ChatGPT and Gemini, within normal variation/);
    // Every engine's value comes with its counts
    expect(items[0]).toHaveTextContent(/ChatGPT: 50\.0%, 40 of 80 answers.*Gemini: 8\.0%, 4 of 50 answers/);
  });

  it('a topic with a thin engine says its answers and the verdict is too few answers', async () => {
    render({
      searchParams: '',
      threeEngines: true,
      summary: summaryOf({
        topics: [row('t1', 'Mixed', 6, { chatgpt_web: [8, 10], gemini_web: [2, 10], google_ai_mode: [1, 3] })],
      }),
    });
    const items = await itemsOf();
    const item = items[0] as HTMLElement;
    expect(item).toHaveTextContent(/AI Mode: 3 answers/);
    expect(item).toHaveTextContent(/too few answers to tell/);
    expect(item.querySelectorAll('[data-slot="range-dot"]')).toHaveLength(2);
  });

  it('an all-zero row reads no engine names you, and an equal row reads the same on every engine', async () => {
    render({
      summary: summaryOf({
        topics: [
          row('t1', 'Nobody', 6, { chatgpt_web: [0, 10], gemini_web: [0, 10] }),
          row('t2', 'Same', 5, { chatgpt_web: [5, 10], gemini_web: [5, 10] }),
        ],
      }),
    });
    const items = await itemsOf();
    const nobody = items.find((item) => labelOf(item) === 'Nobody') as HTMLElement;
    const same = items.find((item) => labelOf(item) === 'Same') as HTMLElement;
    expect(nobody).toHaveTextContent(/Nobody: no engine names you\./);
    expect(nobody).not.toHaveTextContent(/too few answers/);
    expect(same).toHaveTextContent(/Same: the same on every engine\./);
    expect(same).not.toHaveTextContent(/too few answers/);
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the rows', async () => {
    const release = gate();
    let served = false;
    render({
      vocabularies: release.promise,
      summary: () => {
        served = true;
        return SUMMARY;
      },
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(served).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /^Engine range of topics/ })).not.toBeInTheDocument();
    release.open();
    expect(await itemsOf()).toHaveLength(5);
  });

  it('share of voice says the difference has no test', async () => {
    render({ options: { metric: 'share_of_voice' } });
    expect((await itemsOf())[0]).toHaveTextContent(/share of voice has no test for a difference/);
  });

  it('one asked engine is an empty state "Needs two engines" with Use all engines', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <TopicEngineGapCard {...props} options={{ ...props.options, rows: '10' }} />;
    }
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.topic_engine_gap', Card, width: 'two_thirds' }), {
      searchParams: 'engine=chatgpt_web',
      onUrlUpdate: ({ queryString }) => {
        updates.push(queryString);
      },
    });
    const title = await screen.findByRole('heading', { name: 'Needs two engines' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('button'), ...box.queryAllByRole('link')]).toHaveLength(1);
    await user.click(box.getByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('engine=');
  });

  it('no topic with two engines is its own empty state', async () => {
    render({ summary: summaryOf({ topics: [row('t1', 'SEO tools', 6, { chatgpt_web: [8, 10] })] }) });
    const title = await screen.findByRole('heading', { name: 'No topic can be compared yet' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web'] }) });
    expect(await screen.findByRole('heading', { name: 'No topics yet' })).toBeInTheDocument();
  });

  it('no valid answers names the engines and the days', async () => {
    render({
      summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, { chatgpt_web: [0, 0], gemini_web: [0, 0] })] }),
    });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT and Gemini' }),
    ).toBeInTheDocument();
  });

  it('the overlap footnote', async () => {
    render();
    const frame = await frameOf();
    await plotOf();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
    expect(within(frame).getByText(/Only the most specific topics are compared/)).toBeInTheDocument();
  });

  it('a row links to the drawer', async () => {
    render();
    const link = within((await itemsOf())[0] as HTMLElement).getByRole('link');
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('inspect')).toBe('topic:t2');
  });

  it('the Table form has a column per engine with counts, the spread and the verdict', async () => {
    const { user } = render();
    await plotOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Topic', 'ChatGPT', 'Gemini', 'Spread', 'Reading']);
    const email = within(grid).getByRole('row', { name: /^Email/ });
    expect(
      within(email)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      '50.0%, 40 of 80 answers, 39% to 61%, 8 prompts, each counts once',
      '8.0%, 4 of 50 answers, 3% to 19%, 8 prompts, each counts once',
      '42 points',
      'detectable difference',
    ]);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await plotOf();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the rows are links and Tab visits them in order', async () => {
    const { user } = render();
    const links = within(await plotOf()).getAllByRole('link');
    for (let press = 0; press < 12 && document.activeElement !== links[0]; press += 1) await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
  });
});

describe('TopicEngineGapCard states', () => {
  it('loading is the skeleton at the frame height, with no list', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await release.promise;
        return HttpResponse.json({ data: SUMMARY });
      }),
      ...vocabularyHandlers(TERMS),
    );
    renderCard({});
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[style*="height: 240px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /^Engine range of topics/ })).not.toBeInTheDocument();
    release.open();
    await plotOf();
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = render({ summary: () => (calls++ === 0 ? failing() : SUMMARY) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_gap/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await itemsOf()).toHaveLength(5);
  });

  it('refetching keeps the rows and shows the refetch bar', async () => {
    const { queryClient } = render();
    await plotOf();
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await release.promise;
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    act(() => {
      void queryClient.invalidateQueries();
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(await itemsOf()).toHaveLength(5);
    release.open();
  });

  it('a failed refresh keeps the rows and says these are the last figures', async () => {
    const { queryClient } = render();
    await plotOf();
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await itemsOf()).toHaveLength(5);
  });

  it('partial names an engine that has no valid answer in any topic', async () => {
    render({ searchParams: '', threeEngines: true });
    await plotOf();
    expect(screen.getByText('Partial data: AI Mode has no valid answer in this window')).toBeInTheDocument();
  });
});

describe('TopicEngineGapCard export block', () => {
  it('registers a block under the item id, with an empty cell and a status for an unknown, never 0', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicEngineGapCard {...props} options={{ ...props.options, rows: '10' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(
      summaryHandler(
        summaryOf({
          topics: [row('t1', 'Mixed', 6, { chatgpt_web: [8, 10], gemini_web: [2, 10], google_ai_mode: [1, 3] })],
        }),
      ),
      ...vocabularyHandlers(TERMS),
      THREE_ENGINES,
    );
    renderWithProviders(cardInOverview({ type: 'ai.topic_engine_gap', Card, width: 'two_thirds' }));
    await plotOf();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'topic',
      'chatgpt_web_rate_percent',
      'chatgpt_web_answers',
      'chatgpt_web_status',
      'gemini_web_rate_percent',
      'gemini_web_answers',
      'gemini_web_status',
      'google_ai_mode_rate_percent',
      'google_ai_mode_answers',
      'google_ai_mode_status',
      'spread_points',
      'reading',
    ]);
    expect(block?.rows).toEqual([['Mixed', 80, 10, 'ok', 20, 10, 'ok', null, 3, 'insufficient', 60, 'too_few']]);
  });
});
