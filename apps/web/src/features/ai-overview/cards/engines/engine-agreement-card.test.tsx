import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EngineAgreementCard from './engine-agreement-card';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
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

const TYPE = 'ai.engine_agreement';
const TITLE = 'Engine agreement';
const LIST = 'Prompts by how many engines name you';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

/** A prompt with `[k, n]` mention counts on ChatGPT and on Gemini (the engines Fynix has on). */
const prompt = (
  id: string,
  chatgpt: readonly [k: number, n: number],
  gemini: readonly [k: number, n: number],
): PromptSummaryRow =>
  promptRow(id, [
    engineCells('chatgpt_web', { mentioned: [chatgpt[0], chatgpt[1], chatgpt[1]] }),
    engineCells('gemini_web', { mentioned: [gemini[0], gemini[1], gemini[1]] }),
  ]);

/** Named by 0: p3; by 1: p2 and p4; by 2: p1; p5 has 2 valid answers on ChatGPT and is left out. */
const PROMPTS = [
  prompt('p1', [2, 8], [1, 5]),
  prompt('p2', [1, 6], [0, 6]),
  prompt('p3', [0, 5], [0, 5]),
  prompt('p4', [3, 4], [0, 4]),
  prompt('p5', [1, 2], [1, 9]),
];

function serve(prompts: readonly PromptSummaryRow[] = PROMPTS): void {
  server.use(
    http.get(SUMMARY, () => HttpResponse.json({ data: summaryOf(prompts, { codes: ['chatgpt_web', 'gemini_web'] }) })),
  );
}

const renderCard = (search: string = WINDOW): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: EngineAgreementCard }), { searchParams: search });

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

describe('EngineAgreementCard', () => {
  it('is a distribution of the prompts named by 0 to 2 of 2 engines, and counts the prompts it left out', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: LIST });
    expect(spoken(list)).toEqual([
      'Named by 0 of 2 engines: 1 of 4 prompts',
      'Named by 1 of 2 engines: 2 of 4 prompts',
      'Named by 2 of 2 engines: 1 of 4 prompts',
      'Left out, too few answers: 1 prompt, not in the 4 compared',
    ]);
  });

  it('colours the steps with the sequential scale from seq-3, and none is chart-1', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: LIST });
    const frame = await section();
    const fills = [...list.querySelectorAll('[data-slot="bar-list-bar"]')].map(
      (bar) => /bg-[a-z0-9-]+/.exec(bar.className)?.[0],
    );
    expect(fills).toEqual(['bg-seq-3', 'bg-seq-5', 'bg-seq-6']);
    expect(frame.querySelectorAll('.bg-chart-1')).toHaveLength(0);
  });

  it('scales the bars to the compared prompts, not to all of them: 1 of 4 compared is 25% of the track', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: LIST });
    const widths = [...list.querySelectorAll<HTMLElement>('[data-slot="bar-list-bar"]')].map((bar) => bar.style.width);
    // 5 prompts are on the page and 1 is left out: the scale is the 4 compared (a scale of 5 would give 20%, 40%, 20%)
    expect(widths).toEqual(['25%', '50%', '25%']);
  });

  it('draws the left out row as words with no bar', async () => {
    serve();
    renderCard();
    const list = await screen.findByRole('list', { name: LIST });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.at(-1)?.querySelector('[data-slot="bar-list-bar"]')).toBeNull();
    expect(rows.at(-1)).toHaveTextContent('1 prompt, not in the 4 compared');
  });

  it('names the window, the prompts and the branded choice, and says how a prompt is counted', async () => {
    serve();
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/5 prompts.*branded prompts left out/);
    });
    expect(frame).toHaveTextContent(/fewer than 4 valid answers on any of these engines is left out and counted/);
    expect(frame).toHaveTextContent(/One answer that names you is enough for a prompt to count as named/);
  });

  it('says why a page with one engine has no agreement to show', async () => {
    serve();
    renderCard(`${WINDOW}&engine=chatgpt_web`);
    expect(await screen.findByText('Agreement needs 2 or more engines')).toBeInTheDocument();
    expect(screen.getByText('Turn on another engine or add it to the engine filter.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: LIST })).not.toBeInTheDocument();
  });

  it('is empty, with the count, when no prompt has 4 valid answers on every engine', async () => {
    serve([prompt('p1', [1, 2], [1, 9]), prompt('p2', [0, 5], [0, 3])]);
    renderCard();
    expect(await screen.findByText('No prompt can be compared')).toBeInTheDocument();
    expect(screen.getByText('2 prompts have fewer than 4 valid answers on at least one engine.')).toBeInTheDocument();
  });

  it('is empty, with the reason, when there is no prompt in the scope', async () => {
    serve([]);
    renderCard();
    expect(await screen.findByText('No prompts in this scope')).toBeInTheDocument();
  });

  it('the Table view lists every step with its counts and the CSV matches', async () => {
    serve();
    const { user } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: LIST });
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const table = within(frame).getByRole('table', { name: LIST });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 4);
    expect(table).toHaveTextContent('Named by 2 of 2 engines');
    expect(table).toHaveTextContent('1 prompt');
    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('engine-agreement.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Engines naming you,Prompts,Of compared prompts');
    expect(text).toContain('Named by 1 of 2 engines,2 prompts,of 4');
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

  it('shows an error with Retry and the error id, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-agreement')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-agreement/).length).toBeGreaterThan(0);
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: LIST })).toBeInTheDocument();
  });

  it('keeps the bars and says the figures are stale when a later read fails', async () => {
    serve();
    const { queryClient } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: LIST });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await within(frame).findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(within(frame).getByRole('list', { name: LIST })).toBeInTheDocument();
  });

  it('registers its Table view as an export block under the item id, with empty unknown cells and a status', async () => {
    serve();
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <EngineAgreementCard {...props} />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Wrapped }), { searchParams: WINDOW });
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
      expect(read().blocks[0]?.rows).toHaveLength(4);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['measure', 'engines_naming', 'of_engines', 'prompts', 'of_prompts', 'status']);
    expect(block?.rows[0]).toEqual(['Named by 0 of 2 engines', 0, 2, 1, 4, 'ok']);
    expect(block?.rows[3]).toEqual(['Left out, too few answers', null, 2, 1, 5, 'left_out']);
  });

  it('axe finds no violation', async () => {
    serve();
    const { container } = renderCard();
    await screen.findByRole('list', { name: LIST });
    expect(await axe(container)).toHaveNoViolations();
  });
});
