import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChangeSummaryCard from './change-summary-card';
import { engineCells, promptRow, summaryOf, type Counts } from './engines-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
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

const TYPE = 'ai.change_summary';
const TITLE = 'What changed';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const PREVIOUS_TO = '2026-10-15';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const CHANGES = '*/api/v1/workspaces/:w/projects/:p/ai/sources/changes';
const CODES = ['chatgpt_web', 'gemini_web'] as const;

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

const row = (id: string, chatgpt: Counts, gemini: Counts) =>
  promptRow(id, [engineCells('chatgpt_web', { mentioned: chatgpt }), engineCells('gemini_web', { mentioned: gemini })]);

/**
 * Five facts: Gemini and ChatGPT each have answers that were not valid, ChatGPT's mention rate moved detectably
 * (one prompt stopped naming the brand and one started), Gemini's did not, and five domains are new.
 */
const NOW = summaryOf([row('lost', [0, 900, 950], [5, 900, 1000]), row('gain', [700, 900, 950], [5, 900, 1000])], {
  codes: CODES,
});
const BEFORE = summaryOf([row('lost', [575, 900], [5, 900]), row('gain', [0, 900], [5, 900])], { codes: CODES });

const FIVE = [
  'On Gemini, 200 of 2,000 answers were not valid in these 28 days.',
  'On ChatGPT, 100 of 1,900 answers were not valid in these 28 days.',
  'ChatGPT mention rate is 38.9% (700 of 1,800 answers, 2 prompts), up 6.9 points from 31.9% (575 of 1,800 answers).',
  'On ChatGPT, 1 of 1 prompt that named you before no longer does, and 1 of 1 prompt that did not name you before now does.',
  '5 domains were cited for the first time, with at least 2 citation units each in these 28 days and none in the 28 days before.',
];

function serve(now: PromptsSummary = NOW, before: PromptsSummary = BEFORE, newSources: number | 'fail' = 5): void {
  server.use(
    http.get(SUMMARY, ({ request }) =>
      HttpResponse.json({ data: new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? before : now }),
    ),
    http.get(CHANGES, () =>
      newSources === 'fail'
        ? failing('req-new-sources')
        : HttpResponse.json({
            data: [],
            meta: { min_support: 2 },
            page: { limit: 1, offset: 0, total: newSources },
          }),
    ),
  );
}

/** The card with its Facts option set, as the layout would hand it over. */
const withFacts = (facts: '3' | '5') =>
  function Wrapped(props: CardProps): ReactElement {
    return <ChangeSummaryCard {...props} options={{ ...props.options, facts }} />;
  };

function renderCard(
  searchParams: string = WINDOW,
  Card: (props: CardProps) => ReactElement = ChangeSummaryCard,
): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(cardInOverview({ type: TYPE, Card, width: 'full' }), { searchParams });
}

const list = (): Promise<HTMLElement> => screen.findByRole('list', { name: TITLE });
const items = (ol: HTMLElement): string[] =>
  within(ol)
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
const section = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
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

