import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineCells, promptRow, summaryOf, type Counts } from './engines-fixtures';
import PromptMoversCard from './prompt-movers-card';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import * as csvWrite from '@/lib/csv/csv-write';
import { formatPointsDelta } from '@/lib/format';
import { differenceInterval } from '@/lib/stats';
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

const TYPE = 'ai.prompt_movers';
const TITLE = 'Prompt movers';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PREVIOUS_TO = '2026-10-15';

interface Prompt {
  id: string;
  text: string;
  chatgpt: Counts;
  gemini?: Counts;
}

const rowOf = ({ id, text, chatgpt, gemini }: Prompt): ReturnType<typeof promptRow> =>
  promptRow(
    id,
    [engineCells('chatgpt_web', { mentioned: chatgpt }), engineCells('gemini_web', { mentioned: gemini ?? [0, 0] })],
    { text },
  );

/** The summary of the window and of the one before, written as the mention counts of each prompt. */
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

/** The card with the options of the layout. */
function withOptions(options: Record<string, string>): (props: CardProps) => ReactElement {
  return function Options(props: CardProps): ReactElement {
    return <PromptMoversCard {...props} options={options} />;
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

// Detectable: 2 of 8 to 6 of 8; not detectable although large: 1 of 4 to 3 of 4
const UP: Prompt = { id: 'p1', text: 'Best CRM for startups', chatgpt: [6, 8] };
const UP_BEFORE: Prompt = { id: 'p1', text: 'Best CRM for startups', chatgpt: [2, 8] };
const BIG: Prompt = { id: 'p2', text: 'CRM with email sync', chatgpt: [3, 4] };
const BIG_BEFORE: Prompt = { id: 'p2', text: 'CRM with email sync', chatgpt: [1, 4] };
const DOWN: Prompt = { id: 'p3', text: 'CRM pricing compared', chatgpt: [1, 8] };
const DOWN_BEFORE: Prompt = { id: 'p3', text: 'CRM pricing compared', chatgpt: [7, 8] };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  vi.mocked(csvWrite.downloadBlob).mockClear();
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the prompt movers card', () => {
  it('draws diverging rows with a whisker, in the order of the size of the change', async () => {
    serve([BIG, UP, DOWN], [BIG_BEFORE, UP_BEFORE, DOWN_BEFORE]);
    renderCard();
    const list = await rowsList();
    const rows = within(list).getAllByRole('listitem');
    // 75 points down, 50 points up, then the 50 points of 4 answers (the tie reads in text order)
    expect(rows.map((row) => row.querySelector('span.truncate')?.textContent)).toEqual([
      'CRM pricing compared',
      'Best CRM for startups',
      'CRM with email sync',
    ]);
    expect((await frameOf()).querySelectorAll('[data-slot="interval-whisker"]')).toHaveLength(3);
  });

  it('takes its colour from the tone of formatMetricDelta only: a change that is not detectable stays neutral', async () => {
    serve([UP, BIG, DOWN], [UP_BEFORE, BIG_BEFORE, DOWN_BEFORE]);
    renderCard();
    const list = await rowsList();
    const fillOf = (label: string): string => {
      const row = within(list).getByText(label).closest('li');
      return row?.querySelector('[data-slot="interval-bar"]')?.className ?? 'no bar';
    };
    expect(fillOf('Best CRM for startups')).toContain('bg-positive-solid');
    expect(fillOf('CRM pricing compared')).toContain('bg-negative-solid');
    // 1 of 4 to 3 of 4 is 50 points, and within normal variation on so few answers
    expect(fillOf('CRM with email sync')).toContain('bg-chart-reference');
    expect(fillOf('CRM with email sync')).not.toContain('solid');
  });

  it('says in the tooltip the two rates, the change and the counts of both windows', async () => {
    serve([UP], [UP_BEFORE]);
    const { user } = renderCard();
    const list = await rowsList();
    const trigger = within(list).getByText('Best CRM for startups').closest('li')?.firstElementChild;
    if (!(trigger instanceof HTMLElement)) throw new Error('The row has no trigger');
    await user.hover(trigger);
    expect(await screen.findByText('25.0% to 75.0% (+50.0 pts), 2 of 8 then 6 of 8 answers')).toBeInTheDocument();
  });

  it('reads each row once, with the change, its interval and what the test found', async () => {
    serve([UP, BIG], [UP_BEFORE, BIG_BEFORE]);
    renderCard();
    const list = await rowsList();
    const interval = differenceInterval({ k: 6, n: 8 }, { k: 2, n: 8 });
    if (interval === null) throw new Error('No interval');
    const first = within(list).getAllByRole('listitem')[0];
    expect(first).toHaveTextContent(
      `Best CRM for startups: +50.0 pts, 95% interval ${formatPointsDelta(interval.low)} to ${formatPointsDelta(interval.high)}, a detectable change`,
    );
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('within normal variation');
  });

  it('counts the prompts left out in the footnote and says the windows are unpaired and the counts pooled', async () => {
    serve(
      [UP, { id: 'p4', text: 'Thin prompt', chatgpt: [1, 3] }, { id: 'p5', text: 'Other thin', chatgpt: [2, 8] }],
      [
        UP_BEFORE,
        { id: 'p4', text: 'Thin prompt', chatgpt: [2, 8] },
        { id: 'p5', text: 'Other thin', chatgpt: [2, 3] },
      ],
    );
    renderCard();
    await rowsList();
    const frame = await frameOf();
    expect(frame).toHaveTextContent('2 prompts are left out: fewer than 4 valid answers in one of the windows.');
    expect(frame).toHaveTextContent('unpaired');
    expect(frame).toHaveTextContent('pooled counts');
    expect(within(frame).queryByText('Thin prompt')).not.toBeInTheDocument();
  });

  it('links a row to the prompt when the drill gives a route', async () => {
    serve([UP], [UP_BEFORE]);
    renderCard();
    const list = await rowsList();
    const link = within(list).getByRole('link');
    const href = decodeURIComponent(link.getAttribute('href') ?? '');
    expect(href).toMatch(/^\/digibranders\/fynix\/ai\/prompts\?/);
    expect(href).toContain('inspect=prompt:p1');
  });

  it('shows the engine of the option, ChatGPT by default', async () => {
    serve(
      [
        { ...UP, gemini: [2, 8] },
        { ...DOWN, gemini: [8, 8] },
      ],
      [
        { ...UP_BEFORE, gemini: [6, 8] },
        { ...DOWN_BEFORE, gemini: [2, 8] },
      ],
    );
    renderCard({ engine: 'gemini_web' });
    const list = await rowsList();
    // On Gemini the first prompt fell and the second rose, the other way round from ChatGPT
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first?.querySelector('span.truncate')?.textContent).toBe('CRM pricing compared');
    expect(first?.querySelector('[data-slot="interval-bar"]')?.className).toContain('bg-positive-solid');
    expect(second?.querySelector('[data-slot="interval-bar"]')?.className).toContain('bg-negative-solid');
  });

  it('keeps Gaining only to the prompts that rose, and caps at the Rows option', async () => {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    const now = letters.map((id, index): Prompt => ({ id, text: `Prompt ${id}`, chatgpt: [8 - index, 8] }));
    const before = letters.map((id): Prompt => ({ id, text: `Prompt ${id}`, chatgpt: [2, 8] }));
    serve([...now, DOWN], [...before, DOWN_BEFORE]);
    renderCard({ direction: 'up', rows: '5' });
    const list = await rowsList();
    // Six prompts rose, five are shown, and the prompt that fell is not among them
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).queryByText('Prompt f')).not.toBeInTheDocument();
    expect(within(list).queryByText('CRM pricing compared')).not.toBeInTheDocument();
  });

  it('shows 8 rows with the Rows option 8, where 5 shows 5', async () => {
    const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const now = letters.map((id): Prompt => ({ id, text: `Prompt ${id}`, chatgpt: [6, 8] }));
    const before = letters.map((id): Prompt => ({ id, text: `Prompt ${id}`, chatgpt: [2, 8] }));
    serve(now, before);
    renderCard({ rows: '8' });
    const list = await rowsList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
  });

  it('is plain text, with the same words, where the drill gives no link', async () => {
    serve([UP], [UP_BEFORE]);
    // The Prompts page cannot show "branded prompts only": the drill answers null
    renderCard({}, `${WINDOW}&branded=only`);
    const list = await rowsList();
    expect(within(list).queryByRole('link')).toBeNull();
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Best CRM for startups: +50.0 pts');
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
      return <PromptMoversCard {...props} options={{}} live={false} />;
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

  it('has a Table view with the counts of both windows and a CSV with the same words', async () => {
    serve([UP, DOWN], [UP_BEFORE, DOWN_BEFORE]);
    const { user } = renderCard();
    await rowsList();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const table = await screen.findByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Prompt', 'Before', 'Now', 'Change', '95% interval']);
    const [first] = within(table).getAllByRole('row').slice(1);
    expect(first).toHaveTextContent('CRM pricing compared');
    expect(first).toHaveTextContent('87.5%, 7 of 8 answers');
    expect(first).toHaveTextContent('12.5%, 1 of 8 answers');
    await user.click(screen.getByRole('button', { name: `More actions for ${TITLE}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Prompt,Before,Now,Change,95% interval');
    expect(text).toContain('CRM pricing compared');
    expect(text).toContain('87.5%, 7 of 8 answers');
  });

  it('registers an export block with raw numbers, one row per prompt shown', async () => {
    serve([UP], [UP_BEFORE]);
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <PromptMoversCard {...props} options={{}} />
        </ExportProvider>
      );
    }
    renderCard({}, WINDOW, Wrapped);
    await rowsList();
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'prompt_id',
      'prompt',
      'engine',
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
    ]);
    expect(block?.rows[0]?.slice(0, 11)).toEqual([
      'p1',
      'Best CRM for startups',
      'chatgpt_web',
      25,
      2,
      8,
      75,
      6,
      8,
      50,
      expect.any(Number),
    ]);
  });

  it('says the comparison is off and how to turn it on, with no rows', async () => {
    serve([UP], [UP_BEFORE]);
    renderCard({}, `${WINDOW}&cmp=off`);
    expect(await screen.findByText('The comparison is off')).toBeInTheDocument();
    expect(
      screen.getByText('Turn on the comparison with the previous period to see what changed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: TITLE })).not.toBeInTheDocument();
  });

  it('says there is nothing to compare with when the window before has no answers', async () => {
    serve([UP], [{ id: 'p1', text: 'Best CRM for startups', chatgpt: [0, 0] }]);
    renderCard();
    expect(await screen.findByText('No answers in the previous 28 days')).toBeInTheDocument();
    expect(screen.getByText('There is nothing to compare with yet.')).toBeInTheDocument();
  });

  it('says no prompt can be compared when every prompt is under 4 valid answers in a window', async () => {
    serve([{ ...UP, chatgpt: [1, 3] }], [UP_BEFORE]);
    renderCard();
    expect(await screen.findByText('No prompt can be compared')).toBeInTheDocument();
    expect(screen.getByText('1 prompt has fewer than 4 valid answers in one of the windows.')).toBeInTheDocument();
  });

  it('says the engine is not shown when the option names an engine that is off', async () => {
    serve([UP], [UP_BEFORE]);
    renderCard({ engine: 'google_ai_mode' });
    expect(await screen.findByText('AI Mode is not shown on this page')).toBeInTheDocument();
  });

  it('shows its own error with Retry when the window before cannot be read, and Retry reads again', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? failing('req-movers') : undefined,
      ),
    );
    const { user } = renderCard();
    expect(await screen.findByText('Could not load Prompt movers')).toBeInTheDocument();
    expect(screen.getByText(/req-movers/)).toBeInTheDocument();
    serve([UP], [UP_BEFORE]);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await rowsList()).toBeInTheDocument();
  });

  it('axe finds no violation, in either view', async () => {
    serve([UP, BIG, DOWN], [UP_BEFORE, BIG_BEFORE, DOWN_BEFORE]);
    const { user, container } = renderCard();
    await rowsList();
    await waitFor(async () => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
