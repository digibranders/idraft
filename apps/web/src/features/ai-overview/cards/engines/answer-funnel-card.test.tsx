import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import AnswerFunnelCard from './answer-funnel-card';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import type { CardProps } from '@/features/layouts';
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

const TYPE = 'ai.answer_funnel';
const TITLE = 'From answer to citation, by engine';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

interface Funnel {
  valid: number;
  named: number;
  both: number;
  observations?: number;
}

/** One prompt on the two engines Fynix has on: `named` of `valid` valid answers name the brand, `both` also cite it. */
function serve(chatgpt: Funnel, gemini: Funnel = { valid: 8, named: 4, both: 2 }): void {
  const cells = (code: 'chatgpt_web' | 'gemini_web', { valid, named, both, observations }: Funnel) =>
    engineCells(code, {
      mentioned: [named, valid, observations ?? valid],
      outcomes: { mentionedAndCited: [both, valid, observations ?? valid] },
    });
  server.use(
    http.get(SUMMARY, () =>
      HttpResponse.json({
        data: summaryOf([promptRow('p1', [cells('chatgpt_web', chatgpt), cells('gemini_web', gemini)])], {
          codes: ['chatgpt_web', 'gemini_web'],
        }),
      }),
    ),
  );
}

const BIG: Funnel = { valid: 1800, named: 612, both: 270, observations: 1836 };

const renderCard = (): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card: AnswerFunnelCard }), { searchParams: WINDOW });

const section = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};

const groups = (frame: HTMLElement): HTMLElement[] => [
  ...frame.querySelectorAll<HTMLElement>('[data-slot="step-group"]'),
];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(csvWrite.downloadBlob).mockClear();
});

describe('AnswerFunnelCard', () => {
  it('has a group per engine with its own steps in chart-1 and the others in the reference colour', async () => {
    serve(BIG);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const [chatgpt, gemini] = groups(frame);
    expect(chatgpt).toHaveTextContent('ChatGPT');
    expect(gemini).toHaveTextContent('Gemini');
    for (const group of groups(frame)) {
      const bars = [...group.querySelectorAll('[data-slot="step-bar"]')];
      expect(bars).toHaveLength(4);
      expect(bars.map((bar) => bar.className.includes('bg-chart-1'))).toEqual([false, false, true, true]);
      expect(bars.map((bar) => bar.className.includes('bg-chart-reference'))).toEqual([true, true, false, false]);
    }
  });

  it('writes each count with its share of the step before, and the answers that were not valid', async () => {
    serve(BIG);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const [chatgpt] = groups(frame);
    expect(chatgpt).toHaveTextContent('Answers');
    expect(chatgpt).toHaveTextContent('1,836');
    // Collection loss is said on the valid step, never read as a miss
    expect(chatgpt).toHaveTextContent('98.0%, 1,800 of 1,836 answers, 36 not valid');
    expect(chatgpt).toHaveTextContent('34.0%, 612 of 1,800 valid answers');
    expect(chatgpt).toHaveTextContent('44.1%, 270 of 612 answers naming you');
  });

  it('the Table view equals the accessible text of the steps', async () => {
    serve(BIG);
    const { user } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const spoken = [...frame.querySelectorAll('[data-slot="step-group"] li .sr-only')].map((node) => node.textContent);
    expect(spoken).toHaveLength(8);
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const rows = within(frame).getAllByRole('row').slice(1);
    const written = rows.map((row) => {
      // The engine is the row header: the cells of the row are all its children
      const [, step, count, share] = [...row.children].map((cell) => cell.textContent ?? '');
      return share === '' ? `${step ?? ''}: ${count ?? ''}` : `${step ?? ''}: ${count ?? ''}, ${share ?? ''}`;
    });
    expect(written).toEqual(spoken);
  });

  it('draws every engine on one scale, so a shorter funnel has shorter bars', async () => {
    serve({ valid: 100, named: 50, both: 25 }, { valid: 50, named: 25, both: 10 });
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const widthOf = (group: HTMLElement | undefined): string | undefined =>
      group?.querySelector<HTMLElement>('[data-slot="step-bar"]')?.style.width;
    const [chatgpt, gemini] = groups(frame);
    expect(widthOf(chatgpt)).toBe('100%');
    expect(widthOf(gemini)).toBe('50%');
  });

  it('says "3 answers" in place of a share under a step with too few answers', async () => {
    serve({ valid: 3, named: 2, both: 1 });
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const [chatgpt] = groups(frame);
    expect(chatgpt).toHaveTextContent('3 answers');
    expect(chatgpt).not.toHaveTextContent('%');
  });

  it('shows an unknown step as its reason when every answer was not valid, never as a 0', async () => {
    serve({ valid: 0, named: 0, both: 0, observations: 10 });
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    const [chatgpt] = groups(frame);
    expect(chatgpt).toHaveTextContent('0.0%, 0 of 10 answers, 10 not valid');
    expect(chatgpt).toHaveTextContent('No valid answer to count');
  });

  it('says in the footnote that the funnel pools answers while the strip is prompt weighted', async () => {
    serve(BIG);
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/pooled over the prompts/);
    });
    expect(frame).toHaveTextContent(/mean of the rates of the prompts/);
    expect(frame).toHaveTextContent(/collection loss, not a miss/);
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
    serve({ valid: 0, named: 0, both: 0, observations: 5 }, { valid: 0, named: 0, both: 0, observations: 2 });
    renderCard();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
    expect(screen.getByText('7 answers were not valid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View runs' }).getAttribute('href')).toContain('/runs');
    expect(document.querySelectorAll('[data-slot="step-bar"]')).toHaveLength(0);
  });

  it('shows an error with Retry and the error id, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-funnel')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-funnel/).length).toBeGreaterThan(0);
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot="step-group"]').length).toBeGreaterThan(0);
    });
  });

  it('keeps the steps and says the figures are stale when a later read fails', async () => {
    serve(BIG);
    const { queryClient } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await within(frame).findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(groups(frame)).toHaveLength(2);
  });

  it('downloads the Table view as CSV with the counts and an empty cell for an unknown step', async () => {
    serve({ valid: 0, named: 0, both: 0, observations: 10 });
    const { user } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('answer-funnel-by-engine.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('ChatGPT,Valid answers,0,');
    // The step that follows has no count: an empty cell, not 0
    expect(text).toContain('ChatGPT,Naming you,,');
  });

  it('registers its Table view as an export block under the item id', async () => {
    serve(BIG);
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <AnswerFunnelCard {...props} />
        </ExportProvider>
      );
    }
    renderWithProviders(cardInOverview({ type: TYPE, Card: Wrapped }), { searchParams: WINDOW });
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual(['engine', 'step', 'count', 'of', 'share_percent', 'status']);
    expect(block?.rows).toHaveLength(8);
    expect(block?.rows[2]).toEqual(['ChatGPT', 'Naming you', 612, 1800, 34, 'ok']);
    expect(block?.rows[0]).toEqual(['ChatGPT', 'Answers', 1836, null, null, 'ok']);
  });

  it('axe finds no violation', async () => {
    serve(BIG);
    const { container } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(groups(frame)).toHaveLength(2);
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
