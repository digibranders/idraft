import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PromptWeekCard from './prompt-week-card';
import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  topicRow,
  vocabularyHandlers,
  type TermSpec,
  type WeekSpec,
} from './topic-card-test-kit';
import messages from '../../../../../messages/en.json';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { useOverview } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
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

const TERMS: TermSpec[] = [
  { id: CRM, name: 'CRM', parent: null },
  { id: PRICING, name: 'Pricing', parent: CRM },
  { id: SECURITY, name: 'Security', parent: null },
];

const W3 = '2026-10-19';
const W4 = '2026-10-26';

type Pair = readonly [number, number];
const week = (weekStart: string, mentioned: Pair, pooled = true): WeekSpec => ({
  weekStart,
  prompts: 1,
  mentioned,
  ...(pooled ? { pool: { weeks: 4 } } : {}),
});

function prompt(
  id: string,
  text: string,
  topics: string[],
  chatgpt: readonly WeekSpec[] | undefined,
  gemini: readonly WeekSpec[] | undefined,
): PromptSummaryRow {
  return promptRow(id, text, topics, [
    engineCells('chatgpt_web', { mentioned: [1, 2], ...(chatgpt === undefined ? {} : { series: chatgpt }) }),
    engineCells('gemini_web', { mentioned: [1, 2], ...(gemini === undefined ? {} : { series: gemini }) }),
  ]);
}

const TOPICS = [
  topicRow(CRM, 'CRM', 2, [engineCells('chatgpt_web', { mentioned: [9, 16], prompts: 2 })]),
  topicRow(PRICING, 'Pricing', 1, [engineCells('chatgpt_web', { mentioned: [4, 8], prompts: 1 })]),
  topicRow(SECURITY, 'Security', 1, [engineCells('chatgpt_web', { mentioned: [8, 8], prompts: 1 })]),
  topicRow(null, null, 1, [engineCells('chatgpt_web', { mentioned: [8, 8], prompts: 1 })]),
];

/** CRM holds p1 and p2 (the most prompts), Security p3, and p4 has no topic. */
const PROMPTS = [
  prompt('p1', 'Best CRM for startups', [CRM], [week(W3, [2, 8]), week(W4, [5, 8])], [week(W4, [1, 8])]),
  prompt('p2', 'CRM pricing compared', [PRICING], [week(W4, [4, 8])], undefined),
  prompt('p3', 'Is it secure', [SECURITY], [week(W4, [8, 8])], [week(W4, [3, 3])]),
  prompt('p4', 'Never filed', [], [week(W4, [8, 8])], undefined),
];
const SUMMARY: PromptsSummary = summaryOf({
  topics: TOPICS,
  prompts: PROMPTS,
  engineCodes: ['chatgpt_web', 'gemini_web'],
});

interface Setup {
  summary?: PromptsSummary;
  options?: Readonly<Record<string, string>>;
  searchParams?: string;
  world?: OverviewWorld;
}

function render({ summary = SUMMARY, options = {}, searchParams = '', world = 'fynix' }: Setup = {}) {
  server.use(...vocabularyHandlers(TERMS), summaryHandler(summary));
  function Card(props: CardProps): ReactElement {
    return <PromptWeekCard {...props} options={{ ...props.options, ...options }} />;
  }
  return renderWithProviders(
    cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds', world }),
    { searchParams },
  );
}

