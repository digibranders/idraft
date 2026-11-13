import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EngineDisagreementCard from './engine-disagreement-card';
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
import type { PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
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
const TITLE = 'Named by one engine, not another';

const TERMS: TermSpec[] = [
  { id: 't1', name: 'SEO tools', parent: null },
  { id: 't2', name: 'Email', parent: null },
  { id: 't3', name: 'CRM', parent: null },
];
type Pair = readonly [number, number];

/** A prompt with its named and valid answers on ChatGPT and on Gemini. */
function prompt(id: string, topics: string[], chatgpt: Pair, gemini: Pair): PromptSummaryRow {
  return promptRow(id, `prompt ${id}`, topics, [
    engineCells('chatgpt_web', { mentioned: chatgpt }),
    engineCells('gemini_web', { mentioned: gemini }),
  ]);
}

const topicOf = (id: string, name: string, prompts: number) =>
  topicRow(id, name, prompts, [
    engineCells('chatgpt_web', { mentioned: [8, 10], prompts }),
    engineCells('gemini_web', { mentioned: [8, 10], prompts }),
  ]);

// SEO tools: 4 prompts ChatGPT names and Gemini misses (p1, p2, p3, p12), p4 both name, p5 undecided (Gemini 3 answers).
// Email: p6 Gemini names and ChatGPT misses; p4 is in it too. CRM: p8 and p9 ChatGPT names, Gemini misses.
const SUMMARY: PromptsSummary = summaryOf({
  topics: [topicOf('t1', 'SEO tools', 6), topicOf('t2', 'Email', 3), topicOf('t3', 'CRM', 4)],
  prompts: [
    prompt('p1', ['t1'], [2, 4], [0, 5]),
    prompt('p2', ['t1'], [1, 4], [0, 4]),
    prompt('p3', ['t1'], [3, 5], [0, 6]),
    prompt('p4', ['t1', 't2'], [2, 4], [2, 4]),
    prompt('p5', ['t1'], [1, 4], [0, 3]),
    prompt('p6', ['t2'], [0, 4], [3, 5]),
    prompt('p7', ['t2'], [0, 4], [0, 4]),
    prompt('p8', ['t3'], [4, 4], [0, 4]),
    prompt('p9', ['t3'], [1, 5], [0, 5]),
    prompt('p10', ['t3'], [0, 4], [0, 4]),
    prompt('p11', ['t3'], [0, 0], [0, 0]),
    prompt('p12', ['t1'], [2, 4], [0, 4]),
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
  threeEngines?: boolean;
}

function render({ options = {}, searchParams = TWO_ENGINES, summary = SUMMARY, threeEngines = false }: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (threeEngines) server.use(THREE_ENGINES);
  return renderCard({ options, searchParams });
}

function renderCard({ options = {}, searchParams = TWO_ENGINES }: Setup) {
  function Card(props: CardProps): ReactElement {
    return <EngineDisagreementCard {...props} options={{ ...props.options, rows: '10', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.engine_disagreement', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const tableOf = (): Promise<HTMLElement> => screen.findByRole('table', { name: /^Prompts one engine names/ });
const rowsOf = async (): Promise<HTMLElement[]> =>
  within(await tableOf())
    .getAllByRole('row')
    .slice(1);
// The first column is the row header
const cellsOf = (row: HTMLElement): (string | null)[] =>
  [...row.querySelectorAll('th, td')].map((cell) => cell.textContent);

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_dis' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('EngineDisagreementCard', () => {
  it('lists the topic, the pair words and the prompt count', async () => {
    render();
    expect((await rowsOf()).map(cellsOf)).toEqual([
      ['SEO tools', 'ChatGPT yes, Gemini no', '4 prompts of 6'],
      ['CRM', 'ChatGPT yes, Gemini no', '2 prompts of 4'],
      ['Email', 'Gemini yes, ChatGPT no', '1 prompt of 3'],
    ]);
  });

  it('a topic links to the drawer', async () => {
    render();
    const link = within((await rowsOf())[0] as HTMLElement).getByRole('link', { name: 'SEO tools' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('inspect')).toBe('topic:t1');
  });

  it('needs two engines', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <EngineDisagreementCard {...props} options={{ ...props.options, rows: '10' }} />;
    }
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.engine_disagreement', Card, width: 'two_thirds' }),
      {
        searchParams: 'engine=chatgpt_web',
        onUrlUpdate: ({ queryString }) => {
          updates.push(queryString);
        },
      },
    );
    const title = await screen.findByRole('heading', { name: 'Needs two engines' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('button'), ...box.queryAllByRole('link')]).toHaveLength(1);
    await user.click(box.getByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('engine=');
  });

  it('no disagreement is its own empty reason', async () => {
    render({
      summary: summaryOf({
        topics: [topicOf('t1', 'SEO tools', 2)],
        prompts: [prompt('p1', ['t1'], [2, 4], [2, 4]), prompt('p2', ['t1'], [0, 4], [0, 4])],
      }),
    });
    const title = await screen.findByRole('heading', {
      name: 'No prompt is named by one engine and missed by another',
    });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(
      box.getByText(/among prompts with at least 4 valid answers on the engine that misses you/),
    ).toBeInTheDocument();
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }) });
    expect(await screen.findByRole('heading', { name: 'No topics yet' })).toBeInTheDocument();
  });

  it('no valid answers names the engines and the days', async () => {
    render({
      summary: summaryOf({
        topics: [topicOf('t1', 'SEO tools', 1)],
        prompts: [prompt('p1', ['t1'], [0, 0], [0, 0])],
      }),
    });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT and Gemini' }),
    ).toBeInTheDocument();
  });

  it('rows cut to N', async () => {
    render({ options: { rows: '2' } });
    expect((await rowsOf()).map((row) => cellsOf(row)[0])).toEqual(['SEO tools', 'CRM']);
  });

  it('the undecided count is in the footnote', async () => {
    render();
    const frame = await frameOf();
    await tableOf();
    expect(
      within(frame).getByText(
        /1 prompt is left out because an engine has fewer than 4 valid answers to say it misses you/,
      ),
    ).toBeInTheDocument();
    expect(within(frame).getByText(/names you in at least one answer/)).toBeInTheDocument();
  });

  it('the overlap footnote', async () => {
    render();
    const frame = await frameOf();
    await tableOf();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
  });

  it('the Table form adds the first three prompts of each row', async () => {
    const { user } = render();
    await tableOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table', { name: /^Prompts one engine names/ });
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Topic', 'Engines', 'Prompts', 'Examples']);
    const first = within(within(grid).getAllByRole('row')[1] as HTMLElement);
    // Four prompts disagree on SEO tools; the examples are the first three, in the order the prompts come
    expect(first.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'prompt p1',
      'prompt p2',
      'prompt p3',
    ]);
  });

  it('has no axe violations', async () => {
    const { container } = render();
    await tableOf();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the topics are links and Tab visits them in order', async () => {
    const { user } = render();
    const links = within(await tableOf()).getAllByRole('link');
    for (let press = 0; press < 12 && document.activeElement !== links[0]; press += 1) await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
  });
});

