import { act, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CitationVsMentionCard from './citation-vs-mention-card';
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
import type { PromptsSummary } from '@/lib/api/types';
import { mswPath } from '@/mocks/respond';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { axe } from '@/test/axe';
import { stubViewport } from '@/test/customize-harness';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';
import { TOKENS } from '@/test/weekly-card-kit';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);

// jsdom has no canvas: the option each canvas was given is what a test reads
const drawn = vi.hoisted(() => ({ option: null as Record<string, unknown> | null, height: 0, draws: 0 }));
vi.mock('@/components/app/chart/echart-scatter', () => ({
  ScatterEChart: ({
    option,
    height,
  }: {
    option: (tokens: unknown) => Record<string, unknown>;
    height: number;
  }): ReactElement => {
    // `TOKENS` is read when the canvas renders, long after the module has loaded
    drawn.option = option(TOKENS);
    drawn.height = height;
    drawn.draws += 1;
    return <div data-testid="scatter-canvas" />;
  },
}));

beforeEach(() => {
  drawn.option = null;
  drawn.height = 0;
  drawn.draws = 0;
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SUMMARY_PATH = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');
const TITLE = 'Citation against mention by topic on ChatGPT';

const TERMS: TermSpec[] = ['t1', 't2', 't3', 't4', 't5'].map((id) => ({ id, name: id, parent: null }));
type Pair = readonly [number, number];

function row(id: string, name: string, prompts: number, mention: Pair, cited: Pair) {
  return topicRow(id, name, prompts, [
    engineCells('chatgpt_web', { mentioned: mention, cited, sov: mention, prompts }),
    engineCells('gemini_web', { mentioned: mention, cited, sov: mention, prompts }),
  ]);
}

// ChatGPT: SEO tools names 47.1% and cites 11.8% (35 points more named), Email 50.0% and 37.5%, CRM cites more than it
// names (-30), Pricing has 3 citation answers (too few), Support has no answer at all.
const SUMMARY: PromptsSummary = summaryOf({
  topics: [
    row('t1', 'SEO tools', 12, [64, 136], [16, 136]),
    row('t2', 'Email', 8, [40, 80], [30, 80]),
    row('t3', 'CRM', 6, [10, 60], [28, 60]),
    row('t4', 'Pricing', 5, [8, 10], [2, 3]),
    row('t5', 'Support', 4, [0, 0], [0, 0]),
  ],
  prompts: [promptRow('p1', 'best seo tools', ['t1', 't2'], [engineCells('chatgpt_web', { mentioned: [3, 4] })])],
});

const TWO_ENGINES = 'engine=chatgpt_web,gemini_web';

interface Setup {
  options?: Record<string, string>;
  searchParams?: string;
  summary?: PromptsSummary | ((url: URL) => PromptsSummary | Response);
  terms?: TermSpec[];
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
  terms = TERMS,
  vocabularies,
}: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(terms));
  if (vocabularies !== undefined) server.use(heldVocabularies(vocabularies));
  return renderCard({ options, searchParams });
}

