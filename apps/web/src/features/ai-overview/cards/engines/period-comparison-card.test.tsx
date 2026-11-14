import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, promptRow, summaryOf, type EngineCellsInput } from './engines-fixtures';
import PeriodComparisonCard from './period-comparison-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
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

const TYPE = 'ai.period_comparison';
const TITLE = 'This period vs the last';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PREVIOUS_TO = '2026-10-15';

type Cells = [chatgpt: EngineCellsInput, gemini: EngineCellsInput];

/** Two prompts on the two engines Fynix has on, written as the counts of one window. */
function windowOf(first: Cells, second: Cells): ReturnType<typeof summaryOf> {
  return summaryOf(
    [
      promptRow('p1', [engineCells('chatgpt_web', first[0]), engineCells('gemini_web', first[1])]),
      promptRow('p2', [engineCells('chatgpt_web', second[0]), engineCells('gemini_web', second[1])]),
    ],
    { codes: ['chatgpt_web', 'gemini_web'] },
  );
}

function serve(now: ReturnType<typeof summaryOf>, before: ReturnType<typeof summaryOf>): void {
  server.use(
    http.get(SUMMARY, ({ request }) =>
      HttpResponse.json({ data: new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? before : now }),
    ),
  );
}

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

// ChatGPT mention 62.5% now (10 of 16) from 37.5% (6 of 16); Gemini 37.5% both times
const NOW = windowOf(
  [
    { mentioned: [6, 8], cited: [2, 8], shareOfVoice: [4, 8] },
    { mentioned: [2, 8], cited: [6, 8], shareOfVoice: [2, 8] },
  ],
  [
    { mentioned: [4, 8], cited: [0, 8], shareOfVoice: [4, 8] },
    { mentioned: [4, 8], cited: [4, 8], shareOfVoice: [2, 8] },
  ],
);
const BEFORE = windowOf(
  [
    { mentioned: [2, 8], cited: [2, 8], shareOfVoice: [2, 8] },
    { mentioned: [2, 8], cited: [4, 8], shareOfVoice: [2, 8] },
  ],
  [
    { mentioned: [4, 8], cited: [2, 8], shareOfVoice: [4, 8] },
    { mentioned: [4, 8], cited: [4, 8], shareOfVoice: [2, 8] },
  ],
);

function withMetric(metric: string | undefined): (props: CardProps) => ReactElement {
  return function Metric(props: CardProps): ReactElement {
    return <PeriodComparisonCard {...props} options={metric === undefined ? {} : { metric }} />;
  };
}

function renderCard(
  metric?: string,
  search: string = WINDOW,
  card: (props: CardProps) => ReactElement = withMetric(metric),
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(cardInOverview({ type: TYPE, Card: card, width: 'third' }), { searchParams: search });
}

