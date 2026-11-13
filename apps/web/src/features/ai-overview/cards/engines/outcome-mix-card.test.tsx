import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRILL_SUPPORT } from '../../drilldown/drill-links';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import OutcomeMixCard from './outcome-mix-card';
import type { CardProps } from '@/features/layouts';
import * as csvWrite from '@/lib/csv/csv-write';
import { axe } from '@/test/axe';
import { CARD_ID, cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
// Nothing is downloaded: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const TYPE = 'ai.outcome_mix';
const TITLE = 'Named and cited, by engine';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

/** The summary of the two engines Fynix has on, written as the counts of the outcomes of each prompt. */
function serveSummary(prompts: readonly ReturnType<typeof promptRow>[]): void {
  server.use(
    http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf(prompts, { codes: ['chatgpt_web', 'gemini_web'] }) })),
  );
}

const outcomes = (both: number, named: number, cited: number, neither: number, observations?: number) => {
  const n = both + named + cited + neither;
  const seen = observations ?? n;
  return {
    mentioned: [both + named, n, seen] as const,
    cited: [both + cited, n, seen] as const,
    outcomes: {
      mentionedAndCited: [both, n, seen] as const,
      mentionedOnly: [named, n, seen] as const,
      citedOnly: [cited, n, seen] as const,
      neither: [neither, n, seen] as const,
    },
  };
};

function renderCard(searchParams: string = WINDOW): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(cardInOverview({ type: TYPE, Card: OutcomeMixCard }), { searchParams });
}

const cardHeading = (): Promise<HTMLElement> => screen.findByRole('heading', { name: TITLE });
const section = async (): Promise<HTMLElement> => {
  const found = (await cardHeading()).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(csvWrite.downloadBlob).mockClear();
});

