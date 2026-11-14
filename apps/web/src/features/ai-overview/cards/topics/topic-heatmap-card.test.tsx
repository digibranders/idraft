import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, promptRow, summaryOf, summaryHandler, topicRow, vocabularyHandlers } from './topic-card-test-kit';
import TopicHeatmapCard from './topic-heatmap-card';
import messages from '../../../../../messages/en.json';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import { ENGINE_PARAM, parseEngineParam, parseView } from '@/features/prompts/topics-by-engine/drill';
import { parseMetric, parseTab } from '@/features/prompts/prompt-model';
import type { PromptsSummary } from '@/lib/api/types';
import { parseInspectTarget } from '@/lib/inspector/placement';
import { setAiSeeded } from '@/mocks/ai-seed';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview, type OverviewWorld } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

const SUMMARY_ROUTE = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setAiSeeded(false);
});

const CRM = '11111111-1111-4111-8111-111111111111';
const PRICING = '22222222-2222-4222-8222-222222222222';
const SECURITY = '33333333-3333-4333-8333-333333333333';
const SUPPORT = '44444444-4444-4444-8444-444444444444';

const TERMS = [
  { id: CRM, name: 'CRM', parent: null },
  { id: PRICING, name: 'Pricing', parent: CRM },
  { id: SECURITY, name: 'Security', parent: null },
  { id: SUPPORT, name: 'Support', parent: null },
];

/**
 * Fynix asks ChatGPT and Gemini. Counts are `[k, n]` of valid answers; a topic cell weights prompts. CRM on ChatGPT is
 * the 47% of 136 answers over 17 prompts; Support on ChatGPT has 3 answers; the prompts without a topic have none.
 */
const TOPICS = [
  topicRow(CRM, 'CRM', 17, [
    engineCells('chatgpt_web', { mentioned: [64, 136], cited: [20, 136], sov: [30, 80], prompts: 17 }),
    engineCells('gemini_web', { mentioned: [30, 100], cited: [10, 100], sov: [10, 60], prompts: 17 }),
  ]),
  topicRow(PRICING, 'Pricing', 6, [
    engineCells('chatgpt_web', { mentioned: [0, 0], cited: [0, 0], sov: [0, 0], prompts: 6 }),
    engineCells('gemini_web', { mentioned: [12, 40], cited: [4, 40], sov: [5, 30], prompts: 6 }),
  ]),
  topicRow(SECURITY, 'Security', 9, [
    engineCells('chatgpt_web', { mentioned: [8, 10], cited: [3, 10], sov: [4, 9], prompts: 9 }),
    engineCells('gemini_web', { mentioned: [18, 50], cited: [9, 50], sov: [6, 40], prompts: 9 }),
  ]),
  topicRow(SUPPORT, 'Support', 4, [
    engineCells('chatgpt_web', { mentioned: [2, 3], cited: [1, 3], sov: [1, 3], prompts: 4 }),
    engineCells('gemini_web', { mentioned: [8, 20], cited: [2, 20], sov: [3, 15], prompts: 4 }),
  ]),
  topicRow(null, null, 3, [
    engineCells('chatgpt_web', { mentioned: [0, 0], cited: [0, 0], sov: [0, 0], prompts: 3 }),
    engineCells('gemini_web', { mentioned: [4, 10], cited: [1, 10], sov: [2, 8], prompts: 3 }),
  ]),
];
/** One prompt is in two top level topics, one has no topic: the footnote says 1 prompt is in more than one. */
const PROMPTS = [
  promptRow('p1', 'Best CRM for startups', [CRM], []),
  promptRow('p2', 'CRM with support', [CRM, SUPPORT], []),
  promptRow('p3', 'Is it secure', [SECURITY], []),
  promptRow('p4', 'Something else', [], []),
];
const SUMMARY: PromptsSummary = summaryOf({ topics: TOPICS, prompts: PROMPTS });