const rowsList = (): Promise<HTMLElement> => screen.findByRole('list', { name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  vi.mocked(csvWrite.downloadBlob).mockClear();
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the period comparison card', () => {
  it('draws a dumbbell row per asked engine: the previous dot hollow and the current one filled in the engine colour', async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('ChatGPT');
    expect(rows[1]).toHaveTextContent('Gemini');
    const frame = await frameOf();
    expect(frame.querySelectorAll('[data-slot="interval-dot-previous"]')).toHaveLength(2);
    const current = [...frame.querySelectorAll('[data-slot="interval-dot-current"]')];
    expect(current.map((dot) => dot.className.match(/bg-chart-\w+/)?.[0])).toEqual(['bg-chart-1', 'bg-chart-2']);
  });

  it('says each rate with its counts and the change, and reads the row once', async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    const [chatgpt] = within(list).getAllByRole('listitem');
    expect(chatgpt).toHaveTextContent('ChatGPT: +25.0 pts');
    expect(chatgpt).toHaveTextContent('62.5%, 10 of 16 answers');
    expect(chatgpt).toHaveTextContent('37.5%, 6 of 16 answers');
  });

  it('writes share of voice rows as words with the numbers and "no interval yet"', async () => {
    serve(NOW, BEFORE);
    renderCard('share_of_voice');
    const list = await rowsList();
    const [chatgpt] = within(list).getAllByRole('listitem');
    expect(chatgpt).toHaveTextContent('no interval yet');
    expect(chatgpt).toHaveTextContent('answers that name a brand');
    const frame = await frameOf();
    expect(frame.querySelectorAll('[data-slot="interval-whisker"]')).toHaveLength(0);
    expect(frame.querySelectorAll('[data-slot="interval-dot-current"]')).toHaveLength(0);
  });

  it('reads the metric option: citation compares the cited cells', async () => {
    serve(NOW, BEFORE);
    renderCard('citation');
    const list = await rowsList();
    const [chatgpt] = within(list).getAllByRole('listitem');
    // ChatGPT cited 2 of 16 now and 4 of 16 before
    expect(chatgpt).toHaveTextContent('12.5%, 2 of 16 answers');
    expect(chatgpt).toHaveTextContent('25.0%, 4 of 16 answers');
  });

  it('says "Too few answers to compare" for an engine under 4 answers in a window, never a rate', async () => {
    serve(
      windowOf([{ mentioned: [1, 3] }, { mentioned: [2, 8] }], [{ mentioned: [0, 0] }, { mentioned: [4, 8] }]),
      BEFORE,
    );
    renderCard();
    const list = await rowsList();
    const [chatgpt, gemini] = within(list).getAllByRole('listitem');
    expect(chatgpt).toHaveTextContent('Too few answers to compare');
    expect(chatgpt?.querySelector('[data-slot="interval-dot-current"]')).toBeNull();
    expect(gemini?.querySelector('[data-slot="interval-dot-current"]')).not.toBeNull();
  });

  it('colours a change only when it is detectable', async () => {
    serve(
      // ChatGPT goes from 0 of 16 to 16 of 16 answers; Gemini from 8 of 16 to 9 of 16 (each pair is one prompt)
      windowOf([{ mentioned: [8, 8] }, { mentioned: [4, 8] }], [{ mentioned: [8, 8] }, { mentioned: [5, 8] }]),
      windowOf([{ mentioned: [0, 8] }, { mentioned: [4, 8] }], [{ mentioned: [0, 8] }, { mentioned: [4, 8] }]),
    );
    renderCard();
    const list = await rowsList();
    const [chatgpt, gemini] = within(list).getAllByRole('listitem');
    expect(chatgpt?.querySelector('[data-slot="interval-change-dot"]')?.className).toContain('bg-positive-solid');
    expect(gemini?.querySelector('[data-slot="interval-change-dot"]')?.className).toContain('bg-chart-reference');
  });

  it('names the previous period and says the interval is of the pooled answers, in an unpaired test', async () => {
    serve(NOW, BEFORE);
    renderCard();
    await rowsList();
    const frame = await frameOf();
    expect(frame).toHaveTextContent('Sep 18 to Oct 15, 2026');
    expect(frame).toHaveTextContent('unpaired');
    // The dot is the change of the prompt weighted rates, so it can sit outside the interval of the pooled answers
    expect(frame).toHaveTextContent(
      'The dot is the change of the prompt weighted rates, so it can sit outside the interval of the pooled answers.',
    );
  });

  it('asks for no summary while it is not live (customize mode)', async () => {
    const seen: URL[] = [];
    server.use(
      http.get(SUMMARY, ({ request }) => {
        seen.push(new URL(request.url));
        return undefined;
      }),
    );
    function Paused(props: CardProps): ReactElement {
      return <PeriodComparisonCard {...props} options={{}} live={false} />;
    }
    renderCard(undefined, WINDOW, Paused);
    await frameOf();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(seen).toHaveLength(0);
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
    const frame = await frameOf();
    expect(frame).toHaveAttribute('aria-busy', 'true');
    expect(frame.querySelector('div[style*="height: 180px"]')).not.toBeNull();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(frame).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('has a Table view with both rates and their counts, and a CSV with the same words', async () => {
    serve(NOW, BEFORE);
    const { user } = renderCard();
    await rowsList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Previous', 'Current', 'Change', '95% interval']);
    const [first] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('37.5%, 6 of 16 answers');
    expect(first).toHaveTextContent('62.5%, 10 of 16 answers');
    await user.click(screen.getByRole('button', { name: `More actions for ${TITLE}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Engine,Previous,Current,Change,95% interval');
    expect(text).toContain('"37.5%, 6 of 16 answers"');
  });

  it('registers an export block, one row per engine, an unknown value empty and a status that says why', async () => {
    serve(
      windowOf([{ mentioned: [1, 3] }, { mentioned: [2, 8] }], [{ mentioned: [0, 0] }, { mentioned: [4, 8] }]),
      BEFORE,
    );
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <PeriodComparisonCard {...props} options={{}} />
        </ExportProvider>
      );
    }
    renderCard(undefined, WINDOW, Wrapped);
    await rowsList();
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'engine',
      'metric',
      'before_percent',
      'before_k',
      'before_n',
      'now_percent',
      'now_k',
      'now_n',
      'change_points',
      'interval_low_points',
      'interval_high_points',
      'detectable',
      'status',
    ]);
    const [thin, ok] = block?.rows ?? [];
    expect(thin?.[0]).toBe('chatgpt_web');
    // No rate, no count of successes and no change; the valid answers that are known stay, so the file says why
    expect(thin?.slice(2, 12)).toEqual([null, null, 16, null, null, 3, null, null, null, null]);
    expect(thin?.[12]).toBe('insufficient');
    expect(ok?.[12]).toBe('ok');
  });

  it('says the comparison is off and how to turn it on', async () => {
    serve(NOW, BEFORE);
    renderCard(undefined, `${WINDOW}&cmp=off`);
    expect(await screen.findByText('The comparison is off')).toBeInTheDocument();
    expect(
      screen.getByText('Turn on the comparison with the previous period to see what changed.'),
    ).toBeInTheDocument();
  });

  it('says there is nothing to compare with when the window before has no answers', async () => {
    serve(NOW, windowOf([{}, {}], [{}, {}]));
    renderCard();
    expect(await screen.findByText('No answers in the previous 28 days')).toBeInTheDocument();
  });

  it('shows its own error with Retry when the window before cannot be read', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? failing('req-compare') : undefined,
      ),
    );
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    serve(NOW, BEFORE);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowsList()).toBeInTheDocument();
  });

  it('axe finds no violation, in either view and for share of voice', async () => {
    serve(NOW, BEFORE);
    const { user, container } = renderCard();
    await rowsList();
    await waitFor(async () => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