describe('OutcomeMixCard', () => {
  it('one row per asked engine with logo and the denominator "n valid answers, p prompts"', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(1, 1, 1, 5)),
      ]),
      promptRow('p2', [
        engineCells('chatgpt_web', outcomes(0, 4, 1, 5)),
        engineCells('gemini_web', outcomes(2, 2, 2, 2)),
      ]),
    ]);
    renderCard();
    const list = await screen.findByRole('list', { name: 'Share of valid answers by outcome, one bar per engine' });
    const rows = within(list).getAllByRole('listitem');
    // Fynix has ChatGPT and Gemini on and AI Mode off
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ChatGPT');
    expect(rows[0]).toHaveTextContent('50 valid answers, 2 prompts');
    expect(rows[1]).toHaveTextContent('Gemini');
    expect(rows[1]).toHaveTextContent('16 valid answers, 2 prompts');
    expect(list.querySelectorAll('img')).toHaveLength(2);
  });

  it('no segment uses chart-1, the colour of the own brand', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
    });
    expect(frame.querySelectorAll('.bg-chart-1')).toHaveLength(0);
    // Four outcomes, in their fixed order and colours
    const swatches = [...frame.querySelectorAll('[data-slot="share-swatch"]')].slice(0, 4);
    expect(swatches.map((swatch) => swatch.getAttribute('data-segment'))).toEqual([
      'mentioned_and_cited',
      'mentioned_only',
      'cited_only',
      'neither',
    ]);
    expect(swatches.map((swatch) => /bg-[a-z0-9-]+/.exec(swatch.className)?.[0])).toEqual([
      'bg-chart-3',
      'bg-chart-4',
      'bg-chart-5',
      'bg-chart-other',
    ]);
  });

  it('the legend table is the Table view and the CSV carries k of n', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(100, 90, 50, 192)),
        engineCells('gemini_web', outcomes(1, 1, 1, 1)),
      ]),
    ]);
    const { user } = renderCard();
    const frame = await section();
    await within(frame).findByRole('table', { name: 'Share of valid answers by outcome, one bar per engine' });
    // The legend is always drawn below the bars; the Table view shows the same table alone
    expect(within(frame).getAllByRole('table')).toHaveLength(1);
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const table = within(frame).getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'ChatGPT' })).toBeInTheDocument();
    expect(within(table).getByText('Named only')).toBeInTheDocument();
    // 90 of 432 answers, with its count beside it
    expect(table).toHaveTextContent('20.8%, 90 of 432 answers');

    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('named-and-cited-by-engine.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    expect(await blob.text()).toContain('20.8%, 90 of 432 answers');
  });

  it('has no segment link while DRILL_SUPPORT.outcome is false', async () => {
    expect(DRILL_SUPPORT.prompts.outcome).toBe(false);
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
    });
    expect(within(frame).queryAllByRole('link')).toHaveLength(0);
  });

  it('offers the Patterns toggle', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    const { user } = renderCard();
    const frame = await section();
    const patterns = await within(frame).findByRole('button', { name: 'Patterns' });
    await user.click(patterns);
    expect(patterns).toHaveAttribute('aria-pressed', 'true');
    expect(frame.querySelectorAll('[data-pattern]').length).toBeGreaterThan(0);
  });

  it('says "3 answers" for an engine with too few valid answers, with no bar and no percent', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(1, 1, 0, 1)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    renderCard();
    const list = await screen.findByRole('list', { name: 'Share of valid answers by outcome, one bar per engine' });
    const [chatgpt, gemini] = within(list).getAllByRole('listitem');
    expect(chatgpt).toHaveTextContent('3 answers');
    expect(chatgpt?.querySelectorAll('[data-slot="share-segment"]')).toHaveLength(0);
    expect(chatgpt).not.toHaveTextContent('%');
    expect(gemini?.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
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
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: [0, 0, 5] }),
        engineCells('gemini_web', { mentioned: [0, 0, 2] }),
      ]),
    ]);
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
    expect(screen.getByText('7 answers were not valid.')).toBeInTheDocument();
    const runs = screen.getByRole('link', { name: 'View runs' });
    expect(runs.getAttribute('href')).toContain('/runs');
    // No bar and no zero share: nothing to read as a miss
    expect(document.querySelectorAll('[data-slot="share-segment"]')).toHaveLength(0);
  });

  it('shows an error with Retry and the error id, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-outcome')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-outcome/).length).toBeGreaterThan(0);
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('list', { name: 'Share of valid answers by outcome, one bar per engine' }),
    ).toBeInTheDocument();
  });

  it('keeps the bars and says the figures are stale when a later read fails', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    const { queryClient } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
    });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await within(frame).findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(frame.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
  });

  it('names the window, the prompts and the branded choice, and says each prompt counts once', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/1 prompt.*branded prompts left out, each prompt counts once/);
    });
    expect(frame).toHaveTextContent('Oct 16');
  });

  it('registers its Table view as an export block under the item id, with a status column and empty unknown cells', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(1, 1, 0, 1)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <OutcomeMixCard {...props} />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Wrapped }), { searchParams: WINDOW });
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['engine', 'outcome', 'share_percent', 'k', 'n', 'prompts', 'status']);
    // Four outcomes for each of the two engines
    expect(block?.rows).toHaveLength(8);
    // ChatGPT has 3 valid answers: no share, no count, and the status says why; never 0
    expect(block?.rows[0]).toEqual(['ChatGPT', 'Named and cited', null, null, 3, null, 'insufficient']);
    expect(block?.rows[4]).toEqual(['Gemini', 'Named and cited', 25, 5, 20, 1, 'ok']);
  });

  it('exports an engine with no valid answer as empty cells, never 0, with the status none', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(5, 5, 5, 5)),
        engineCells('gemini_web', outcomes(0, 0, 0, 0)),
      ]),
    ]);
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <OutcomeMixCard {...props} />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Wrapped }), { searchParams: WINDOW });
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
    });
    const rows = read().blocks[0]?.rows ?? [];
    expect(rows[0]).toEqual(['ChatGPT', 'Named and cited', 25, 5, 20, 1, 'ok']);
    for (const row of rows.slice(4)) expect(row.slice(2)).toEqual([null, null, null, null, 'none']);
  });

  it('axe finds no violation', async () => {
    serveSummary([
      promptRow('p1', [
        engineCells('chatgpt_web', outcomes(10, 5, 5, 20)),
        engineCells('gemini_web', outcomes(5, 5, 5, 5)),
      ]),
    ]);
    const { container } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame.querySelectorAll('[data-slot="share-segment"]').length).toBeGreaterThan(0);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
