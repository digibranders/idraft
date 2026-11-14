import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import { Suspense, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TopicExtremesCard from './topic-extremes-card';
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
import { OverviewProvider } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { PromptsSummary } from '@/lib/api/types';
import { PermissionProvider } from '@/lib/permissions';
import { membershipFactory } from '@/mocks/factories/identity';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { CARD_ID, cardInOverview, overviewProject, type OverviewWorld } from '@/test/ai-overview-harness';
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
const TITLE = 'Strongest and weakest topics';

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

// ChatGPT ranks SEO tools, Email, CRM and Pricing (Support has 2 prompts, Reports no answer).
// Gemini ranks SEO tools, Email and CRM (Pricing has 3 answers).
const SUMMARY: PromptsSummary = summaryOf({
  topics: [
    row('t1', 'SEO tools', 12, { chatgpt_web: [64, 136], gemini_web: [30, 100] }),
    row('t2', 'Email', 8, { chatgpt_web: [40, 80], gemini_web: [4, 50] }),
    row('t3', 'CRM', 6, { chatgpt_web: [10, 60], gemini_web: [28, 56] }),
    row('t4', 'Pricing', 5, { chatgpt_web: [2, 40], gemini_web: [3, 3] }),
    row('t5', 'Support', 2, { chatgpt_web: [9, 10], gemini_web: [5, 10] }),
    row('t6', 'Reports', 4, { chatgpt_web: [0, 0], gemini_web: [0, 0] }),
  ],
  prompts: [
    promptRow('p1', 'best seo tools', ['t1', 't2'], [engineCells('chatgpt_web', { mentioned: [3, 4] })]),
    promptRow('p2', 'best crm', ['t3'], [engineCells('chatgpt_web', { mentioned: [1, 4] })]),
  ],
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
  world?: OverviewWorld;
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
  world = 'fynix',
  threeEngines = false,
  vocabularies,
}: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (vocabularies !== undefined) server.use(heldVocabularies(vocabularies));
  if (threeEngines) server.use(THREE_ENGINES);
  return renderCard({ options, searchParams, world });
}

function renderCard({ options = {}, searchParams = TWO_ENGINES, world = 'fynix' }: Setup) {
  function Card(props: CardProps): ReactElement {
    return <TopicExtremesCard {...props} options={{ ...props.options, rows: '2', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_extremes', Card, width: 'half', world }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
/** The list of one group of one engine, by the name the card gives it. */
const listOf = (group: 'Strongest' | 'Weakest', engine: string): Promise<HTMLElement> =>
  screen.findByRole('list', { name: new RegExp(`^${group} topics on ${engine}`) });
const labelsOf = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('listitem')
    .map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent ?? '');

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_extremes' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicExtremesCard', () => {
  it('one section per asked engine', async () => {
    render();
    await frameOf();
    expect(await screen.findByRole('heading', { level: 3, name: 'ChatGPT' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Gemini' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'AI Mode' })).not.toBeInTheDocument();
  });

  it('two lists side by side with the count of rows asked', async () => {
    const { container } = render();
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toEqual(['Email', 'SEO tools']);
    expect(labelsOf(await listOf('Weakest', 'ChatGPT'))).toEqual(['Pricing', 'CRM']);
    expect(labelsOf(await listOf('Strongest', 'Gemini'))).toEqual(['CRM', 'SEO tools']);
    expect(labelsOf(await listOf('Weakest', 'Gemini'))).toEqual(['Email']);
    // Side by side from the container's `@lg` width, stacked below it
    expect(container.querySelector('[class*="@lg:grid-cols-2"]')).not.toBeNull();
  });

  it('rows 3 asks for three topics in each list', async () => {
    render({ options: { rows: '3' } });
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toEqual(['Email', 'SEO tools', 'CRM']);
    // Four topics are ranked on ChatGPT: the weakest list takes the one the strongest left
    expect(labelsOf(await listOf('Weakest', 'ChatGPT'))).toEqual(['Pricing']);
  });

  it('the too few answers count is in the footnote', async () => {
    render();
    const frame = await frameOf();
    await listOf('Strongest', 'ChatGPT');
    expect(within(frame).getByText(/ChatGPT: 2 topics have too few answers or prompts/)).toBeInTheDocument();
    expect(within(frame).getByText(/Gemini: 3 topics have too few answers or prompts/)).toBeInTheDocument();
  });

  it('every bar has k of n answers and prompts', async () => {
    render();
    const list = await listOf('Strongest', 'ChatGPT');
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/Email: 50\.0%, 40 of 80 answers.*8 prompts/);
    expect(items[1]).toHaveTextContent(/SEO tools: 47\.1%, 64 of 136 answers.*12 prompts/);
    for (const item of items) {
      expect(item).toHaveTextContent(/\d+ of \d+ answers/);
      expect(item).toHaveTextContent(/\d+ prompts?/);
    }
  });

  it('a row links to the topic drawer on that engine', async () => {
    render();
    const list = await listOf('Strongest', 'Gemini');
    const link = within(list).getAllByRole('link')[0];
    const url = new URL(link?.getAttribute('href') ?? '', 'http://localhost');
    expect(url.searchParams.get('inspect')).toBe('topic:t3');
    expect(url.searchParams.get('itab')).toBe('prompts');
    expect(url.searchParams.get('eng')).toBe('gemini_web');
  });

  it('an engine with no eligible topic says why', async () => {
    render({ searchParams: 'engine=chatgpt_web,google_ai_mode', threeEngines: true });
    expect(
      await screen.findByText(/AI Mode has no topic with at least 4 valid answers and 3 prompts/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /topics on AI Mode/ })).not.toBeInTheDocument();
    // ChatGPT still shows its lists
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toHaveLength(2);
  });

  it('says so when no ranked topic is above 0%', async () => {
    render({
      searchParams: 'engine=chatgpt_web',
      summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, { chatgpt_web: [0, 10] })] }),
    });
    expect(await screen.findByText('No ranked topic is above 0% on ChatGPT.')).toBeInTheDocument();
    expect(labelsOf(await listOf('Weakest', 'ChatGPT'))).toEqual(['SEO tools']);
    expect(screen.queryByRole('list', { name: /^Strongest topics/ })).not.toBeInTheDocument();
  });

  it('says so when the strongest list took every ranked topic', async () => {
    render({
      searchParams: 'engine=chatgpt_web',
      summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, { chatgpt_web: [5, 10] })] }),
    });
    expect(await screen.findByText('Every ranked topic is already in the strongest list.')).toBeInTheDocument();
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toEqual(['SEO tools']);
    expect(screen.queryByRole('list', { name: /^Weakest topics/ })).not.toBeInTheDocument();
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the lists', async () => {
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
    expect(screen.queryByRole('list', { name: /topics on ChatGPT/ })).not.toBeInTheDocument();
    release.open();
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toHaveLength(2);
  });

  it('the overlap footnote', async () => {
    render();
    const frame = await frameOf();
    await listOf('Strongest', 'ChatGPT');
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
    expect(within(frame).getByText(/Only the most specific topics are ranked/)).toBeInTheDocument();
  });

  it('metric share of voice says answers that name a brand', async () => {
    render({ options: { metric: 'share_of_voice' } });
    const list = await listOf('Strongest', 'ChatGPT');
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(/valid answers name a tracked brand/);
    expect(within(list).getAllByRole('listitem')[0]).not.toHaveTextContent(/40 of 80 answers/);
  });

  it('the Table form lists every ranked topic with its engine and counts', async () => {
    const { user } = render();
    await listOf('Strongest', 'ChatGPT');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Engine', 'Group', 'Topic', 'Value']);
    expect(
      within(grid).getByRole('row', { name: /ChatGPT Strongest Email 50\.0%, 40 of 80 answers/ }),
    ).toBeInTheDocument();
    expect(within(grid).getAllByRole('row')).toHaveLength(1 + 2 + 2 + 2 + 1);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await listOf('Strongest', 'ChatGPT');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the rows are links and Tab visits them in order', async () => {
    const { user } = render();
    const list = await listOf('Strongest', 'ChatGPT');
    const links = within(list).getAllByRole('link');
    for (let press = 0; press < 12 && document.activeElement !== links[0]; press += 1) await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
  });
});

