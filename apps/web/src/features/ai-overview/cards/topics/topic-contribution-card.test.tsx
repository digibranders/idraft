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
import TopicContributionCard from './topic-contribution-card';
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
const TITLE = 'What each topic adds';
const PREVIOUS_TO = '2026-10-15';

const TERMS: TermSpec[] = [
  { id: 't1', name: 'SEO tools', parent: null },
  { id: 't2', name: 'Email', parent: null },
];

type Pair = readonly [number, number];
const prompt = (id: string, topics: string[], pair: Pair) =>
  promptRow(id, `prompt ${id}`, topics, [engineCells('chatgpt_web', { mentioned: pair })]);
const topic = (id: string | null, name: string | null, prompts: number) =>
  topicRow(id, name, prompts, [engineCells('chatgpt_web', { mentioned: [1, 2], prompts })]);

// Rates .9 .5 0 .75 over the 4 prompts that have an answer (p4 has none): the mention rate is 53.75%. SEO tools
// adds 35 points, Email 12.5 (p2 is in both, so the bars add up to more than the rate) and p5 has no topic.
const NOW: PromptsSummary = summaryOf({
  topics: [topic('t1', 'SEO tools', 2), topic('t2', 'Email', 3), topic(null, null, 1)],
  prompts: [
    prompt('p1', ['t1'], [9, 10]),
    prompt('p2', ['t1', 't2'], [1, 2]),
    prompt('p3', ['t2'], [0, 4]),
    prompt('p4', ['t2'], [0, 0]),
    prompt('p5', [], [3, 4]),
  ],
});
// The window before: p1 .5, p2 .5, p3 .5 and p7 (no longer there). Now adds p6 (4 of 4).
const NOW_CHANGE: PromptsSummary = summaryOf({
  topics: [topic('t1', 'SEO tools', 3), topic('t2', 'Email', 2)],
  prompts: [
    prompt('p1', ['t1'], [9, 10]),
    prompt('p2', ['t1', 't2'], [1, 2]),
    prompt('p3', ['t2'], [0, 4]),
    prompt('p6', ['t1'], [4, 4]),
  ],
});
const BEFORE_CHANGE: PromptsSummary = summaryOf({
  topics: [topic('t1', 'SEO tools', 3), topic('t2', 'Email', 2)],
  prompts: [
    prompt('p1', ['t1'], [5, 10]),
    prompt('p2', ['t1', 't2'], [1, 2]),
    prompt('p3', ['t2'], [2, 4]),
    prompt('p7', ['t1'], [4, 4]),
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

function renderCard({
  options = {},
  searchParams = ONE_ENGINE,
  summary = periods(NOW, NOW),
  vocabularies,
}: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (vocabularies !== undefined) server.use(vocabularies);
  function Card(props: CardProps): ReactElement {
    return <TopicContributionCard {...props} options={{ ...props.options, engine: 'chatgpt_web', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const CHANGE = { view: 'change' };
const changePeriods = periods(NOW_CHANGE, BEFORE_CHANGE);

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const listOf = (): Promise<HTMLElement> => screen.findByRole('list', { name: /^What each topic add(s|ed)/ });
const itemsOf = async (): Promise<HTMLElement[]> => within(await listOf()).getAllByRole('listitem');
const labelOf = (item: HTMLElement): string => item.querySelector('[data-slot="bar-list-label"]')?.textContent ?? '';

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_share' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('TopicContributionCard level view', () => {
  it('a bar per top level topic with points and prompts', async () => {
    renderCard();
    const items = await itemsOf();
    expect(items.map(labelOf)).toEqual(['SEO tools', 'Email', 'Prompts without a topic']);
    expect(items[0]).toHaveTextContent('SEO tools: 35.0 points of the 53.8%, 2 prompts');
    expect(items[1]).toHaveTextContent('Email: 12.5 points of the 53.8%, 2 prompts');
    expect(items[2]).toHaveTextContent('Prompts without a topic: 18.8 points of the 53.8%, 1 prompt');
  });

  it('the footnote gives the sum and the overlapping prompts', async () => {
    renderCard();
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText(/Bars add up to 66\.[23] points for a rate of 53\.8%/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
  });

  it('a row links to the drawer', async () => {
    renderCard();
    const link = within((await itemsOf())[0] as HTMLElement).getByRole('link');
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('inspect')).toBe('topic:t1');
  });

  it('under 4 valid answers says the answers and draws no bar', async () => {
    renderCard({
      summary: summaryOf({
        topics: [topic('t1', 'SEO tools', 2)],
        prompts: [prompt('p1', ['t1'], [2, 2]), prompt('p2', ['t1'], [0, 1])],
      }),
    });
    expect(await screen.findByText(/ChatGPT has 3 valid answers/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /^What each topic add(s|ed)/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('no valid answers names the engine and the days', async () => {
    renderCard({
      summary: summaryOf({ topics: [topic('t1', 'SEO tools', 1)], prompts: [prompt('p1', ['t1'], [0, 0])] }),
    });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' }),
    ).toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    renderCard({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web'] }) });
    expect(await screen.findByRole('heading', { name: 'No topics yet' })).toBeInTheDocument();
  });

  it('engine outside the filter is an empty state with Use all engines', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(periods(NOW, NOW)), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <TopicContributionCard {...props} options={{ ...props.options, engine: 'gemini_web' }} />;
    }
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
      onUrlUpdate: ({ queryString }) => {
        updates.push(queryString);
      },
    });
    const title = await screen.findByRole('heading', { name: 'Gemini is not part of this view' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('button'), ...box.queryAllByRole('link')]).toHaveLength(1);
    await user.click(box.getByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('engine=');
  });

  it('requests: the window and the one before, no include', async () => {
    const urls: URL[] = [];
    renderCard({
      summary: (url) => {
        urls.push(url);
        return NOW;
      },
    });
    await listOf();
    expect(new Set(urls.map((url) => url.searchParams.get('to')))).toEqual(new Set(['2026-11-12', PREVIOUS_TO]));
    for (const url of urls) expect(url.searchParams.has('include')).toBe(false);
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
    expect(screen.queryByRole('list', { name: /^What each topic add(s|ed)/ })).not.toBeInTheDocument();
    release.open();
    expect(await itemsOf()).toHaveLength(3);
  });

  it('the Table form has the topic, the points and the prompts', async () => {
    const { user } = renderCard();
    await listOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Topic', 'Adds', 'Prompts']);
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

describe('TopicContributionCard change view', () => {
  it('change view bars are neutral and say no test', async () => {
    renderCard({ options: CHANGE, summary: changePeriods });
    const items = await itemsOf();
    expect(items.map(labelOf)).toEqual(['SEO tools', 'Email']);
    expect(items[0]).toHaveTextContent(/SEO tools: \+13\.3 points/);
    expect(items[1]).toHaveTextContent(/Email: .*16\.7 points/);
    const bars = [...document.querySelectorAll('[data-slot="bar-list-bar"]')];
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.className).toContain('bg-chart-bar-neutral');
      expect(bar.className).not.toMatch(/positive|negative/);
    }
    expect(within(await frameOf()).getByText(/no test for this split/i)).toBeInTheDocument();
    // The delta component is not used: nothing here is coloured by a test
    expect(document.querySelector('[class*="text-positive-text"], [class*="text-negative-text"]')).toBeNull();
  });

  it('states the part of the change that comes from prompts added or left, and does not allocate it', async () => {
    renderCard({ options: CHANGE, summary: changePeriods });
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText(/0\.8 points .* prompts added or left/)).toBeInTheDocument();
    expect(within(frame).getByText(/3 prompts in both windows/)).toBeInTheDocument();
  });

  it('change view with compare off is an empty state with an action', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(changePeriods), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <TopicContributionCard {...props} options={{ ...props.options, engine: 'chatgpt_web', view: 'change' }} />;
    }
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
      searchParams: `${ONE_ENGINE}&cmp=off`,
      onUrlUpdate: ({ queryString }) => {
        updates.push(queryString);
      },
    });
    const title = await screen.findByRole('heading', { name: 'Comparison is off' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    await user.click(box.getByRole('button', { name: 'Compare with the previous period' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('cmp=off');
  });

  it('an empty previous window says so', async () => {
    renderCard({
      options: CHANGE,
      summary: periods(
        NOW_CHANGE,
        summaryOf({ topics: [topic('t1', 'SEO tools', 1)], prompts: [prompt('p1', ['t1'], [0, 0])] }),
      ),
    });
    expect(await screen.findByRole('heading', { name: 'No answers in the previous 28 days' })).toBeInTheDocument();
  });

  it('not paired shows the loading state and no change', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const previous = isPrevious(new URL(request.url));
        if (previous) await release.promise;
        return HttpResponse.json({ data: previous ? BEFORE_CHANGE : NOW_CHANGE });
      }),
      ...vocabularyHandlers(TERMS),
    );
    function Card(props: CardProps): ReactElement {
      return <TopicContributionCard {...props} options={{ ...props.options, engine: 'chatgpt_web', view: 'change' }} />;
    }
    renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    const frame = await frameOf();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list', { name: /^What each topic add(s|ed)/ })).not.toBeInTheDocument();
    release.open();
    expect(await itemsOf()).toHaveLength(2);
  });
});

describe('TopicContributionCard change view refetch', () => {
  it('a refetch keeps the bars and shows the refetch bar, never a skeleton', async () => {
    const { queryClient } = renderCard({ options: CHANGE, summary: changePeriods });
    await listOf();
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        await release.promise;
        return HttpResponse.json({ data: isPrevious(new URL(request.url)) ? BEFORE_CHANGE : NOW_CHANGE });
      }),
    );
    act(() => {
      void queryClient.invalidateQueries();
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(await itemsOf()).toHaveLength(2);
    expect(frame.querySelector('[data-slot="skeleton"]')).toBeNull();
    release.open();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
  });
});

describe('TopicContributionCard states', () => {
  it('loading is the skeleton at the frame height, with no list', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async () => {
        await release.promise;
        return HttpResponse.json({ data: NOW });
      }),
      ...vocabularyHandlers(TERMS),
    );
    function Card(props: CardProps): ReactElement {
      return <TopicContributionCard {...props} options={{ ...props.options, engine: 'chatgpt_web' }} />;
    }
    renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[style*="height: 240px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /^What each topic add(s|ed)/ })).not.toBeInTheDocument();
    release.open();
    await listOf();
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = renderCard({ summary: () => (calls++ === 0 ? failing() : NOW) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_share/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await itemsOf()).toHaveLength(3);
  });

  it('a failed refresh keeps the rows and says these are the last figures', async () => {
    const { queryClient } = renderCard();
    await listOf();
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await itemsOf()).toHaveLength(3);
  });
});

describe('TopicContributionCard export block', () => {
  it('registers a block under the item id with the points of each bar', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopicContributionCard {...props} options={{ ...props.options, engine: 'chatgpt_web' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(periods(NOW, NOW)), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.topic_contribution', Card, width: 'two_thirds' }), {
      searchParams: ONE_ENGINE,
    });
    await listOf();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['topic', 'prompts', 'contribution_points']);
    expect(block?.rows).toEqual([
      ['SEO tools', 2, 35],
      ['Email', 2, 12.5],
      ['Prompts without a topic', 1, 18.75],
    ]);
  });
});