interface Setup {
  summary?: PromptsSummary;
  options?: Readonly<Record<string, string>>;
  searchParams?: string;
  world?: OverviewWorld;
}

function render({ summary = SUMMARY, options = {}, searchParams = '', world = 'fynix' }: Setup = {}) {
  server.use(...vocabularyHandlers(TERMS), summaryHandler(summary));
  function Card(props: CardProps): ReactElement {
    return <TopicHeatmapCard {...props} options={{ ...props.options, ...options }} />;
  }
  return renderWithProviders(
    cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds', world }),
    {
      searchParams,
    },
  );
}

const TITLE = 'Mention rate by topic and engine';
const frame = async (title = TITLE): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: title });
  const section = heading.closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
/** The grid with its rows, once the rows are drawn. */
const grid = async (): Promise<HTMLElement> =>
  waitFor(() => {
    // The role is treegrid while a row has rows under it, and grid otherwise
    const found = document.querySelector<HTMLElement>('table[role="grid"], table[role="treegrid"]');
    if (found === null || within(found).queryAllByRole('rowheader').length === 0) throw new Error('no grid yet');
    return found;
  });
const rowNames = async (): Promise<string[]> =>
  within(await grid())
    .getAllByRole('rowheader')
    .map((header) => header.getAttribute('aria-label') ?? '');
const headers = async (): Promise<string[]> =>
  within(await grid())
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
const cell = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('gridcell', { name });
const link = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('link', { name });
const queryOf = (href: string | null): URLSearchParams => new URL(href ?? '', 'http://localhost').searchParams;

