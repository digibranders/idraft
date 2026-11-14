import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PromptHeatmapCard from './prompt-heatmap-card';
import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  vocabularyHandlers,
  type TermSpec,
} from './topic-card-test-kit';
import messages from '../../../../../messages/en.json';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import { parseTab } from '@/features/prompts/prompt-model';
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

type Pair = readonly [number, number];
const prompt = (id: string, text: string, topics: string[], chatgpt: Pair, gemini: Pair): PromptSummaryRow =>
  promptRow(id, text, topics, [
    engineCells('chatgpt_web', { mentioned: chatgpt }),
    engineCells('gemini_web', { mentioned: gemini }),
  ]);

/**
 * Fynix asks ChatGPT and Gemini. Averages: pricing 15%, startups 48%, both topics 60%, secure 90% (Gemini only: ChatGPT
 * has 3 answers there) and the prompt that was never answered, which has none and comes last.
 */
const PROMPTS = [
  prompt('p1', 'Best CRM for startups', [CRM], [8, 12], [3, 10]),
  prompt('p2', 'CRM pricing compared', [PRICING], [2, 10], [1, 10]),
  prompt('p3', 'Is it secure', [SECURITY], [3, 3], [9, 10]),
  prompt('p4', 'Never answered', [], [0, 0], [0, 0]),
  prompt('p5', 'CRM and security', [CRM, SECURITY], [6, 10], [6, 10]),
];
const SUMMARY: PromptsSummary = summaryOf({ prompts: PROMPTS });

const LEAST = [
  'CRM pricing compared (CRM / Pricing)',
  'Best CRM for startups (CRM)',
  'CRM and security (CRM)',
  'Is it secure (Security)',
  'Never answered',
];

interface Setup {
  summary?: PromptsSummary;
  options?: Readonly<Record<string, string>>;
  searchParams?: string;
  world?: OverviewWorld;
}

function render({ summary = SUMMARY, options = {}, searchParams = '', world = 'fynix' }: Setup = {}) {
  server.use(...vocabularyHandlers(TERMS), summaryHandler(summary));
  function Card(props: CardProps): ReactElement {
    return <PromptHeatmapCard {...props} options={{ ...props.options, ...options }} />;
  }
  return renderWithProviders(
    cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds', world }),
    { searchParams },
  );
}

const TITLE = 'Prompts by engine';
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
const cell = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('gridcell', { name });
const link = async (name: RegExp): Promise<HTMLElement> => within(await grid()).findByRole('link', { name });
const queryOf = (href: string | null): URLSearchParams => new URL(href ?? '', 'http://localhost').searchParams;

