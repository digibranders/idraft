import { useQuery } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import SampleCoverageCard from './sample-coverage-card';
import { overviewSummaryQuery } from '../../data/overview-queries';
import { useOverview } from '../../overview-context';
import type { CardProps } from '@/features/layouts';
import type { PromptSummaryRow } from '@/lib/api/types';
import * as csvWrite from '@/lib/csv/csv-write';
import { axe } from '@/test/axe';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const TYPE = 'ai.sample_coverage';
const TITLE = 'Answers behind the numbers';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

/** A prompt with `chatgpt` and `gemini` valid answers (the engines Fynix has on). */
const prompt = (id: string, chatgpt: number, gemini: number, topics: readonly string[] = ['t1']): PromptSummaryRow =>
  promptRow(
    id,
    [
      engineCells('chatgpt_web', { mentioned: [0, chatgpt, chatgpt + 1] }),
      engineCells('gemini_web', { mentioned: [0, gemini, gemini + 1] }),
    ],
    { topics },
  );

const PROMPTS = [prompt('p1', 8, 3), prompt('p2', 2, 0), prompt('p3', 5, 5, [])];

/** The summary of the page, and the one with branded prompts included (one prompt more), told apart by the request. */
function serve(
  prompts: readonly PromptSummaryRow[] = PROMPTS,
  { withBranded = 'answer' }: { withBranded?: 'answer' | 'fail' } = {},
): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const branded = url.searchParams.get('include_branded') === 'true';
      if (branded && withBranded === 'fail') return failing('req-branded');
      const rows = branded ? [...prompts, prompt('p-branded', 8, 8)] : prompts;
      return HttpResponse.json({ data: summaryOf(rows, { codes: ['chatgpt_web', 'gemini_web'] }) });
    }),
  );
  return seen;
}

const renderCard = (search: string = WINDOW): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: SampleCoverageCard }), { searchParams: search });

const section = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};

/** What each row of a list says to assistive technology. */
const spoken = (list: HTMLElement): (string | null)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.sr-only')?.textContent ?? null);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(csvWrite.downloadBlob).mockClear();
});

