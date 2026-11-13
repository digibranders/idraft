import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  engineCells,
  promptRow,
  summaryHandler,
  summaryOf,
  vocabularyHandlers,
  type TermSpec,
} from './topic-card-test-kit';
import TopPromptsCard from './top-prompts-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary, PromptSummaryRow } from '@/lib/api/types';
import { parseInspectTarget } from '@/lib/inspector/placement';
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
const TITLE = 'Prompts to look at';
/** The window before Oct 16 to Nov 12 ends on this day. */
const PREVIOUS_TO = '2026-10-15';

const TERMS: TermSpec[] = [{ id: 't1', name: 'Topic one', parent: null }];

type Pair = readonly [number, number];
function prompt(id: string, text: string, counts: { chatgpt?: Pair; gemini?: Pair }): PromptSummaryRow {
  return promptRow(
    id,
    text,
    ['t1'],
    [
      ...(counts.chatgpt === undefined ? [] : [engineCells('chatgpt_web', { mentioned: counts.chatgpt })]),
      ...(counts.gemini === undefined ? [] : [engineCells('gemini_web', { mentioned: counts.gemini })]),
    ],
  );
}

// Now: Alpha 85%, Eta 70% (ChatGPT only: Gemini has 2 answers), Beta 40%, Gamma 5%, Zeta 80% (not in the window
// before); Delta has 3 answers on one engine and Epsilon none, so neither has a rate.
const NOW: PromptsSummary = summaryOf({
  prompts: [
    prompt('a', 'Alpha prompt', { chatgpt: [90, 100], gemini: [80, 100] }),
    prompt('b', 'Beta prompt', { chatgpt: [50, 100], gemini: [30, 100] }),
    prompt('c', 'Gamma prompt', { chatgpt: [10, 100], gemini: [0, 100] }),
    prompt('d', 'Delta prompt', { chatgpt: [2, 3], gemini: [0, 0] }),
    prompt('e', 'Epsilon prompt', { chatgpt: [0, 0], gemini: [0, 0] }),
    prompt('f', 'Zeta prompt', { chatgpt: [80, 100], gemini: [80, 100] }),
    prompt('g', 'Eta prompt', { chatgpt: [70, 100], gemini: [1, 2] }),
  ],
});
// Before: Alpha was 35% (+50 points now), Gamma 50% (-45), Beta 38% (+2, within normal variation), Eta 20% on ChatGPT
// (+50 on that engine)
const BEFORE: PromptsSummary = summaryOf({
  prompts: [
    prompt('a', 'Alpha prompt', { chatgpt: [40, 100], gemini: [30, 100] }),
    prompt('b', 'Beta prompt', { chatgpt: [47, 100], gemini: [29, 100] }),
    prompt('c', 'Gamma prompt', { chatgpt: [60, 100], gemini: [40, 100] }),
    prompt('d', 'Delta prompt', { chatgpt: [1, 3], gemini: [5, 10] }),
    prompt('e', 'Epsilon prompt', { chatgpt: [0, 0], gemini: [0, 0] }),
    prompt('g', 'Eta prompt', { chatgpt: [20, 100], gemini: [1, 2] }),
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

function renderCard({ options = {}, searchParams = '', summary = periods(NOW, BEFORE), vocabularies }: Setup = {}) {
  server.use(summaryHandler(summary), ...vocabularyHandlers(TERMS));
  if (vocabularies !== undefined) server.use(vocabularies);
  function Card(props: CardProps): ReactElement {
    return <TopPromptsCard {...props} options={{ ...props.options, rows: '5', ...options }} />;
  }
  return renderWithProviders(cardInOverview({ type: 'ai.top_prompts', Card, width: 'half' }), { searchParams });
}

const heading = (): Promise<HTMLElement> => screen.findByRole('heading', { level: 2, name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const section = (await heading()).closest('section');
  if (section === null) throw new Error('The card has no frame');
  return section;
};
const listOf = (): Promise<HTMLElement> => screen.findByRole('list', { name: /prompts$|largest change$/ });
const itemsOf = async (): Promise<HTMLElement[]> => within(await listOf()).getAllByRole('listitem');
const labelsOf = async (): Promise<string[]> =>
  (await itemsOf()).map((item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent ?? '');
const itemOf = async (label: string): Promise<HTMLElement> => {
  const found = (await itemsOf()).find(
    (item) => item.querySelector('[data-slot="bar-list-label"]')?.textContent === label,
  );
  if (found === undefined) throw new Error(`no row for ${label}`);
  return found;
};

const failing = (): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req_top' },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

describe('which prompts', () => {
  it('show least named lists the lowest averages first, and prompts without a rate are not listed', async () => {
    renderCard({ options: { show: 'least_named' } });
    expect(await labelsOf()).toEqual(['Gamma prompt', 'Beta prompt', 'Eta prompt', 'Zeta prompt', 'Alpha prompt']);
  });

  it('show most named lists the highest averages first', async () => {
    renderCard({ options: { show: 'most_named' } });
    expect(await labelsOf()).toEqual(['Alpha prompt', 'Zeta prompt', 'Eta prompt', 'Beta prompt', 'Gamma prompt']);
  });

  it('show largest change lists the detectable changes first by absolute points', async () => {
    renderCard({ options: { show: 'largest_change' } });
    // Alpha +50 and Eta +50 tie on the points (the text decides), then Gamma -45, then Beta, which did not move
    expect(await labelsOf()).toEqual(['Alpha prompt', 'Eta prompt', 'Gamma prompt', 'Beta prompt']);
  });

  it('rows 5 and 10', async () => {
    const many = summaryOf({
      prompts: Array.from({ length: 12 }, (_, index) =>
        prompt(`m${String(index)}`, `Prompt ${String(index + 10)}`, { chatgpt: [index, 20] }),
      ),
    });
    const five = renderCard({ summary: many, options: { rows: '5', show: 'least_named' } });
    expect(await itemsOf()).toHaveLength(5);
    five.unmount();
    renderCard({ summary: many, options: { rows: '10', show: 'least_named' } });
    expect(await itemsOf()).toHaveLength(10);
  });

  it('the cut keeps the worst prompts, not the first ones read', async () => {
    renderCard({ options: { rows: '2', show: 'least_named' } });
    expect(await labelsOf()).toEqual(['Gamma prompt', 'Beta prompt']);
  });
});

describe('a row', () => {
  it('has the percent with avg of N engines, and the counts of each engine in its words', async () => {
    renderCard({ options: { show: 'most_named' } });
    const alpha = await itemOf('Alpha prompt');
    expect(alpha).toHaveTextContent(/85(\.\d)?%/);
    expect(alpha).toHaveTextContent('avg of 2 engines');
    expect(alpha).toHaveTextContent('ChatGPT 90 of 100 answers');
    expect(alpha).toHaveTextContent('Gemini 80 of 100 answers');
    // One engine has a rate: it is that engine alone, never an average of two
    const eta = await itemOf('Eta prompt');
    expect(eta).toHaveTextContent('1 engine');
    expect(eta).toHaveTextContent('ChatGPT only');
    expect(eta).not.toHaveTextContent('Gemini 1 of 2');
  });

  it('largest change colours only a detectable change', async () => {
    renderCard({ options: { show: 'largest_change' } });
    const gain = await itemOf('Alpha prompt');
    expect(gain.querySelector('[class*="text-positive-text"]')).not.toBeNull();
    const loss = await itemOf('Gamma prompt');
    expect(loss.querySelector('[class*="text-negative-text"]')).not.toBeNull();
    // Beta rose 2 points, which normal variation explains: no colour, however small the move is in words
    const still = await itemOf('Beta prompt');
    expect(still.querySelector('[class*="text-positive-text"], [class*="text-negative-text"]')).toBeNull();
    expect(still).toHaveTextContent(/within normal variation/);
  });

  it('largest change says before and now with their answers, and how many engines took part', async () => {
    renderCard({ options: { show: 'largest_change' } });
    const alpha = await itemOf('Alpha prompt');
    expect(alpha).toHaveTextContent('avg of 2 engines');
    expect(alpha).toHaveTextContent(/35(\.\d)?%, 70 of 200 answers/);
    expect(alpha).toHaveTextContent(/85(\.\d)?%, 170 of 200 answers/);
    expect(alpha).toHaveTextContent('ChatGPT and Gemini');
    // Eta: Gemini has 2 answers in both windows, so only ChatGPT takes part on both sides
    const eta = await itemOf('Eta prompt');
    expect(eta).toHaveTextContent('1 engine');
    expect(eta).toHaveTextContent('ChatGPT only');
    expect(eta).toHaveTextContent(/20(\.\d)?%, 20 of 100 answers/);
  });

  it('a row links to the prompt inspector', async () => {
    renderCard({ options: { show: 'most_named' } });
    const link = within(await itemOf('Alpha prompt')).getByRole('link');
    const query = new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams;
    expect(parseInspectTarget(query.get('inspect'))).toEqual({ type: 'prompt', id: 'a' });
  });

  it('a row is plain text when the scope holds an engine that is off', async () => {
    renderCard({ searchParams: 'engine=chatgpt_web,google_ai_mode', options: { show: 'most_named' } });
    await listOf();
    expect(within(await listOf()).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('what is left out', () => {
  it('the too few answers count is in the footnote, and those prompts are not listed', async () => {
    renderCard({ options: { show: 'least_named' } });
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText(/2 prompts have too few answers to rank/)).toBeInTheDocument();
    expect(await labelsOf()).not.toContain('Delta prompt');
    expect(await labelsOf()).not.toContain('Epsilon prompt');
  });

  it('largest change counts the prompts that could not be compared in the footnote', async () => {
    renderCard({ options: { show: 'largest_change' } });
    const frame = await frameOf();
    await listOf();
    // Zeta is new, Delta has one thin engine and Epsilon has no answer in either window
    expect(within(frame).getByText(/3 prompts were not compared/)).toBeInTheDocument();
    expect(within(frame).getByText(/unpaired, pooled counts/)).toBeInTheDocument();
  });

  it('the named views say nothing about a comparison', async () => {
    renderCard({ options: { show: 'least_named' } });
    const frame = await frameOf();
    await listOf();
    expect(within(frame).queryByText(/not compared/)).not.toBeInTheDocument();
    expect(within(frame).queryByText(/unpaired, pooled counts/)).not.toBeInTheDocument();
  });
});

describe('the comparison', () => {
  it('compare off is an empty state with an action for largest change only', async () => {
    const updates: string[] = [];
    server.use(summaryHandler(periods(NOW, BEFORE)), ...vocabularyHandlers(TERMS));
    function Card(props: CardProps): ReactElement {
      return <TopPromptsCard {...props} options={{ ...props.options, show: 'largest_change' }} />;
    }
    const { user } = renderWithProviders(cardInOverview({ type: 'ai.top_prompts', Card, width: 'half' }), {
      searchParams: 'cmp=off',
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

  it('compare off still lists the named views', async () => {
    renderCard({ searchParams: 'cmp=off', options: { show: 'least_named' } });
    expect((await labelsOf())[0]).toBe('Gamma prompt');
    expect(screen.queryByRole('heading', { name: 'Comparison is off' })).not.toBeInTheDocument();
  });

  it('nothing to compare is an empty state with an action', async () => {
    renderCard({
      options: { show: 'largest_change' },
      summary: periods(NOW, summaryOf({ prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] })),
    });
    const title = await screen.findByRole('heading', { name: 'No prompt can be compared' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect(box.getByRole('link', { name: 'Open Topics and prompts' })).toBeInTheDocument();
  });

  it('not paired shows loading and no change', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const previous = isPrevious(new URL(request.url));
        if (previous) await release.promise;
        return HttpResponse.json({ data: previous ? BEFORE : NOW });
      }),
      ...vocabularyHandlers(TERMS),
    );
    function Card(props: CardProps): ReactElement {
      return <TopPromptsCard {...props} options={{ ...props.options, show: 'largest_change' }} />;
    }
    renderWithProviders(cardInOverview({ type: 'ai.top_prompts', Card, width: 'half' }));
    const frame = await frameOf();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame).not.toHaveTextContent(/\d pts/);
    expect(screen.queryByRole('heading', { name: 'Comparison is off' })).not.toBeInTheDocument();
    release.open();
    expect(await labelsOf()).toContain('Alpha prompt');
  });

  it('a previous window that fails is an error, never a change from nothing', async () => {
    renderCard({ options: { show: 'largest_change' }, summary: (url) => (isPrevious(url) ? failing() : NOW) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('words and forms', () => {
  it('has the title and the window in its meta line', async () => {
    renderCard();
    const frame = await frameOf();
    await listOf();
    expect(within(frame).getByText('Oct 16 to Nov 12, 2026, 28 days')).toBeInTheDocument();
  });

  it('the footnote says the small sample rule and the weighting of the average', async () => {
    renderCard({ options: { show: 'most_named' } });
    const frame = await frameOf();
    await listOf();
    expect(
      within(frame).getByText(/A rate under 4 valid answers shows its answer count and no percent/),
    ).toBeInTheDocument();
    expect(within(frame).getByText(/equal weight average of the engines that show a rate/)).toBeInTheDocument();
  });

  it('the Table form has the counts of every row, and the change for the largest change', async () => {
    const named = renderCard({ options: { show: 'most_named' } });
    await listOf();
    await named.user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Prompt', 'Mention rate']);
    expect(within(table).getAllByText(/Alpha prompt/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/ChatGPT 90 of 100 answers/).length).toBeGreaterThan(0);
    named.unmount();

    const change = renderCard({ options: { show: 'largest_change' } });
    await listOf();
    await change.user.click(screen.getByRole('button', { name: 'Table' }));
    const changes = await screen.findByRole('table');
    expect(
      within(changes)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Prompt', 'Mention rate', 'Change']);
    const alpha = within(changes)
      .getAllByRole('row')
      .find((row) => /Alpha prompt/.test(row.textContent));
    expect(alpha).toHaveTextContent('+50.0 pts');
    expect(alpha).toHaveTextContent('detectable');
  });

  it('requests: current and previous, no include and no rows', async () => {
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
      for (const key of ['include', 'rows', 'compare']) expect(url.searchParams.has(key)).toBe(false);
    }
  });

  it('has no axe violations', async () => {
    const { container } = renderCard({ options: { show: 'largest_change' } });
    await listOf();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keyboard: the rows are links and Tab visits them in order', async () => {
    const { user } = renderCard({ options: { show: 'most_named' } });
    const links = within(await listOf()).getAllByRole('link');
    for (let press = 0; press < 12 && document.activeElement !== links[0]; press += 1) await user.tab();
    expect(links[0]).toHaveFocus();
    await user.tab();
    expect(links[1]).toHaveFocus();
  });
});

describe('the Export menu', () => {
  async function exported(show: string): Promise<ExportRead['blocks'][number] | undefined> {
    let reader: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): null {
      reader = useExportBlocks();
      return null;
    }
    function Card(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <TopPromptsCard {...props} options={{ ...props.options, rows: '5', show }} />
          <Reader />
        </ExportProvider>
      );
    }
    server.use(summaryHandler(periods(NOW, BEFORE)), ...vocabularyHandlers(TERMS));
    renderWithProviders(cardInOverview({ type: 'ai.top_prompts', Card, width: 'half' }));
    await listOf();
    return reader().blocks[0];
  }

  it('named: registers its rows under the item id, with an empty cell and a status where there is no rate', async () => {
    const block = await exported('least_named');
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['prompt', 'rate_percent', 'engines', 'answers', 'status']);
    const rows = new Map((block?.rows ?? []).map((row) => [row[0], row]));
    expect(rows.get('Alpha prompt')).toEqual(['Alpha prompt', 85, 2, 200, 'ok']);
    expect(rows.get('Delta prompt')?.slice(1)).toEqual([null, 0, 3, 'insufficient']);
    expect(rows.get('Epsilon prompt')?.slice(1)).toEqual([null, 0, 0, 'none']);
  });

  it('largest change: before, now and the change, with the not compared rows empty and named', async () => {
    const block = await exported('largest_change');
    expect(block?.header).toEqual([
      'prompt',
      'now_rate_percent',
      'before_rate_percent',
      'change_points',
      'engines',
      'reading',
    ]);
    const rows = new Map((block?.rows ?? []).map((row) => [row[0], row]));
    expect(rows.get('Alpha prompt')).toEqual(['Alpha prompt', 85, 35, 50, 2, 'detectable']);
    expect(rows.get('Beta prompt')?.slice(4)).toEqual([2, 'within']);
    expect(rows.get('Zeta prompt')).toEqual(['Zeta prompt', null, null, null, 0, 'not_compared']);
  });
});

describe('states', () => {
  it('loading is the skeleton at the frame height, with no list', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        await release.promise;
        return HttpResponse.json({ data: isPrevious(new URL(request.url)) ? BEFORE : NOW });
      }),
      ...vocabularyHandlers(TERMS),
    );
    renderWithProviders(cardInOverview({ type: 'ai.top_prompts', Card: TopPromptsCard, width: 'half' }));
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('[style*="height: 180px"] [data-slot="skeleton"]')).not.toBeNull();
    expect(screen.queryByRole('list', { name: /prompts$/ })).not.toBeInTheDocument();
    release.open();
    await listOf();
  });

  it('no engine asked says so and offers Use all engines', async () => {
    renderCard({ searchParams: 'engine=google_ai_mode' });
    expect(await screen.findByText('No engine is part of this view')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use all engines' })).toBeInTheDocument();
  });

  it('no prompts teaches how to get some, with one action', async () => {
    renderCard({ summary: summaryOf({ prompts: [], engineCodes: ['chatgpt_web', 'gemini_web'] }) });
    const state = (await screen.findByRole('heading', { name: 'No prompts yet' })).closest('[data-slot="empty-state"]');
    const box = within(state as HTMLElement);
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
  });

  it('no valid answers names the engines and the days', async () => {
    renderCard({ summary: summaryOf({ prompts: [prompt('e', 'Epsilon', { chatgpt: [0, 0], gemini: [0, 0] })] }) });
    expect(
      await screen.findByRole('heading', { name: 'No valid answers in these 28 days on ChatGPT and Gemini' }),
    ).toBeInTheDocument();
  });

  it('no prompt with a rate says so, with one action', async () => {
    renderCard({ summary: summaryOf({ prompts: [prompt('d', 'Delta', { chatgpt: [2, 3] })] }) });
    const title = await screen.findByRole('heading', { name: 'No prompt has enough answers to rank' });
    const box = within(title.closest('[data-slot="empty-state"]') as HTMLElement);
    expect([...box.queryAllByRole('link'), ...box.queryAllByRole('button')]).toHaveLength(1);
  });

  it('an error shows the title, the request id and Retry that recovers', async () => {
    let calls = 0;
    const { user } = renderCard({ summary: (url) => (calls++ === 0 ? failing() : isPrevious(url) ? BEFORE : NOW) });
    expect(await screen.findByText(`${TITLE} could not be read`)).toBeInTheDocument();
    expect(screen.getByText(/req_top/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await itemsOf()).toHaveLength(5);
  });

  it('stale says these are the last figures read and keeps the list', async () => {
    const { queryClient } = renderCard();
    await listOf();
    server.use(http.get(SUMMARY_PATH, () => failing()));
    act(() => {
      void queryClient.invalidateQueries();
    });
    expect(await screen.findByText('These are the last figures read')).toBeInTheDocument();
    expect(await itemsOf()).toHaveLength(5);
  });

  it('partial names an engine with no valid answer in any prompt', async () => {
    renderCard({
      summary: summaryOf({ prompts: [prompt('p', 'Only Gemini', { chatgpt: [0, 0], gemini: [9, 10] })] }),
    });
    expect(await screen.findByText('Partial data: ChatGPT has no valid answer in this window')).toBeInTheDocument();
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
    expect(screen.queryByRole('list', { name: /prompts$/ })).not.toBeInTheDocument();
    release.open();
    expect(await itemsOf()).toHaveLength(5);
  });

  it.each([
    ['most named', 'most_named', () => true],
    ['largest change, both windows', 'largest_change', () => true],
    ['largest change, the previous window alone', 'largest_change', isPrevious],
  ])('a refetch of %s keeps the rows and shows the refetch bar, never a skeleton', async (_name, show, held) => {
    const { queryClient } = renderCard({ options: { show } });
    await listOf();
    const count = (await itemsOf()).length;
    const release = gate();
    server.use(
      http.get(SUMMARY_PATH, async ({ request }) => {
        const url = new URL(request.url);
        if (held(url)) await release.promise;
        return HttpResponse.json({ data: isPrevious(url) ? BEFORE : NOW });
      }),
    );
    act(() => {
      void queryClient.invalidateQueries();
    });
    const frame = await frameOf();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).not.toBeNull();
    });
    expect(await itemsOf()).toHaveLength(count);
    expect(frame.querySelector('[data-slot="skeleton"]')).toBeNull();
    release.open();
    await waitFor(() => {
      expect(frame.querySelector('[data-slot="chart-refetch-bar"]')).toBeNull();
    });
    expect(await itemsOf()).toHaveLength(count);
  });
});