describe('the grid', () => {
  it('a row per prompt with its topic path, the least named first', async () => {
    render();
    expect(await rowNames()).toEqual(LEAST);
    const secure = within(await grid())
      .getByRole('rowheader', { name: /^Is it secure/ })
      .closest('tr');
    expect(secure).toHaveTextContent('Is it secure');
    expect(secure).toHaveTextContent('Security');
    // The prompt that has no topic has no second line
    const never = within(await grid())
      .getByRole('rowheader', { name: 'Never answered' })
      .closest('tr');
    expect(never?.querySelector('[data-slot="prompt-topic-path"]')).toBeNull();
  });

  it('sort most named puts the most named first and the prompt without a rate is still last', async () => {
    render({ options: { sort: 'most_named' } });
    expect(await rowNames()).toEqual([
      'Is it secure (Security)',
      'CRM and security (CRM)',
      'Best CRM for startups (CRM)',
      'CRM pricing compared (CRM / Pricing)',
      'Never answered',
    ]);
  });

  it('a column per asked engine, then avg of 2 from two engines', async () => {
    render();
    expect(await headers()).toEqual(['Prompt', 'ChatGPT', 'Gemini', 'avg of 2']);
  });

  it('avg column only from 2 engines', async () => {
    render({ searchParams: 'engine=chatgpt_web' });
    expect(await headers()).toEqual(['Prompt', 'ChatGPT']);
    expect(screen.queryByRole('columnheader', { name: /avg of/ })).not.toBeInTheDocument();
  });

  it('an engine outside the engine filter is not a column', async () => {
    render({ searchParams: 'engine=gemini_web' });
    expect(await headers()).toEqual(['Prompt', 'Gemini']);
  });

  it('a cell under 4 answers is hatched and says its answers', async () => {
    render();
    const thin = await link(/^Is it secure on ChatGPT/);
    const td = thin.closest('td');
    expect(td).toHaveClass('bg-insufficient');
    expect(td).toHaveTextContent('3 ans');
    expect(td?.textContent).not.toContain('%');
    expect(thin.getAttribute('aria-label')).not.toContain('%');
    expect(thin.getAttribute('aria-label')).toContain('3 answers');
  });

  it('a cell with no answers says n/a and never 0%', async () => {
    render();
    const none = await link(/^Never answered on ChatGPT/);
    expect(none.closest('td')).toHaveTextContent('n/a');
    expect(none.closest('td')?.textContent).not.toContain('0%');
    expect(none.closest('td')).not.toHaveClass('bg-insufficient');
  });

  it('the tip says k of n answers, the percent and the last valid answer', async () => {
    render();
    const tip = (await link(/^Best CRM for startups on ChatGPT/)).getAttribute('aria-label') ?? '';
    expect(tip).toMatch(/66\.7%, 8 of 12 answers/);
    expect(tip).toContain('Last valid answer Nov 11');
  });

  it('the average cell says how many engines took part and names them', async () => {
    render();
    const startups = await cell(/^Best CRM for startups, avg of 2/);
    expect(startups).toHaveTextContent('48%');
    expect(startups.getAttribute('aria-label')).toMatch(/Equal weight average of ChatGPT and Gemini/);
    const secure = await cell(/^Is it secure, 1 engine/);
    expect(secure.getAttribute('aria-label')).toMatch(/Gemini only/);
  });

  it('a cell links to the prompt inspector, and so does the prompt text', async () => {
    render();
    const query = queryOf((await link(/^Best CRM for startups on Gemini/)).getAttribute('href'));
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'prompt', id: 'p1' });
    const rowHeader = within(await grid()).getByRole('rowheader', { name: 'Best CRM for startups (CRM)' });
    const name = queryOf(within(rowHeader).getByRole('link').getAttribute('href'));
    expect(parseInspectTarget(name.get('inspect'))).toEqual({ type: 'prompt', id: 'p1' });
  });

  it('a link is plain text when the scope holds an engine that is off', async () => {
    render({ options: { rows: '2' }, searchParams: 'engine=chatgpt_web,google_ai_mode' });
    await grid();
    expect(within(await grid()).queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it('arrow keys move between cells', async () => {
    const { user } = render();
    const header = within(await grid()).getByRole('rowheader', { name: /^CRM pricing compared/ });
    header.focus();
    await user.keyboard('{ArrowRight}');
    expect(await link(/^CRM pricing compared on ChatGPT/)).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(await link(/^CRM pricing compared on Gemini/)).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(await link(/^Best CRM for startups on Gemini/)).toHaveFocus();
  });
});

describe('the cut', () => {
  const MANY = Array.from({ length: 12 }, (_, index) =>
    prompt(`m${String(index)}`, `Prompt ${String(index + 10)}`, [], [index, 20], [index, 20]),
  );
  const many = summaryOf({ prompts: MANY });

  it('rows 10 cuts after the sort and Show all names the total', async () => {
    render({ summary: many, options: { rows: '10', sort: 'least_named' } });
    const names = await rowNames();
    expect(names).toHaveLength(10);
    // The two best prompts are the ones left out, not the two worst
    expect(names).not.toContain('Prompt 21');
    expect(names).not.toContain('Prompt 20');
    expect(names[0]).toBe('Prompt 10');
    const all = await screen.findByRole('link', { name: 'Show all 12 prompts' });
    expect(parseTab(queryOf(all.getAttribute('href')).get('tab'))).toBe('prompts');
  });

  it('rows 20 shows every prompt and no Show all link', async () => {
    render({ summary: many, options: { rows: '20' } });
    expect(await rowNames()).toHaveLength(12);
    expect(screen.queryByRole('link', { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it('a prompt without a rate does not take the place of one that has a rate', async () => {
    render({ options: { rows: '4' } });
    expect(await rowNames()).toEqual(LEAST.slice(0, 4));
  });
});

describe('words', () => {
  it('has the title and the meta line with the prompts shown, the engines and the window', async () => {
    render({ options: { rows: '2' } });
    const section = await frame();
    await grid();
    expect(within(section).getByText('2 of 5 prompts, 2 engines, Oct 16 to Nov 12, 2026, 28 days')).toBeInTheDocument();
  });

  it('the footnote names the bins, that a prompt is one row and the small sample rule', async () => {
    render();
    const section = await frame();
    await grid();
    const text = section.querySelector('[data-slot="chart-footnote"]')?.textContent ?? section.textContent;
    for (const bin of ['seq1', 'seq2', 'seq3', 'seq4', 'seq5', 'seq6', 'seq7'] as const) {
      expect(text).toContain(messages.chart.heatmap.bins[bin]);
    }
    expect(text).toContain('Each prompt is one row');
    expect(text).toContain('A rate under 4 valid answers shows its answer count and no percent.');
    expect(text).toMatch(/average column gives each engine that shows a rate the same weight/);
  });

  it('the Table form prints each cell words', async () => {
    const { user } = render();
    await grid();
    const words = (await link(/^Best CRM for startups on ChatGPT/)).getAttribute('aria-label') ?? '';
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(screen.getByText(/^Never answered on ChatGPT: No answers/)).toBeInTheDocument();
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
          <PromptHeatmapCard {...props} />
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
    expect(block?.header.slice(0, 6)).toEqual([
      'prompt',
      'topic',
      'last_valid_at',
      'chatgpt_web_rate',
      'chatgpt_web_answers',
      'chatgpt_web_status',
    ]);
    const rows = new Map((block?.rows ?? []).map((row) => [row[0], row]));
    expect(rows.get('Best CRM for startups')?.slice(1, 6)).toEqual(['CRM', '2026-11-11T09:00:00Z', 66.67, 12, 'ok']);
    expect(rows.get('Is it secure')?.slice(3, 6)).toEqual([null, 3, 'insufficient']);
    expect(rows.get('Never answered')?.slice(3, 6)).toEqual([null, 0, 'no_answers']);
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
      return <PromptHeatmapCard {...props} />;
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

  it('no prompts teaches how to get some, with one action', async () => {
    render({ summary: summaryOf({ prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }) });
    const state = (await screen.findByRole('heading', { name: 'No prompts yet' })).closest('[data-slot="empty-state"]');
    const box = within(state as HTMLElement);
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no prompts under a topic filter offers Clear topic', async () => {
    render({
      summary: summaryOf({ prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }),
      searchParams: `topic=${CRM}`,
    });
    const box = (await screen.findByRole('heading', { name: 'No topics yet' })).closest('[data-slot="empty-state"]');
    expect(within(box as HTMLElement).getByRole('button', { name: 'Clear topic' })).toBeInTheDocument();
  });

  it('no valid answers names the engines and the days', async () => {
    render({ summary: summaryOf({ prompts: [prompt('p', 'Never', [], [0, 0], [0, 0])] }) });
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
              request_id: 'req_prompt_heat_1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({ data: SUMMARY });
      }),
    );
    function Card(props: CardProps): ReactElement {
      return <PromptHeatmapCard {...props} />;
    }
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.prompt_heatmap', Card: Card as ComponentType<CardProps>, width: 'two_thirds' }),
    );
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_prompt_heat_1/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: messages.common.retry }));
    expect(await rowNames()).toEqual(LEAST);
  });

  it('refetching keeps the grid and shows the refetch bar', async () => {
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
    expect(await rowNames()).toEqual(LEAST);
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
            request_id: 'req_prompt_heat_2',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    void queryClient.invalidateQueries();
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await rowNames()).toEqual(LEAST);
  });

  it('partial names an engine without a valid answer in any prompt', async () => {
    const onlyGemini = summaryOf({ prompts: [prompt('p', 'Only Gemini', [], [0, 0], [9, 10])] });
    render({ summary: onlyGemini });
    expect(await screen.findByText('Partial data: ChatGPT has no valid answer in this window')).toBeInTheDocument();
    expect(await rowNames()).toEqual(['Only Gemini']);
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
      return <PromptHeatmapCard {...props} />;
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
    // With the tree in, each prompt has its topic path
    expect(await rowNames()).toEqual(LEAST);
  });
});

describe('the whole card', () => {
  it('axe has no violations in the grid and the Table form', async () => {
    const { container, user } = render();
    await grid();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByText(/^Best CRM for startups on ChatGPT/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Eventus: the seeded project draws its grid and every percent has its answers', async () => {
    setAiSeeded(true);
    function Card(props: CardProps): ReactElement {
      return <PromptHeatmapCard {...props} />;
    }
    renderWithProviders(
      cardInOverview({
        type: 'ai.prompt_heatmap',
        Card: Card as ComponentType<CardProps>,
        width: 'two_thirds',
        world: 'eventus-security',
      }),
    );
    expect(await headers()).toEqual(['Prompt', 'ChatGPT', 'Gemini', 'avg of 2']);
    const cells = within(await grid()).getAllByRole('gridcell');
    expect(cells.length).toBeGreaterThan(10);
    for (const one of cells) {
      const label = one.getAttribute('aria-label') ?? within(one).queryByRole('link')?.getAttribute('aria-label') ?? '';
      if (one.textContent?.includes('%') === true) expect(label).toMatch(/answers?/);
    }
  });
});