describe('SampleCoverageCard', () => {
  it('is a distribution BarList with one group per engine', async () => {
    serve();
    renderCard();
    const chatgpt = await screen.findByRole('list', { name: 'Prompts by valid answers on ChatGPT' });
    const gemini = screen.getByRole('list', { name: 'Prompts by valid answers on Gemini' });
    expect(spoken(chatgpt)).toEqual([
      '4 or more valid answers: 2 of 3 prompts',
      '1 to 3 valid answers: 1 of 3 prompts',
      'No valid answer: 0 of 3 prompts',
    ]);
    expect(spoken(gemini)).toEqual([
      '4 or more valid answers: 1 of 3 prompts',
      '1 to 3 valid answers: 1 of 3 prompts',
      'No valid answer: 1 of 3 prompts',
    ]);
    // Fynix has AI Mode off: no group for it
    expect(screen.queryByRole('list', { name: 'Prompts by valid answers on AI Mode' })).not.toBeInTheDocument();
  });

  it('colours the rows by the scale of the rows, and none is chart-1', async () => {
    serve();
    renderCard();
    const chatgpt = await screen.findByRole('list', { name: 'Prompts by valid answers on ChatGPT' });
    const frame = await section();
    const fills = [...chatgpt.querySelectorAll('[data-slot="bar-list-bar"]')].map(
      (bar) => /bg-[a-z0-9-]+/.exec(bar.className)?.[0],
    );
    expect(fills).toEqual(['bg-seq-6', 'bg-insufficient', 'bg-rank-band-none']);
    expect(frame.querySelectorAll('.bg-chart-1')).toHaveLength(0);
  });

  it('counts the prompts without a topic from the prompt rows', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    expect(spoken(list)[0]).toBe('Without a topic: 1 of 3 prompts');
  });

  it('asks for the second read once, with branded prompts included, and says how many the page leaves out', async () => {
    const seen = serve();
    renderCard();
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toBe('Branded prompts left out: 1 prompt, not in the 3 prompts above');
    });
    expect(seen.filter((url) => url.searchParams.get('include_branded') === 'true')).toHaveLength(1);
    expect(seen.filter((url) => url.searchParams.get('include_branded') === 'false')).toHaveLength(1);
  });

  it('draws the branded row as words with no bar: its count is outside the prompts the bars are scaled to', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toContain('1 prompt');
    });
    const [, branded] = within(list).getAllByRole('listitem');
    expect(branded?.querySelector('[data-slot="bar-list-bar"]')).toBeNull();
    expect(branded).toHaveTextContent('1 prompt, not in the 3 prompts above');
    // The row above it is inside the prompts in scope and keeps its bar
    expect(within(list).getAllByRole('listitem')[0]?.querySelector('[data-slot="bar-list-bar"]')).not.toBeNull();
  });

  it('shares the key of the second read with an equal read of the page: one request for both', async () => {
    const seen = serve();
    function WithEqualRead(props: CardProps): ReactElement {
      const { workspaceId, project, scope, enabledEngines } = useOverview();
      // The page's own read for a scope with branded prompts included: the same request as the card's second read
      useQuery(
        overviewSummaryQuery(
          { workspaceId, projectId: project.id },
          { scope: { ...scope, branded: 'included' }, enabledEngines },
        ),
      );
      return <SampleCoverageCard {...props} />;
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: WithEqualRead }), { searchParams: WINDOW });
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toBe('Branded prompts left out: 1 prompt, not in the 3 prompts above');
    });
    expect(seen.filter((url) => url.searchParams.get('include_branded') === 'true')).toHaveLength(1);
  });

  it.each([
    ['the second read', 'branded'],
    ['the page read', 'page'],
  ] as const)(
    'says n/a, never a number of another scope, while %s of a new scope is still loading',
    async (_name, held) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const seen: URL[] = [];
      server.use(
        http.get(SUMMARY, async ({ request }) => {
          const url = new URL(request.url);
          seen.push(url);
          const branded = url.searchParams.get('include_branded') === 'true';
          const germany = url.searchParams.get('filter[country_iso]') === 'DE';
          // Germany has 2 prompts and 3 branded ones more; the first scope has 3 and 1
          const base = germany ? PROMPTS.slice(0, 2) : PROMPTS;
          const extra = Array.from({ length: germany ? 3 : 1 }, (_, index) => prompt(`b${String(index)}`, 8, 8));
          if (germany && held === (branded ? 'branded' : 'page')) await gate;
          return HttpResponse.json({
            data: summaryOf(branded ? [...base, ...extra] : base, { codes: ['chatgpt_web', 'gemini_web'] }),
          });
        }),
      );
      function WithSwitch(props: CardProps): ReactElement {
        const { setScope } = useOverview();
        return (
          <>
            <button
              type="button"
              onClick={() => {
                setScope({ country: 'DE' });
              }}
            >
              Germany
            </button>
            <SampleCoverageCard {...props} />
          </>
        );
      }
      const { user } = renderWithProviders(cardInOverview({ type: TYPE, Card: WithSwitch }), {
        searchParams: WINDOW,
      });
      const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
      await waitFor(() => {
        expect(spoken(list)[1]).toBe('Branded prompts left out: 1 prompt, not in the 3 prompts above');
      });
      await user.click(screen.getByRole('button', { name: 'Germany' }));
      // Both reads of the new scope have been asked; the held one has not answered
      await waitFor(() => {
        expect(seen.filter((url) => url.searchParams.get('filter[country_iso]') === 'DE')).toHaveLength(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(spoken(list)[1]).toBe('Branded prompts left out: n/a');
      act(() => {
        release();
      });
      await waitFor(() => {
        expect(spoken(list)[1]).toBe('Branded prompts left out: 3 prompts, not in the 2 prompts above');
      });
    },
  );

  it('does not ask for the second read when only branded prompts are in scope, and says so', async () => {
    const seen = serve();
    renderCard(`${WINDOW}&branded=only`);
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toBe('Branded prompts: These figures are of branded prompts only');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The page's own read alone; a second read of "included" would be a second request
    expect(seen).toHaveLength(1);
    expect(seen[0]?.searchParams.get('branded_only')).toBe('true');
  });

  it('says n/a, never 0, when the second read fails, and the rest of the card stays', async () => {
    serve(PROMPTS, { withBranded: 'fail' });
    renderCard();
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toBe('Branded prompts left out: n/a');
    });
    expect(screen.getByRole('list', { name: 'Prompts by valid answers on ChatGPT' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not load/)).not.toBeInTheDocument();
  });

  it('reads nothing more when branded prompts are included, and says so', async () => {
    const seen = serve();
    renderCard(`${WINDOW}&branded=include`);
    const list = await screen.findByRole('list', { name: 'Prompts in scope, all engines' });
    await waitFor(() => {
      expect(spoken(list)[1]).toBe('Branded prompts: Included in these figures');
    });
    // One request: the page's own, which already holds them
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen).toHaveLength(1);
  });

  it('names the window, the prompts and the branded choice', async () => {
    serve();
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/3 prompts.*branded prompts left out/);
    });
  });

  it('says what a rate needs in the footnote', async () => {
    serve();
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/A rate needs 4 or more valid answers/);
    });
  });

  it('the Table view lists every group with its counts and the CSV matches', async () => {
    serve();
    const { user } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Prompts by valid answers on ChatGPT' });
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const table = within(frame).getByRole('table', { name: 'Prompts by valid answers' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 3 + 3 + 2);
    expect(table).toHaveTextContent('ChatGPT');
    expect(table).toHaveTextContent('4 or more valid answers');
    expect(table).toHaveTextContent('2 prompts');
    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('answers-behind-the-numbers.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Engine,Measure,Prompts,Of prompts in scope');
    expect(text).toContain('ChatGPT,4 or more valid answers,2 prompts,of 3');
  });

  it('keeps its height while loading', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async () => {
        await gate;
        return undefined;
      }),
    );
    renderCard();
    const frame = await section();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('div[style*="height: 180px"]')).not.toBeNull();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(frame).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('is empty, with the reason and View runs, for a window with no valid answers', async () => {
    serve([
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: [0, 0, 5] }),
        engineCells('gemini_web', { mentioned: [0, 0, 2] }),
      ]),
    ]);
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
    expect(screen.getByText('7 answers were not valid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View runs' }).getAttribute('href')).toContain('/runs');
  });

  it('shows an error with Retry and the error id, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-coverage')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-coverage/).length).toBeGreaterThan(0);
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Prompts by valid answers on ChatGPT' })).toBeInTheDocument();
  });

  it('keeps the bars and says the figures are stale when a later read fails', async () => {
    serve();
    const { queryClient } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Prompts by valid answers on ChatGPT' });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await within(frame).findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(within(frame).getByRole('list', { name: 'Prompts by valid answers on ChatGPT' })).toBeInTheDocument();
  });

  it('registers its Table view as an export block under the item id, with empty unknown cells and a status', async () => {
    serve(PROMPTS, { withBranded: 'fail' });
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <SampleCoverageCard {...props} />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Wrapped }), { searchParams: WINDOW });
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
      expect(read().blocks[0]?.rows).toHaveLength(8);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['group', 'measure', 'prompts', 'of', 'status']);
    expect(block?.rows[0]).toEqual(['ChatGPT', '4 or more valid answers', 2, 3, 'ok']);
    expect(block?.rows[6]).toEqual(['All engines', 'Without a topic', 1, 3, 'ok']);
    // The second read failed: no count, never 0
    expect(block?.rows[7]).toEqual(['All engines', 'Branded prompts left out', null, null, 'unknown']);
  });

  it('asks for neither of its two summary reads while it is not live (customize mode)', async () => {
    const seen = serve();
    function Paused(props: CardProps): ReactElement {
      return <SampleCoverageCard {...props} live={false} />;
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Paused }), { searchParams: WINDOW });
    await section();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(seen).toHaveLength(0);
  });

  it('axe finds no violation', async () => {
    serve();
    const { container } = renderCard();
    await screen.findByRole('list', { name: 'Prompts by valid answers on ChatGPT' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