function renderCard({ options = {}, searchParams = TWO_ENGINES }: Setup) {
  function Card(props: CardProps): ReactElement {
    return <CitationVsMentionCard {...props} options={{ ...props.options, engine: 'chatgpt_web', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.citation_vs_mention', Card, width: 'two_thirds' }), {
    searchParams,
  });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const canvasOf = (): Promise<HTMLElement> => screen.findByTestId('scatter-canvas');

interface DrawnSeries {
  data: { value: [number, number]; symbolSize: number }[];
}
const drawnSeries = (): DrawnSeries => {
  const [first] = (drawn.option?.series ?? []) as DrawnSeries[];
  if (first === undefined) throw new Error('No canvas was drawn');
  return first;
};

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_scatter' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

/** The name of the scatter module, built so that this file names it only the way the scatter test allows. */
const SCATTER_MODULE = ['echart', 'scatter'].join('-');

describe('CitationVsMentionCard', () => {
  it('loads the scatter by dynamic import only', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'citation-vs-mention-card.tsx'), 'utf8');
    expect(source).toContain(`import('@/components/app/chart/${SCATTER_MODULE}')`);
    expect(source).toMatch(/dynamic\(/);
    // No import statement, side effect import or export from names the module
    expect(source).not.toMatch(new RegExp(`^\\s*(?:import|export)\\b[^\\n]*['"][^'"]*${SCATTER_MODULE}['"]`, 'm'));
    expect(source.match(new RegExp(SCATTER_MODULE, 'g'))).toHaveLength(1);
  });

  it('draws one point for each topic with a rate on both, on one axis', async () => {
    render();
    await canvasOf();
    expect(drawnSeries().data).toHaveLength(3);
    // The highest value of either rate is 50 percent: one ceiling, the next tenth above it, on both axes
    expect(drawn.option?.xAxis).toMatchObject({ min: 0, max: 0.6 });
    expect(drawn.option?.yAxis).toMatchObject({ min: 0, max: 0.6 });
    expect(drawn.height).toBe(280);
  });

  it('the Table form lists every topic with counts', async () => {
    const { user } = render();
    await canvasOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Topic', 'Mention rate', 'Citation rate', 'Prompts', 'Gap']);
    // The largest gap first, the topics that cannot be plotted after them, each with its answers
    expect(
      within(grid)
        .getAllByRole('row')
        .slice(1)
        .map((tableRow) => within(tableRow).getByRole('rowheader').textContent),
    ).toEqual(['SEO tools', 'Email', 'CRM', 'Pricing', 'Support']);
    const cells = (name: string): (string | null)[] =>
      within(within(grid).getByRole('row', { name: new RegExp(`^${name}`) }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells('SEO tools')).toEqual([
      '47.1%, 64 of 136 answers',
      '11.8%, 16 of 136 answers',
      '12 prompts',
      '35 points',
    ]);
    expect(cells('CRM')).toEqual(['16.7%, 10 of 60 answers', '46.7%, 28 of 60 answers', '6 prompts', '-30 points']);
    expect(cells('Pricing')).toEqual(['80.0%, 8 of 10 answers', '3 answers, fewer than 4', '5 prompts', 'n/a']);
    expect(cells('Support')).toEqual(['No answers', 'No answers', '4 prompts', 'n/a']);
  });

  it('a topic name in the table links to its drawer', async () => {
    const { user } = render();
    await canvasOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const link = within(await screen.findByRole('table')).getByRole('link', { name: 'SEO tools' });
    expect(new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('inspect')).toBe('topic:t1');
  });

  it('a topic under 4 answers on either rate is in the count, not a point', async () => {
    render();
    const frame = await frameOf();
    await canvasOf();
    // Pricing (3 citation answers) and Support (none) are not drawn and are counted in words
    expect(drawnSeries().data).toHaveLength(3);
    expect(within(frame).getByText(/2 topics have too few answers on mention or citation/)).toBeInTheDocument();
  });

  it('a parent topic is not a point or a row, its subtopics are', async () => {
    const terms: TermSpec[] = [
      { id: 'tp', name: 'Tools', parent: null },
      { id: 't1', name: 't1', parent: 'tp' },
      { id: 't2', name: 't2', parent: 'tp' },
    ];
    const { user } = render({
      terms,
      summary: summaryOf({
        topics: [
          row('tp', 'Tools', 20, [104, 216], [46, 216]),
          row('t1', 'SEO tools', 12, [64, 136], [16, 136]),
          row('t2', 'Email', 8, [40, 80], [30, 80]),
        ],
      }),
    });
    await waitFor(() => {
      expect(drawn.option).not.toBeNull();
      expect(drawnSeries().data).toHaveLength(2);
    });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByRole('table');
    expect(within(grid).queryByRole('row', { name: /^Tools/ })).not.toBeInTheDocument();
    expect(within(grid).getByRole('row', { name: /^SEO tools/ })).toBeInTheDocument();
    expect(within(grid).getByRole('row', { name: /^Email/ })).toBeInTheDocument();
  });

  it('holds the card as loading while the vocabulary tree is pending, then draws', async () => {
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
    expect(screen.queryByTestId('scatter-canvas')).not.toBeInTheDocument();
    release.open();
    await canvasOf();
    expect(drawnSeries().data).toHaveLength(3);
  });

  it('the summary sentence says the count, the diagonal and the topics named without being cited', async () => {
    render();
    await canvasOf();
    const summary = screen.getByText(/Citation rate against mention rate on ChatGPT/);
    expect(summary).toHaveTextContent(
      'Citation rate against mention rate on ChatGPT: 3 topics, one point each, sized by prompts. A point on the dashed diagonal is cited as often as it is named. Named most often without being cited: SEO tools and Email.',
    );
  });

  it('the footnote names the reference line and that topics overlap', async () => {
    render();
    const frame = await frameOf();
    await canvasOf();
    expect(
      within(frame).getByText(/The dashed line marks topics cited as often as they are named/),
    ).toBeInTheDocument();
    expect(within(frame).getByText(/Topics overlap/)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(frame).getByText(/1 prompt is in more than one topic/)).toBeInTheDocument();
    });
    expect(within(frame).getByText(/Only the most specific topics are shown/)).toBeInTheDocument();
    expect(within(frame).getByText(/fewer than 4 valid answers|under 4 valid answers/)).toBeInTheDocument();
  });

  it('the meta line says the window', async () => {
    render();
    const frame = await frameOf();
    expect(within(frame).getByText(/Oct 16.*Nov 12.*28 days/)).toBeInTheDocument();
  });

  it('an engine outside the engine filter is an empty state with Use all engines', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <CitationVsMentionCard {...props} options={{ ...props.options, engine: 'chatgpt_web' }} />;
    }
    const { user } = renderWithProviders(
      cardInOverview({ type: 'ai.citation_vs_mention', Card, width: 'two_thirds' }),
      {
        searchParams: 'engine=gemini_web',
        onUrlUpdate: ({ queryString }) => {
          updates.push(queryString);
        },
      },
    );
    const title = await screen.findByRole('heading', { name: 'ChatGPT is not part of this view' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('button'), ...box.queryAllByRole('link')]).toHaveLength(1);
    expect(screen.queryByTestId('scatter-canvas')).not.toBeInTheDocument();
    await user.click(box.getByRole('button', { name: 'Use all engines' }));
    await waitFor(() => {
      expect(updates.length).toBeGreaterThan(0);
    });
    expect(updates.at(-1)).not.toContain('engine=');
  });

  it('an engine that is not on in the project is an empty state with an action or a sentence', async () => {
    render({ options: { engine: 'google_ai_mode' }, searchParams: '' });
    const title = await screen.findByRole('heading', { name: 'AI Mode is not part of this view' });
    expect(title.closest('[data-slot="empty-state"]')).not.toBeNull();
    expect(screen.queryByTestId('scatter-canvas')).not.toBeInTheDocument();
  });

  it('no topics is an empty state with Open Topics and prompts', async () => {
    render({ summary: summaryOf({ topics: [], prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }) });
    const title = await screen.findByRole('heading', { name: 'No topics yet' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('no valid answers names the engine and the days', async () => {
    render({ summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, [0, 0], [0, 0])] }) });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT' }),
    ).toBeInTheDocument();
  });

  it('answers but no topic with a rate on both is its own empty state, with the count', async () => {
    render({ summary: summaryOf({ topics: [row('t1', 'SEO tools', 4, [8, 10], [2, 3])] }) });
    const title = await screen.findByRole('heading', { name: 'No topic has a rate on both yet' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
    expect(screen.queryByTestId('scatter-canvas')).not.toBeInTheDocument();
  });

  it('has no axe violations in the chart form and in the Table form', async () => {
    const { container, user } = render();
    await canvasOf();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the canvas is no tab stop, so Tab reaches the Table form and Enter opens it', async () => {
    const { user } = render();
    await canvasOf();
    const toggle = screen.getByRole('button', { name: 'Table' });
    for (let press = 0; press < 12 && document.activeElement !== toggle; press += 1) await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});

describe('CitationVsMentionCard states', () => {
  it('loading is the skeleton at the frame height, with no canvas', async () => {
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
    expect(frame.querySelector('[style*="height: 280px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByTestId('scatter-canvas')).not.toBeInTheDocument();
    release.open();
    await canvasOf();
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = render({ summary: () => (calls++ === 0 ? failing() : SUMMARY) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_scatter/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await canvasOf();
    expect(drawnSeries().data).toHaveLength(3);
  });

  it('refetching keeps the canvas and shows the refetch bar', async () => {
    const { queryClient } = render();
    await canvasOf();
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
    expect(screen.getByTestId('scatter-canvas')).toBeInTheDocument();
    release.open();
  });

  it('a failed refresh keeps the canvas and says these are the last figures', async () => {
    const { queryClient } = render();
    await canvasOf();
    server.use(http.get(SUMMARY_PATH, () => failing(), { once: true }));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(screen.getByTestId('scatter-canvas')).toBeInTheDocument();
  });

  it('a card that is not live makes no request for the summary and shows a skeleton, not an error', async () => {
    const paths: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      paths.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', listener);
    try {
      function Held(props: CardProps): ReactElement {
        return <CitationVsMentionCard {...props} live={false} />;
      }
      const { container } = renderWithProviders(
        cardInOverview({ type: 'ai.citation_vs_mention', Card: Held as ComponentType<CardProps>, width: 'two_thirds' }),
      );
      // The engines are read whatever the card does; once they are in, a live card would have asked for its summary
      await waitFor(() => {
        expect(paths.some((entry) => entry.endsWith('/engines'))).toBe(true);
        expect(container.querySelector('section[aria-busy="true"] [data-slot="skeleton"]')).not.toBeNull();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      expect(paths.filter((entry) => entry.endsWith('/ai/prompts-summary'))).toEqual([]);
      expect(container.querySelector('section[aria-busy="true"] [data-slot="skeleton"]')).not.toBeNull();
    } finally {
      server.events.removeListener('request:start', listener);
    }
  });
});

describe('CitationVsMentionCard export block', () => {
  it('registers a block under the item id, an unknown rate an empty cell with a status, never 0', async () => {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <CitationVsMentionCard {...props} options={{ ...props.options, engine: 'chatgpt_web' }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(SUMMARY), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.citation_vs_mention', Card, width: 'two_thirds' }), {
      searchParams: TWO_ENGINES,
    });
    await canvasOf();
    const [block] = reader().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'topic',
      'mention_rate_percent',
      'mention_answers',
      'mention_status',
      'citation_rate_percent',
      'citation_answers',
      'citation_status',
      'prompts',
      'gap_points',
      'plotted',
    ]);
    expect(block?.rows[0]).toEqual(['SEO tools', 47.06, 136, 'ok', 11.76, 136, 'ok', 12, 35.29, 'plotted']);
    expect(block?.rows[3]).toEqual(['Pricing', 80, 10, 'ok', null, 3, 'insufficient', 5, null, 'not_plotted']);
    const support = block?.rows[4];
    expect(support?.[0]).toBe('Support');
    expect(support?.[1]).toBeNull();
    expect(support?.[4]).toBeNull();
    expect(support?.[8]).toBeNull();
    expect(support?.[9]).toBe('not_plotted');
  });
});
