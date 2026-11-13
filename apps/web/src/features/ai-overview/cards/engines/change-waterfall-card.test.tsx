import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChangeWaterfallCard from './change-waterfall-card';
import { engineCells, promptRow, summaryOf, type Counts } from './engines-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import * as csvWrite from '@/lib/csv/csv-write';
import { formatPercent, formatPointsDelta } from '@/lib/format';
import { engineRates } from '@/lib/rates/strip-model';
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

const TYPE = 'ai.change_waterfall';
const TITLE = 'What moved the rate';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PREVIOUS_TO = '2026-10-15';

interface Prompt {
  id: string;
  mentioned: Counts;
  cited?: Counts;
}

const rowOf = ({ id, mentioned, cited }: Prompt): ReturnType<typeof promptRow> =>
  promptRow(
    id,
    [
      engineCells('chatgpt_web', { mentioned, ...(cited === undefined ? {} : { cited }) }),
      engineCells('gemini_web', {}),
    ],
    { text: `Text ${id}` },
  );

function serve(now: readonly Prompt[], before: readonly Prompt[]): void {
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const rows = new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? before : now;
      return HttpResponse.json({ data: summaryOf(rows.map(rowOf), { codes: ['chatgpt_web', 'gemini_web'] }) });
    }),
  );
}

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

function withOptions(options: Record<string, string>): (props: CardProps) => ReactElement {
  return function Options(props: CardProps): ReactElement {
    return <ChangeWaterfallCard {...props} options={options} />;
  };
}

function renderCard(
  options: Record<string, string> = {},
  search: string = WINDOW,
  card?: (props: CardProps) => ReactElement,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(cardInOverview({ type: TYPE, Card: card ?? withOptions(options) }), {
    searchParams: search,
  });
}

const rowsList = (): Promise<HTMLElement> => screen.findByRole('list', { name: TITLE });
const frameOf = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};
const barOf = (list: HTMLElement, id: string): string =>
  list.querySelector(`[data-bar="${id}"] [data-slot="waterfall-bar"]`)?.className ?? 'no bar';

// The window pair of the model test: a up, b down, c with too few answers, d unchanged, g left, e added
const BEFORE: Prompt[] = [
  { id: 'a', mentioned: [2, 8] },
  { id: 'b', mentioned: [6, 8] },
  { id: 'c', mentioned: [1, 2] },
  { id: 'd', mentioned: [4, 4] },
  { id: 'g', mentioned: [3, 4] },
];
const NOW: Prompt[] = [
  { id: 'a', mentioned: [6, 8] },
  { id: 'b', mentioned: [2, 8] },
  { id: 'c', mentioned: [2, 2] },
  { id: 'd', mentioned: [4, 4] },
  { id: 'e', mentioned: [3, 4] },
];