describe('the grid', () => {
  it('renders a row per top level topic and a column per asked engine, then avg of 2 from two engines', async () => {
    render();
    expect(await rowNames()).toEqual(['CRM', 'Security', 'Support', 'Prompts without a topic']);
    expect(await headers()).toEqual(['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'avg of 2']);
    // The prompts column is the count of each topic
    const crm = within(await grid())
      .getByRole('rowheader', { name: 'CRM' })
      .closest('tr');
    expect(within(crm as HTMLElement).getByText('17')).toBeInTheDocument();
  });

  it('one asked engine has no average column', async () => {
    render({ searchParams: 'engine=chatgpt_web' });
    expect(await headers()).toEqual(['Topic', 'Prompts', 'ChatGPT']);
    expect(screen.queryByRole('columnheader', { name: /avg of/ })).not.toBeInTheDocument();
  });

  it('an engine outside the engine filter is not a column', async () => {
    render({ searchParams: 'engine=gemini_web' });
    expect(await headers()).toEqual(['Topic', 'Prompts', 'Gemini']);
    expect(screen.queryByRole('columnheader', { name: 'ChatGPT' })).not.toBeInTheDocument();
  });

  it('a cell under 4 answers is hatched, says 3 ans and prints no percent', async () => {
    render();
    const thin = await link(/^Support on ChatGPT/);
    const td = thin.closest('td');
    expect(td).toHaveClass('bg-insufficient');
    expect(td).toHaveTextContent('3 ans');
    expect(td?.textContent).not.toContain('%');
    // The name of the cell carries the answers and no percent either
    expect(thin.getAttribute('aria-label')).not.toContain('%');
    expect(thin.getAttribute('aria-label')).toContain('3 answers');
  });

  it('a cell with no answers says n/a and never 0%', async () => {
    render();
    const none = await cell(/^Prompts without a topic on ChatGPT/);
    expect(none).toHaveTextContent('n/a');
    expect(none.textContent).not.toContain('0%');
    expect(none).not.toHaveClass('bg-insufficient');
    // No answer has no prompts to open: it is no link
    expect(within(none).queryByRole('link')).not.toBeInTheDocument();
  });

  it('every cell tip has k of n answers and the prompts (R1)', async () => {
    render();
    await grid();
    const expected: [RegExp, RegExp][] = [
      [/^CRM on ChatGPT/, /47\.1%, 64 of 136 answers.*17 prompts/],
      [/^CRM on Gemini/, /30\.0%, 30 of 100 answers.*17 prompts/],
      [/^Security on ChatGPT/, /80\.0%, 8 of 10 answers.*9 prompts/],
      [/^Security on Gemini/, /36\.0%, 18 of 50 answers.*9 prompts/],
      [/^Support on Gemini/, /40\.0%, 8 of 20 answers.*4 prompts/],
      [/^Prompts without a topic on Gemini/, /40\.0%, 4 of 10 answers.*3 prompts/],
    ];
    for (const [name, words] of expected) {
      expect((await link(name)).getAttribute('aria-label')).toMatch(words);
    }
  });

  it('share of voice tip says answers that name a brand', async () => {
    render({ options: { metric: 'share_of_voice' } });
    await frame('Share of voice by topic and engine');
    const crm = await link(/^CRM on ChatGPT/);
    expect(crm.getAttribute('aria-label')).toMatch(/80 valid answers name a tracked brand/);
    expect(crm.getAttribute('aria-label')).toMatch(/17 prompts/);
    expect(crm.getAttribute('aria-label')).not.toMatch(/ of 80 answers/);
  });

  it('the average cell says how many engines took part and names them', async () => {
    render();
    const crm = await cell(/^CRM, avg of 2/);
    expect(crm.getAttribute('aria-label')).toMatch(/64 of 136 answers/);
    expect(crm.getAttribute('aria-label')).toMatch(/Equal weight average of ChatGPT and Gemini/);
    expect(crm).toHaveTextContent('39%');
    // One engine has a rate: it is that engine only, never an average of two
    const support = await cell(/^Support, 1 engine/);
    expect(support.getAttribute('aria-label')).toMatch(/Gemini only/);
  });

  it('level all opens a topic in place and top shows no chevron', async () => {
    const top = render();
    await grid();
    expect(screen.queryByRole('button', { name: /^Expand/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Pricing' })).not.toBeInTheDocument();
    top.unmount();

    const all = render({ options: { level: 'all' } });
    const expand = await screen.findByRole('button', { name: 'Expand CRM' });
    expect(screen.queryByRole('rowheader', { name: 'Pricing' })).not.toBeInTheDocument();
    await all.user.click(expand);
    expect(await screen.findByRole('rowheader', { name: 'Pricing' })).toBeInTheDocument();
    expect(await rowNames()).toEqual(['CRM', 'Pricing', 'Security', 'Support', 'Prompts without a topic']);
  });

  it('a topic filter in the scope narrows the rows to that topic and the ones below', async () => {
    render({ searchParams: `topic=${CRM}`, options: { level: 'all' } });
    expect(await rowNames()).toEqual(['CRM']);
    await userOpens('Expand CRM');
    expect(await rowNames()).toEqual(['CRM', 'Pricing']);
  });
});

/** Opens a row of the grid the way a person does. */
async function userOpens(label: string): Promise<void> {
  const button = await screen.findByRole('button', { name: label });
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe('the cut', () => {
  it('rows cuts to N topics and Show all names the total and keeps metric and sort in the link', async () => {
    render({ options: { rows: '2', metric: 'share_of_voice', sort: 'rate' } });
    await frame('Share of voice by topic and engine');
    // Security 58%, Support 40% (one engine), CRM 39%, then the prompts without a topic
    const names = await rowNames();
    expect(names).toHaveLength(2);
    const all = await screen.findByRole('link', { name: 'Show all 4 topics' });
    const query = queryOf(all.getAttribute('href'));
    expect(query.get('view')).toBe('heatmap');
    expect(parseView(query.get('view'))).toBe('heatmap');
    expect(parseMetric(query.get('metric'))).toBe('sov');
    expect(query.get('sort')).toBe('avg_rate');
    expect(parseTab(query.get('tab'))).toBe('topics');
  });

  it('shows no Show all link when every topic is shown', async () => {
    render();
    await grid();
    expect(screen.queryByRole('link', { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it('the Show all link is plain text away when the scope holds an engine that is off', async () => {
    render({ options: { rows: '2' }, searchParams: 'engine=chatgpt_web,google_ai_mode' });
    await grid();
    expect(screen.queryByRole('link', { name: /^Show all/ })).not.toBeInTheDocument();
  });
});

describe('the order', () => {
  it('sort by prompts, rate and gap orders the rows and the no topic row stays last', async () => {
    // Prompts: CRM 17, Security 9, Support 4. Average rate: Security 58%, Support 40%, CRM 39%, no topic 40% (last).
    // Gap: Security 44 points, CRM 17, Support has no gap, the no topic row stays last whatever its figures.
    const expected = {
      prompts: ['CRM', 'Security', 'Support', 'Prompts without a topic'],
      rate: ['Security', 'Support', 'CRM', 'Prompts without a topic'],
      gap: ['Security', 'CRM', 'Support', 'Prompts without a topic'],
    };
    for (const [sort, names] of Object.entries(expected)) {
      const view = render({ options: { sort } });
      expect(await rowNames()).toEqual(names);
      view.unmount();
    }
  });
});

describe('where a cell and a row lead', () => {
  it('a cell links to the topic drawer Prompts tab with eng, and the topic name links to the drawer Overview', async () => {
    render();
    const crm = await link(/^CRM on Gemini/);
    const query = queryOf(crm.getAttribute('href'));
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'topic', id: CRM });
    expect(query.get('itab')).toBe('prompts');
    expect(parseEngineParam(query.get(ENGINE_PARAM), ['chatgpt_web', 'gemini_web'])).toBe('gemini_web');

    const name = within(await grid()).getByRole('link', { name: 'CRM' });
    const drawer = queryOf(name.getAttribute('href'));
    expect(parseInspectTarget(drawer.get('inspect'))).toEqual({ type: 'topic', id: CRM });
    expect(drawer.get('itab')).toBeNull();
    expect(drawer.get('eng')).toBeNull();
  });

  it('the prompts without a topic open the drawer of the no topic row', async () => {
    render();
    const query = queryOf((await link(/^Prompts without a topic on Gemini/)).getAttribute('href'));
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'topic', id: '__none' });
  });

  it('a row name is plain text when the page cannot show the scope', async () => {
    // A window of 92 days is longer than the Prompts page reads: no link, the number stays text
    render({ searchParams: 'from=2026-08-13&to=2026-11-12' });
    await grid();
    expect(within(await grid()).queryAllByRole('link')).toHaveLength(0);
  });

  it('follows the link of a linked cell on Enter, and arrow keys move between cells', async () => {
    const { user } = render();
    const crmHeader = within(await grid()).getByRole('rowheader', { name: 'CRM' });
    crmHeader.focus();
    // Row header, then Prompts, then the first engine
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const chatgpt = await link(/^CRM on ChatGPT/);
    expect(chatgpt).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(await link(/^CRM on Gemini/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(await link(/^Security on Gemini/)).toHaveFocus();
    const followed = vi.fn((event: Event) => event.preventDefault());
    (await link(/^Security on Gemini/)).addEventListener('click', followed);
    await user.keyboard('{Enter}');
    expect(followed).toHaveBeenCalledOnce();
  });
});

describe('words', () => {
  it('has the title, the meta line with the topics, engines, prompts and the window', async () => {
    render();
    const section = await frame();
    await grid();
    expect(
      within(section).getByText('4 topics, 2 engines, 4 prompts, Oct 16 to Nov 12, 2026, 28 days'),
    ).toBeInTheDocument();
  });

  it('the footnote names the bins, the prompt weighting, the average rule and that topics overlap', async () => {
    render();
    const section = await frame();
    await grid();
    const note = section.querySelector('[data-slot="chart-footnote"]');
    const text = note?.textContent ?? section.textContent;
    for (const bin of ['seq1', 'seq2', 'seq3', 'seq4', 'seq5', 'seq6', 'seq7'] as const) {
      expect(text).toContain(messages.chart.heatmap.bins[bin]);
    }
    expect(text).toContain('Prompt weighted: each prompt counts once.');
    expect(text).toMatch(/average column gives each engine that shows a rate the same weight/);
    expect(text).toContain('Topics overlap: a prompt in two topics counts in both');
    expect(text).toContain('1 prompt is in more than one topic.');
    expect(text).toContain('A rate under 4 valid answers shows its answer count and no percent.');
  });

  it('the Table form prints each cell words', async () => {
    const { user } = render();
    await grid();
    const words = (await link(/^CRM on ChatGPT/)).getAttribute('aria-label') ?? '';
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.getByText(/^Prompts without a topic on ChatGPT: No answers$/)).toBeInTheDocument();
  });
});

describe('the Export menu', () => {
  it('registers its table under the item id, with an empty cell and a status where a rate is unknown', async () => {
    server.use(...vocabularyHandlers(TERMS), summaryHandler(SUMMARY));
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      read = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicHeatmapCard {...props} />
          <Reader />
        </ExportProvider>
      );
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    await grid();
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header.slice(0, 6)).toEqual([
      'topic',
      'level',
      'prompts',
      'chatgpt_web_rate',
      'chatgpt_web_answers',
      'chatgpt_web_status',
    ]);
    const rows = new Map((block?.rows ?? []).map((row) => [row[0], row]));
    expect(rows.get('CRM')?.slice(3, 6)).toEqual([47.06, 136, 'ok']);
    expect(rows.get('Support')?.slice(3, 6)).toEqual([null, 3, 'insufficient']);
    expect(rows.get('Prompts without a topic')?.slice(3, 6)).toEqual([null, 0, 'no_answers']);
  });
});

describe('what the card asks', () => {
  it('asks the summary once with no include and no rows', async () => {
    const asked: URL[] = [];
    const listener = ({ request }: { request: Request }): void => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary')) asked.push(url);
    };
    server.events.on('request:start', listener);
    render();
    await grid();
    server.events.removeListener('request:start', listener);
    expect(asked).toHaveLength(1);
    for (const key of ['include', 'rows', 'compare']) expect(asked[0]?.searchParams.has(key)).toBe(false);
  });
});

describe('states', () => {
  it('loading is the frame skeleton at the card height', async () => {
    const release = gate();
    server.use(
      ...vocabularyHandlers(TERMS),
      http.get(SUMMARY_ROUTE, async () => {
        await release.promise;
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    function Card(props: CardProps): ReactElement {
      return <TopicHeatmapCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const section = await frame('Mention rate by topic and engine');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelector('[style*="height: 280px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    release.open();
    await grid();
  });

  it('no engine asked says so and offers Use all engines', async () => {
    render({ searchParams: 'engine=google_ai_mode' });
    expect(await screen.findByText('No engine is part of this view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use all engines' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('no topics teaches how to get some, with one action', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }) });
    const state = (await screen.findByRole('heading', { name: 'No topics yet' })).closest('[data-slot="empty-state"]');
    const box = within(state as HTMLElement);
    expect(box.getByText(/Group prompts into topics/)).toBeInTheDocument();
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no valid answers names the engines and the days', async () => {
    const silent = summaryOf({
      topics: [
        topicRow(CRM, 'CRM', 5, [
          engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 5 }),
          engineCells('gemini_web', { mentioned: [0, 0], prompts: 5 }),
        ]),
      ],
      prompts: [],
    });
    render({ summary: silent });
    const title = await screen.findByRole('heading', {
      name: 'No valid answers in these 28 days on ChatGPT and Gemini',
    });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('error shows the card title and the request id, and Retry reads again', async () => {
    let calls = 0;
    server.use(
      ...vocabularyHandlers(TERMS),
      http.get(SUMMARY_ROUTE, () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Internal error',
              status: 500,
              code: 'internal_error',
              request_id: 'req_heat_1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    function Card(props: CardProps): ReactElement {
      return <TopicHeatmapCard {...props} />;
    }
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    expect(await screen.findByText('Mention rate by topic and engine could not be read')).toBeInTheDocument();
    expect(screen.getByText(/req_heat_1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(await rowNames()).toContain('CRM');
  });

  it('refetching keeps the grid', async () => {
    const { queryClient } = render();
    await grid();
    const release = gate();
    server.use(
      http.get(SUMMARY_ROUTE, async () => {
        await release.promise;
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    void queryClient.invalidateQueries();
    const section = await frame();
    await waitFor(() => {
      expect(section.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(await rowNames()).toContain('CRM');
    release.open();
    await waitFor(() => {
      expect(section.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });

  it('stale says these are the last figures read and keeps the grid', async () => {
    const { queryClient } = render();
    await grid();
    server.use(
      http.get(SUMMARY_ROUTE, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'internal_error',
            request_id: 'req_heat_2',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    void queryClient.invalidateQueries();
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await rowNames()).toContain('CRM');
  });

  it('partial names an engine without a valid answer in any row', async () => {
    const onlyGemini = summaryOf({
      topics: [
        topicRow(CRM, 'CRM', 5, [
          engineCells('chatgpt_web', { mentioned: [0, 0], prompts: 5 }),
          engineCells('gemini_web', { mentioned: [9, 10], prompts: 5 }),
        ]),
      ],
      prompts: [],
    });
    render({ summary: onlyGemini });
    expect(await screen.findByText('Partial data: ChatGPT has no valid answer in this window')).toBeInTheDocument();
    expect(await rowNames()).toEqual(['CRM']);
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the grid', async () => {
    const release = gate();
    let served = false;
    server.use(
      ...vocabularyHandlers(TERMS),
      summaryHandler(() => {
        served = true;
        return SUMMARY;
      }),
    );
    // Added last so it matches first: held until released, then falls through to the served vocabularies
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/vocabularies'), async () => {
        await release.promise;
        return undefined;
      }),
    );
    function Card(props: CardProps): ReactElement {
      return <TopicHeatmapCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const section = await frame();
    await waitFor(() => {
      expect(served).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.queryByRole('treegrid')).not.toBeInTheDocument();
    release.open();
    expect(await rowNames()).toEqual(['CRM', 'Security', 'Support', 'Prompts without a topic']);
  });
});

describe('the whole card', () => {
  it('axe has no violations in the grid, the Table form and the opened levels', async () => {
    const { container, user } = render({ options: { level: 'all' } });
    await grid();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByText(/^CRM on ChatGPT/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Eventus: the seeded project draws its grid and every percent has its answers', async () => {
    setAiSeeded(true);
    function Card(props: CardProps): ReactElement {
      return <TopicHeatmapCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({
        type: 'ai.topic_heatmap',
        Card: Card as ComponentType<CardProps>,
        width: 'two_thirds',
        world: 'eventus-security',
      }),
    );
    // The mock's Eventus asks ChatGPT and Gemini; the three engine case is in heatmap-model.test.ts
    expect(await headers()).toEqual(['Topic', 'Prompts', 'ChatGPT', 'Gemini', 'avg of 2']);
    const cells = within(await grid()).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(10);
    for (const one of cells) {
      const label = one.getAttribute('aria-label') ?? within(one).queryByRole('link')?.getAttribute('aria-label') ?? '';
      // A prompts count cell has no name of its own; every rate cell does, and no percent stands without answers
      if (one.textContent?.includes('%') === true) expect(label).toMatch(/answers?/);
    }
  });

  it('Fynix smoke: the mock project draws a grid with its own topics', async () => {
    function Card(props: CardProps): ReactElement {
      return <TopicHeatmapCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.topic_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    expect((await rowNames()).length).toBeGreaterThan(0);
    expect(await headers()).toEqual(expect.arrayContaining(['ChatGPT', 'Gemini', 'avg of 2']));
  });
});