const TITLE = 'Prompt by week';
const frame = async (): Promise<HTMLElement> => {
  const heading = await screen.findByRole('heading', { name: TITLE });
  const section = heading.closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const grid = async (): Promise<HTMLElement> =>
  waitFor(() => {
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
const link = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('link', { name });
const queryOf = (href: string | null): URLSearchParams => new URL(href ?? '', 'http://localhost').searchParams;

describe('the grid', () => {
  it('shows the topic with the most prompts by default', async () => {
    render();
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
    expect(await headers()).toEqual(['Prompt', 'Oct 19', 'Oct 26']);
    expect(screen.getByRole('combobox', { name: 'Topic' })).toHaveTextContent('CRM');
    expect(screen.getByRole('combobox', { name: 'Engine' })).toHaveTextContent('ChatGPT');
  });

  it('follows the scope topic', async () => {
    render({ searchParams: `topic=${SECURITY}` });
    expect(await rowNames()).toEqual(['Is it secure']);
    expect(screen.getByRole('combobox', { name: 'Topic' })).toHaveTextContent('Security');
  });

  it('a topic picked here gives way when the scope topic changes', async () => {
    function Card(props: CardProps): ReactElement {
      const { setScope } = useOverview();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setScope({ topic: CRM });
            }}
          >
            Scope to CRM
          </button>
          <PromptWeekCard {...props} />
        </>
      );
    }
    server.use(...vocabularyHandlers(TERMS), summaryHandler(SUMMARY));
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    await grid();
    await user.click(screen.getByRole('combobox', { name: 'Topic' }));
    await user.click(await screen.findByRole('option', { name: 'CRM / Pricing' }));
    await waitFor(async () => {
      expect(await rowNames()).toEqual(['CRM pricing compared']);
    });
    // Pricing is still among the topics of the new scope, yet the card follows the scope topic again
    await user.click(screen.getByRole('button', { name: 'Scope to CRM' }));
    await waitFor(async () => {
      expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
    });
    expect(screen.getByRole('combobox', { name: 'Topic' })).toHaveTextContent('CRM');
  });

  it('changing the topic or the engine changes the rows', async () => {
    const { user } = render();
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
    await user.click(screen.getByRole('combobox', { name: 'Topic' }));
    await user.click(await screen.findByRole('option', { name: 'Security' }));
    await waitFor(async () => {
      expect(await rowNames()).toEqual(['Is it secure']);
    });
    await user.click(screen.getByRole('combobox', { name: 'Engine' }));
    await user.click(await screen.findByRole('option', { name: 'Gemini' }));
    // Gemini has one week, and the prompt has its point in it (3 answers: thin)
    await waitFor(async () => {
      expect(await headers()).toEqual(['Prompt', 'Oct 26']);
    });
    const thin = (await link(/^Is it secure, 4 weeks to Oct 26/)).closest('td');
    expect(thin).toHaveClass('bg-insufficient');
  });

  it('the topics to choose from are real topics, never the prompts without one', async () => {
    const { user } = render();
    await grid();
    await user.click(screen.getByRole('combobox', { name: 'Topic' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['CRM', 'CRM / Pricing', 'Security']);
    expect(screen.queryByText(/Never filed/)).not.toBeInTheDocument();
  });

  it('a cell tip says N weeks to date, k of n answers and the percent, and links to the prompt', async () => {
    render();
    const cell = await link(/^Best CRM for startups, 4 weeks to Oct 26/);
    expect(cell.getAttribute('aria-label')).toMatch(/: 62\.5%, 5 of 8 answers/);
    const query = queryOf(cell.getAttribute('href'));
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'prompt', id: 'p1' });
  });

  it('a thin cell is hatched and says its answers, and a week with no point says n/a', async () => {
    render({
      summary: summaryOf({
        topics: TOPICS,
        prompts: [
          prompt('p1', 'Thin one', [CRM], [week(W3, [2, 3]), week(W4, [5, 8])], undefined),
          PROMPTS[1] as PromptSummaryRow,
        ],
        engineCodes: ['chatgpt_web', 'gemini_web'],
      }),
    });
    const thin = await link(/^Thin one, 4 weeks to Oct 19/);
    expect(thin.closest('td')).toHaveClass('bg-insufficient');
    expect(thin.closest('td')).toHaveTextContent('3 ans');
    expect(thin.getAttribute('aria-label')).not.toContain('%');
    const missing = await link(/^CRM pricing compared, Week of Oct 19/);
    expect(missing.closest('td')).toHaveTextContent('n/a');
    expect(missing.getAttribute('aria-label')).not.toContain('0%');
  });

  it('a link is plain text when the scope holds an engine that is off', async () => {
    render({ searchParams: 'engine=chatgpt_web,google_ai_mode' });
    await grid();
    expect(within(await grid()).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('words', () => {
  it('has the title and the meta line with the topic, the prompts, the engine and the window', async () => {
    render();
    const section = await frame();
    await grid();
    expect(within(section).getByText('CRM, 2 prompts, ChatGPT, Oct 16 to Nov 12, 2026, 28 days')).toBeInTheDocument();
  });

  it('the pooled sentence C-18 is in the footnote when a point holds several weeks', async () => {
    render();
    const section = await frame();
    await grid();
    const text = section.querySelector('[data-slot="chart-footnote"]')?.textContent ?? section.textContent;
    expect(text).toContain('a prompt point always shows 4 weeks');
    expect(text).toContain('Topics overlap');
    expect(text).toContain('A rate under 4 valid answers shows its answer count and no percent.');
    for (const bin of ['seq1', 'seq4', 'seq7'] as const) expect(text).toContain(messages.chart.heatmap.bins[bin]);
  });

  it('weeks are not said to be pooled when no point is', async () => {
    const own = summaryOf({
      topics: TOPICS,
      prompts: [prompt('p1', 'Own week', [CRM], [week(W3, [2, 8], false), week(W4, [5, 8], false)], undefined)],
      engineCodes: ['chatgpt_web', 'gemini_web'],
    });
    render({ summary: own });
    const section = await frame();
    const cell = await link(/^Own week, Week of Oct 26/);
    expect(cell.getAttribute('aria-label')).not.toContain('weeks to');
    const text = section.querySelector('[data-slot="chart-footnote"]')?.textContent ?? section.textContent;
    expect(text).not.toContain('shows the last 4 weeks together');
    expect(text).not.toContain('a prompt point always shows 4 weeks');
  });

  it('the Table form prints each cell words', async () => {
    const { user } = render();
    await grid();
    const words = (await link(/^Best CRM for startups, 4 weeks to Oct 26/)).getAttribute('aria-label') ?? '';
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
  });
});

describe('the Export menu', () => {
  it('registers its table under the item id, with an empty rate and a status where a week has no rate', async () => {
    server.use(...vocabularyHandlers(TERMS), summaryHandler(SUMMARY));
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      read = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <PromptWeekCard {...props} />
          <Reader />
        </ExportProvider>
      );
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    await grid();
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header.slice(0, 2)).toEqual(['prompt', 'week_start']);
    const rows = new Map((block?.rows ?? []).map((row) => [`${String(row[0])}|${String(row[1])}`, row]));
    expect(rows.get(`Best CRM for startups|${W4}`)?.slice(2)).toEqual([62.5, 5, 8, 4, 'ok']);
    expect(rows.get(`CRM pricing compared|${W3}`)?.slice(2)).toEqual([null, null, 0, null, 'no_answers']);
  });
});

describe('what the card asks', () => {
  it('asks the summary once with include=series only: no rows, no compare', async () => {
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
    expect(asked[0]?.searchParams.get('include')).toBe('series');
    for (const key of ['rows', 'compare']) expect(asked[0]?.searchParams.has(key)).toBe(false);
  });

  /** The paths of the requests the server sees while `run` renders and waits. */
  async function pathsWhile(live: boolean, until: () => Promise<void>): Promise<string[]> {
    const paths: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      paths.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', listener);
    try {
      server.use(...vocabularyHandlers(TERMS), summaryHandler(SUMMARY));
      function Held(props: CardProps): ReactElement {
        return <PromptWeekCard {...props} live={live} />;
      }
      renderWithProviders(
        cardInOverview({ type: 'ai.prompt_heatmap', Card: Held as ComponentType<CardProps>, width: 'two_thirds' }),
      );
      await until();
    } finally {
      server.events.removeListener('request:start', listener);
    }
    return paths.filter((path) => path.endsWith('/ai/prompts-summary'));
  }

  it('asks no summary while the card is not live (customize mode)', async () => {
    const summaries = await pathsWhile(false, async () => {
      // The engines are read whatever the card does; a live card would have asked for its summary by then
      await screen.findByRole('heading', { name: TITLE });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    });
    expect(summaries).toEqual([]);
    const section = (await frame()) as HTMLElement;
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByText(`${TITLE} could not be read`)).not.toBeInTheDocument();
  });

  it('asks the summary once while the card is live', async () => {
    const summaries = await pathsWhile(true, async () => {
      await grid();
    });
    expect(summaries).toHaveLength(1);
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
      return <PromptWeekCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const section = await frame();
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
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('a topic filter that empties the card offers Clear topic', async () => {
    render({
      summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }),
      searchParams: `topic=${CRM}`,
    });
    const box = (await screen.findByRole('heading', { name: 'No topics yet' })).closest('[data-slot="empty-state"]');
    expect(within(box as HTMLElement).getByRole('button', { name: 'Clear topic' })).toBeInTheDocument();
  });

  it('no valid answer in any week names the engine and the days', async () => {
    const silent = summaryOf({
      topics: TOPICS,
      prompts: [prompt('p1', 'Silent', [CRM], [week(W3, [0, 0]), week(W4, [0, 0])], undefined)],
      engineCodes: ['chatgpt_web', 'gemini_web'],
    });
    render({ summary: silent });
    const title = await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' });
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
              request_id: 'req_prompt_week_1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    function Card(props: CardProps): ReactElement {
      return <PromptWeekCard {...props} />;
    }
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_prompt_week_1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
  });

  it('a refetch keeps the grid and shows the refetch bar', async () => {
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
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
    expect(section.querySelector('[data-slot="skeleton"]')).toBeNull();
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
            request_id: 'req_prompt_week_2',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    void queryClient.invalidateQueries();
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
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
      return <PromptWeekCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    const section = await frame();
    await waitFor(() => {
      expect(served).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    release.open();
    // With the tree in, the topic has its prompts
    expect(await rowNames()).toEqual(['Best CRM for startups', 'CRM pricing compared']);
  });
});

describe('the whole card', () => {
  it('axe has no violations in the grid and the Table form', async () => {
    const { container, user } = render();
    await grid();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByText(/^Best CRM for startups, 4 weeks to Oct 26/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Eventus: the seeded project draws weeks and every percent has its answers', async () => {
    setAiSeeded(true);
    function Card(props: CardProps): ReactElement {
      return <PromptWeekCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({
        type: 'ai.prompt_heatmap',
        Card: Card as ComponentType<CardProps>,
        width: 'two_thirds',
        world: 'eventus-security',
      }),
    );
    const cells = within(await grid()).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(4);
    for (const one of cells) {
      const label = one.getAttribute('aria-label') ?? within(one).queryByRole('link')?.getAttribute('aria-label') ?? '';
      if (one.textContent?.includes('%') === true) expect(label).toMatch(/answers?/);
    }
  });
});