// Many answers, so that the change is larger than normal variation
const MANY_BEFORE: Prompt[] = [
  ...['a', 'b', 'c', 'd'].map((id): Prompt => ({ id, mentioned: [2, 8] })),
  { id: 'e', mentioned: [6, 8] },
];
const MANY_NOW: Prompt[] = [
  ...['a', 'b', 'c', 'd'].map((id): Prompt => ({ id, mentioned: [6, 8] })),
  { id: 'e', mentioned: [2, 8] },
];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  vi.mocked(csvWrite.downloadBlob).mockClear();
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the what moved the rate card', () => {
  it('has six rows in order with signed labels: start, rose, fell, too few answers, prompt set changed, end', async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-bar'))).toEqual([
      'start',
      'rose',
      'fell',
      'tooFew',
      'setChanged',
      'end',
    ]);
    // Each row is read once, from its own words: the bar is for the eye
    expect(rows[0]).toHaveTextContent('Previous period: 65.0%, 16 of 26 answers, 5 prompts');
    expect(rows[1]).toHaveTextContent(`Prompts that rose: ${formatPointsDelta(0.125)}, 1 prompt up`);
    expect(rows[2]).toHaveTextContent(`Prompts that fell: ${formatPointsDelta(-0.125)}, 1 prompt down`);
    expect(rows[3]).toHaveTextContent(`Too few answers: ${formatPointsDelta(0.125)}, 1 prompt with too few answers`);
    expect(rows[4]).toHaveTextContent(`Prompt set changed: ${formatPointsDelta(-0.025)}, 1 added and 1 left`);
    expect(rows[5]).toHaveTextContent('This period: 75.0%, 17 of 26 answers, 5 prompts');
  });

  it("starts and ends at the strip's own rates, with the counts behind them (R12)", async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    const strip = (prompts: Prompt[]) => engineRates(prompts.map(rowOf), 'chatgpt_web').mentioned;
    const [start, end] = [strip(BEFORE), strip(NOW)];
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(formatPercent(start.value));
    expect(rows[0]).toHaveTextContent(`${String(start.successes)} of ${String(start.answers)} answers`);
    expect(rows[5]).toHaveTextContent(formatPercent(end.value));
    expect(rows[5]).toHaveTextContent(`${String(end.successes)} of ${String(end.answers)} answers`);
  });

  it('carries the prompt counts of each part', async () => {
    serve(MANY_NOW, MANY_BEFORE);
    renderCard();
    const list = await rowsList();
    const rows = within(list).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('4 prompts up');
    expect(rows[2]).toHaveTextContent('1 prompt down');
  });

  it('colours the contribution bars when the total change is detectable, and the ends never', async () => {
    serve(MANY_NOW, MANY_BEFORE);
    renderCard();
    const list = await rowsList();
    expect(barOf(list, 'rose')).toContain('bg-positive-solid');
    expect(barOf(list, 'fell')).toContain('bg-negative-solid');
    expect(barOf(list, 'start')).toContain('bg-chart-reference');
    expect(barOf(list, 'end')).toContain('bg-chart-reference');
  });

  it('keeps every contribution bar neutral while the total change is within normal variation', async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    for (const id of ['rose', 'fell', 'tooFew', 'setChanged']) {
      expect(barOf(list, id)).toContain('bg-chart-other');
      expect(barOf(list, id)).not.toContain('solid');
    }
    expect(barOf(list, 'start')).toContain('bg-chart-reference');
  });

  it('places the bars by percent of the track and holds no string of its own', async () => {
    serve(NOW, BEFORE);
    renderCard();
    const list = await rowsList();
    const bars = [...list.querySelectorAll<HTMLElement>('[data-slot="waterfall-bar"]')];
    expect(bars).toHaveLength(6);
    for (const bar of bars) {
      expect(bar.style.left).toMatch(/^\d+(\.\d+)?%$/);
      expect(bar.style.width).toMatch(/^\d+(\.\d+)?%$/);
    }
  });

  it('names the largest prompt of a part in the tooltip', async () => {
    serve(MANY_NOW, MANY_BEFORE);
    const { user } = renderCard();
    const list = await rowsList();
    const trigger = list.querySelector('[data-bar="rose"]')?.firstElementChild;
    if (!(trigger instanceof HTMLElement)) throw new Error('The row has no trigger');
    await user.hover(trigger);
    expect(await screen.findByText(`Largest change: Text a, ${formatPointsDelta(0.5)}`)).toBeInTheDocument();
  });

  it('reads the citation rate when the metric option says so, over the cited cells', async () => {
    serve(
      [
        { id: 'a', mentioned: [4, 8], cited: [6, 8] },
        { id: 'b', mentioned: [4, 8], cited: [4, 8] },
      ],
      [
        { id: 'a', mentioned: [4, 8], cited: [2, 8] },
        { id: 'b', mentioned: [4, 8], cited: [4, 8] },
      ],
    );
    renderCard({ metric: 'citation' });
    const list = await rowsList();
    const rows = within(list).getAllByRole('listitem');
    // Citation: 62.5% now from 37.5%, and the mention rate would have been 50% both times
    expect(rows[0]).toHaveTextContent('37.5%');
    expect(rows[5]).toHaveTextContent('62.5%');
    expect(rows[1]).toHaveTextContent('1 prompt up');
  });

  it('has a Table view with value, prompts and the largest change, and a CSV with the same words', async () => {
    serve(MANY_NOW, MANY_BEFORE);
    const { user } = renderCard();
    await rowsList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Step', 'Value', 'Prompts', 'Largest change']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[1]).toHaveTextContent('Prompts that rose');
    expect(rows[1]).toHaveTextContent('Text a');
    await user.click(screen.getByRole('button', { name: `More actions for ${TITLE}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    expect(await blob.text()).toContain('Step,Value,Prompts,Largest change');
  });

  it('registers an export block with the raw value of each step', async () => {
    serve(NOW, BEFORE);
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <ChangeWaterfallCard {...props} options={{}} />
        </ExportProvider>
      );
    }
    renderCard({}, WINDOW, Wrapped);
    await rowsList();
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'engine',
      'metric',
      'step',
      'rate_percent',
      'change_points',
      'prompts',
      'largest_prompt',
      'largest_change_points',
    ]);
    expect(block?.rows.map((row) => row[2])).toEqual(['start', 'rose', 'fell', 'tooFew', 'setChanged', 'end']);
    expect(block?.rows[0]?.slice(0, 4)).toEqual(['chatgpt_web', 'mention', 'start', 65]);
    expect(block?.rows[5]?.[3]).toBe(75);
  });

  it('says the comparison is off and how to turn it on', async () => {
    serve(NOW, BEFORE);
    renderCard({}, `${WINDOW}&cmp=off`);
    expect(await screen.findByText('The comparison is off')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says there is nothing to compare with when the window before has no answers', async () => {
    serve(NOW, [{ id: 'a', mentioned: [0, 0] }]);
    renderCard();
    expect(await screen.findByText('No answers in the previous 28 days')).toBeInTheDocument();
  });

  it('is empty, not a waterfall, when a window has fewer than 4 valid answers', async () => {
    serve([{ id: 'a', mentioned: [1, 3] }], BEFORE);
    renderCard();
    expect(await screen.findByText('Too few answers to explain the change')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says the engine is not shown when the option names an engine that is off', async () => {
    serve(NOW, BEFORE);
    renderCard({ engine: 'google_ai_mode' });
    expect(await screen.findByText('AI Mode is not shown on this page')).toBeInTheDocument();
  });

  it('shows its own error with Retry when the window before cannot be read, and Retry reads again', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? failing('req-waterfall') : undefined,
      ),
    );
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    serve(NOW, BEFORE);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowsList()).toBeInTheDocument();
  });

  it('says in the footnote that the bars add up and what the remainder is', async () => {
    serve(NOW, BEFORE);
    renderCard();
    await rowsList();
    expect(await frameOf()).toHaveTextContent('The bars add up to the change');
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
      return <ChangeWaterfallCard {...props} options={{}} live={false} />;
    }
    renderCard({}, WINDOW, Paused);
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
    expect(frame.querySelector('div[style*="height: 240px"]')).not.toBeNull();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(frame).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('axe finds no violation, in either view', async () => {
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