describe('ChangeSummaryCard', () => {
  it('reads as plain text in reading order, one list item per fact', async () => {
    serve();
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toHaveLength(5);
    });
    expect(items(ol)).toEqual(FIVE);
  });

  it('links the engine change to the Prompts page with the engine, and leaves the other sentences as plain text', async () => {
    serve();
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(within(ol).getAllByRole('listitem')).toHaveLength(5);
    });
    const [collection, , change, gained, sources] = within(ol).getAllByRole('listitem');
    const link = within(change as HTMLElement).getByRole('link');
    expect(link.getAttribute('href')).toContain('/prompts?');
    expect(link.getAttribute('href')).toContain('engine=chatgpt_web');
    expect(link).toHaveTextContent('38.9% (700 of 1,800 answers, 2 prompts)');
    for (const plain of [collection, gained, sources])
      expect(within(plain as HTMLElement).queryByRole('link')).toBeNull();
  });

  it('cuts to the Facts option, says how many more there are, and the Table view lists every fact with its numbers', async () => {
    serve();
    const { user } = renderCard(WINDOW, withFacts('3'));
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toHaveLength(3);
    });
    expect(items(ol)).toEqual(FIVE.slice(0, 3));
    const frame = await section();
    expect(frame).toHaveTextContent('2 more facts are in the Table view.');

    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const table = await within(frame).findByRole('table', { name: TITLE });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Fact', 'Engine', 'Numbers', 'In the list']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    const cells = (index: number): string[] =>
      within(rows[index] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent ?? '');
    // The fact is the row header; its engine, numbers and whether it is in the list follow
    expect(rows.map((entry) => within(entry).getAllByRole('rowheader')[0]?.textContent)).toEqual(FIVE);
    expect(cells(2)).toEqual([
      'ChatGPT',
      '700 of 1,800 answers over 2 prompts, before 575 of 1,800, change +6.9 pts',
      'Yes',
    ]);
    expect(cells(3)).toEqual([
      'ChatGPT',
      'Lost 1 of 1, gained 1 of 1, 2 prompts compared, 0 left out for fewer than 4 valid answers',
      'No, cut by the Facts option',
    ]);
    expect(cells(4)[0]).toBe('All engines');
    expect(cells(4)[2]).toBe('No, cut by the Facts option');
  });

  it('shows the default of 5 facts and no "more" note when everything fits', async () => {
    serve();
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toHaveLength(5);
    });
    expect(await section()).not.toHaveTextContent('more fact');
  });

  it('downloads the Table view as CSV with the same words', async () => {
    serve();
    const { user } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(within(frame).getAllByRole('listitem')).toHaveLength(5);
    });
    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('what-changed.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text.split(/\r?\n/)[0]).toBe('Fact,Engine,Numbers,In the list');
    for (const sentence of FIVE) expect(text).toContain(sentence);
  });

  it('says there is no previous data in one sentence, and not in an empty frame, when the previous window has no answers', async () => {
    serve(
      NOW,
      summaryOf([promptRow('lost', [engineCells('chatgpt_web', {}), engineCells('gemini_web', {})])], { codes: CODES }),
    );
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toContain('There are no answers in the previous 28 days to compare with.');
    });
    // Nothing about a change is made up, and no source count is written beside a window with no answers
    expect(items(ol).filter((text) => /mention rate|named you|cited for the first time/.test(text))).toEqual([]);
    expect(screen.queryByText(/No prompts in this scope/)).toBeNull();
  });

  it('says the comparison is off, and nothing about change, when it is off', async () => {
    serve();
    renderCard(`${WINDOW}&cmp=off`);
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toContain('The comparison with the previous period is off, so nothing is said about change.');
    });
    expect(items(ol).filter((text) => /mention rate|named you|cited for the first time/.test(text))).toEqual([]);
  });

  it('says the previous window could not be read, and shows the partial notice, when that read fails', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) =>
        new URL(request.url).searchParams.get('to') === PREVIOUS_TO
          ? failing('req-previous')
          : HttpResponse.json({ data: NOW }),
      ),
    );
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toContain('The previous 28 days could not be read, so nothing is said about change.');
    });
    expect(await screen.findByText('Partial data: the previous window could not be read')).toBeInTheDocument();
  });

  it('writes no fact and shows no card error when the new sources read fails', async () => {
    serve(NOW, BEFORE, 'fail');
    renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toHaveLength(4);
    });
    expect(items(ol)).toEqual(FIVE.slice(0, 4));
    expect(screen.queryByText(`Could not load ${TITLE}`)).toBeNull();
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
    expect(frame.querySelector('div[style*="height: 140px"]')).not.toBeNull();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(frame).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('does not say "No facts to report" while the previous window is still being read', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        if (new URL(request.url).searchParams.get('to') === PREVIOUS_TO) await gate;
        return HttpResponse.json({ data: new URL(request.url).searchParams.get('to') === PREVIOUS_TO ? BEFORE : NOW });
      }),
      http.get(CHANGES, () =>
        HttpResponse.json({ data: [], meta: { min_support: 2 }, page: { limit: 1, offset: 0, total: 5 } }),
      ),
    );
    renderCard();
    const frame = await section();
    // The current window is read and drawn; the comparison is not paired yet
    await waitFor(() => {
      expect(frame).toHaveTextContent(/2 prompts, 3,600 valid answers/);
    });
    const spoken = (): string | null | undefined => frame.querySelector('p.sr-only')?.textContent;
    expect(spoken()).not.toBe('No facts to report.');
    expect(spoken()).toBe('Loading');
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(spoken()).toBe(FIVE[0]);
    });
  });

  it('shows an error with Retry and the error id, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-change')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-change/).length).toBeGreaterThan(0);
    serve();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await list()).toBeInTheDocument();
  });

  it('keeps the sentences and says the figures are stale when a later read fails', async () => {
    serve();
    const { queryClient } = renderCard();
    const ol = await list();
    await waitFor(() => {
      expect(items(ol)).toHaveLength(5);
    });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await screen.findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(items(ol)).toHaveLength(5);
  });

  it('is empty, and says to choose an engine, when the engine filter names an engine that is off', async () => {
    serve();
    renderCard(`${WINDOW}&engine=google_ai_mode`);
    expect(await screen.findByText('No engine to show')).toBeInTheDocument();
  });

  it('names the window, the prompts and the branded choice in its meta line', async () => {
    serve();
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/2 prompts, 3,600 valid answers.*branded prompts left out/);
    });
    expect(frame).toHaveTextContent('Oct 16');
  });

  it('offers How this is written', async () => {
    serve();
    renderCard();
    const frame = await section();
    expect(await within(frame).findByRole('button', { name: 'How this is written' })).toBeInTheDocument();
  });

  it('registers its facts as an export block under the item id, with empty cells for what a fact does not have', async () => {
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
          <ChangeSummaryCard {...props} options={{ ...props.options, facts: '3' }} />
        </ExportProvider>
      );
    }
    renderCard(WINDOW, Wrapped);
    await waitFor(() => {
      expect(read().blocks[0]?.rows).toHaveLength(5);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'kind',
      'engine',
      'in_list',
      'count',
      'of',
      'second_count',
      'second_of',
      'prompts',
      'left_out',
      'change_points',
      'days',
      'min_support',
    ]);
    expect(block?.rows[0]).toEqual([
      'collection',
      'gemini_web',
      'yes',
      200,
      2000,
      null,
      null,
      null,
      null,
      null,
      28,
      null,
    ]);
    expect(block?.rows[2]).toEqual([
      'engineChange',
      'chatgpt_web',
      'yes',
      700,
      1800,
      575,
      1800,
      2,
      null,
      6.94,
      null,
      null,
    ]);
    // Cut by the Facts option, and a source count has no engine
    expect(block?.rows[4]).toEqual(['newSources', null, 'no', 5, null, null, null, null, null, null, 28, 2]);
  });

  it('axe finds no violation, in either view', async () => {
    serve();
    const { user, container } = renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(within(frame).getAllByRole('listitem')).toHaveLength(5);
    });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