describe('TopicExtremesCard states', () => {
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
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    release.open();
    await listOf('Strongest', 'ChatGPT');
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
            <TopicExtremesCard
              item={{ id: CARD_ID, type: 'ai.topic_extremes', width: 'half', options: {} }}
              options={{ metric: 'mention', rows: '5' }}
              width="half"
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

  it('no valid answers names the engine and has one action', async () => {
    render({
      searchParams: 'engine=chatgpt_web',
      summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, { chatgpt_web: [0, 0] })] }),
    });
    const title = await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getAllByRole('link')).toHaveLength(1);
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = render({ summary: () => (calls++ === 0 ? failing() : SUMMARY) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_extremes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(labelsOf(await listOf('Strongest', 'ChatGPT'))).toHaveLength(2);
  });

  it('refetching keeps the lists and shows the refetch bar', async () => {
    const { queryClient } = render();
    await listOf('Strongest', 'ChatGPT');
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
    expect(screen.getByRole('list', { name: /^Strongest topics on ChatGPT/ })).toBeInTheDocument();
    release.open();
  });

  it('a failed refresh keeps the lists and says these are the last figures', async () => {
    const { queryClient } = render();
    await listOf('Strongest', 'ChatGPT');
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /^Strongest topics on ChatGPT/ })).toBeInTheDocument();
  });

  it('partial names an engine that has no valid answer in any topic', async () => {
    render({ searchParams: 'engine=chatgpt_web,google_ai_mode', threeEngines: true });
    await listOf('Strongest', 'ChatGPT');
    expect(screen.getByText('Partial data: AI Mode has no valid answer in this window')).toBeInTheDocument();
  });
});

describe('TopicExtremesCard export block', () => {
  function renderExporting(): () => ExportRead {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicExtremesCard {...props} options={{ ...props.options, rows: '2' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.topic_extremes', Card, width: 'half' }), {
      searchParams: TWO_ENGINES,
    });
    return () => reader();
  }

  it('registers a block under the item id, with an empty cell and a status for an unknown, never 0', async () => {
    const read = renderExporting();
    await listOf('Strongest', 'ChatGPT');
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['engine', 'group', 'topic', 'rate_percent', 'answers', 'prompts', 'status']);
    const rows = block?.rows ?? [];
    expect(rows).toContainEqual(['chatgpt_web', 'strongest', 'Email', 50, 80, 8, 'ok']);
    // Pricing on Gemini has 3 answers: no rate, the answers, and the reason in the status
    expect(rows).toContainEqual(['gemini_web', 'not_ranked', 'Pricing', null, 3, 5, 'insufficient']);
    // Reports has no answer at all
    expect(rows).toContainEqual(['gemini_web', 'not_ranked', 'Reports', null, 0, 4, 'no_answers']);
    expect(rows.filter((entry) => entry[3] === 0)).toEqual([]);
  });
});