describe('EngineDisagreementCard states', () => {
  it('loading is the skeleton at the frame height, with no table', async () => {
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
    expect(frame.querySelector('[style*="height: 180px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    release.open();
    await tableOf();
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = render({ summary: () => (calls++ === 0 ? failing() : SUMMARY) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_dis/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowsOf()).toHaveLength(3);
  });

  it('refetching keeps the rows and shows the refetch bar', async () => {
    const { queryClient } = render();
    await tableOf();
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
    expect(await rowsOf()).toHaveLength(3);
    release.open();
  });

  it('a failed refresh keeps the rows and says these are the last figures', async () => {
    const { queryClient } = render();
    await tableOf();
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await rowsOf()).toHaveLength(3);
  });

  it('partial names an engine that has no valid answer on any prompt', async () => {
    render({ searchParams: '', threeEngines: true });
    await tableOf();
    expect(screen.getByText('Partial data: AI Mode has no valid answer in this window')).toBeInTheDocument();
  });

  it('holds the card as loading while the vocabulary tree is pending, then shows the rows', async () => {
    const release = gate();
    let served = false;
    server.use(
      summaryHandler(() => {
        served = true;
        return SUMMARY;
      }),
      ...vocabularyHandlers(TERMS),
    );
    // Added last so it matches first: held until released, then falls through to the served vocabularies
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/vocabularies'), async () => {
        await release.promise;
        return undefined;
      }),
    );
    renderCard({});
    const frame = await frameOf();
    await waitFor(() => {
      expect(served).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    release.open();
    expect(await rowsOf()).toHaveLength(3);
  });
});

describe('EngineDisagreementCard export block', () => {
  it('registers a block under the item id with the engine codes and the counts', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <EngineDisagreementCard {...props} options={{ ...props.options, rows: '10' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.engine_disagreement', Card, width: 'two_thirds' }), {
      searchParams: TWO_ENGINES,
    });
    await tableOf();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['topic', 'named_on', 'missed_on', 'prompts', 'topic_prompts']);
    expect(block?.rows).toEqual([
      ['SEO tools', 'chatgpt_web', 'gemini_web', 4, 6],
      ['CRM', 'chatgpt_web', 'gemini_web', 2, 4],
      ['Email', 'gemini_web', 'chatgpt_web', 1, 3],
    ]);
  });
});
