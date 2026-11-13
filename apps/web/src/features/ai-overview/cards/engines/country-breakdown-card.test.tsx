import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ComponentType, ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CountryBreakdownCard from './country-breakdown-card';
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

const TYPE = 'ai.country_breakdown';
const TITLE = 'By country';
const WINDOW = 'from=2026-10-16&to=2026-11-12';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PROMPTS = '*/api/v1/workspaces/:w/projects/:p/prompts';

const failing = (requestId: string): ReturnType<typeof HttpResponse.json> =>
  HttpResponse.json(
    { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: requestId },
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  );

type Counts = readonly [k: number, n: number];

/** A prompt with its mention counts on ChatGPT and Gemini; `null` is an engine with no cell. */
const prompt = (
  id: string,
  chatgpt: Counts | null,
  gemini: Counts | null,
  extra: { cited?: Counts; shareOfVoice?: Counts } = {},
): PromptSummaryRow =>
  promptRow(id, [
    ...(chatgpt === null
      ? []
      : [
          engineCells('chatgpt_web', {
            mentioned: [chatgpt[0], chatgpt[1], chatgpt[1]],
            ...(extra.cited === undefined ? {} : { cited: [extra.cited[0], extra.cited[1], extra.cited[1]] }),
            ...(extra.shareOfVoice === undefined
              ? {}
              : { shareOfVoice: [extra.shareOfVoice[0], extra.shareOfVoice[1], extra.shareOfVoice[1]] }),
          }),
        ]),
    ...(gemini === null ? [] : [engineCells('gemini_web', { mentioned: [gemini[0], gemini[1], gemini[1]] })]),
  ]);

/** The summary of each country as the request names it (`filter[country_iso]`); a country not listed has no prompt. */
function serveCountries(byCountry: Readonly<Record<string, readonly PromptSummaryRow[]>>): URL[] {
  const seen: URL[] = [];
  server.use(
    http.get(SUMMARY, ({ request }) => {
      const url = new URL(request.url);
      seen.push(url);
      const rows = byCountry[url.searchParams.get('filter[country_iso]') ?? ''] ?? [];
      return HttpResponse.json({ data: summaryOf(rows, { codes: ['chatgpt_web', 'gemini_web'] }) });
    }),
  );
  return seen;
}

/** The markets of the project, as the prompts list carries them. */
function serveMarkets(codes: readonly string[]): void {
  server.use(
    http.get(PROMPTS, () =>
      HttpResponse.json({
        data: codes.map((code) => ({ country_iso: code })),
        page: { has_more: false, next_cursor: null, limit: 200 },
      }),
    ),
  );
}

const renderCard = (
  search: string = WINDOW,
  Card: ComponentType<CardProps> = CountryBreakdownCard,
): ReturnType<typeof renderWithProviders> =>
  renderWithProviders(cardInOverview({ type: TYPE, Card }), { searchParams: search });

const section = async (): Promise<HTMLElement> => {
  const found = (await screen.findByRole('heading', { name: TITLE })).closest('section');
  if (found === null) throw new Error('The card has no frame');
  return found;
};

const spoken = (list: HTMLElement): (string | null)[] =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('.sr-only')?.textContent ?? null);

const GERMANY = [prompt('d1', [4, 8], [2, 5], { cited: [2, 8], shareOfVoice: [6, 10] })];
const INDIA = [prompt('i1', [1, 3], null)];

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(csvWrite.downloadBlob).mockClear();
});

describe('CountryBreakdownCard', () => {
  it('shows Germany with its rows and India, which has one prompt, with its real figures and the sample said, never as 0', async () => {
    renderCard();
    const frame = await section();
    const india = await within(frame).findByRole('list', { name: 'Mention rate by engine in India' });
    expect(within(frame).getByRole('heading', { level: 3, name: 'Germany' })).toBeInTheDocument();
    expect(within(frame).getByRole('heading', { level: 3, name: 'India' })).toBeInTheDocument();
    // The Hindi prompt has 7 valid answers on ChatGPT and 8 on Gemini: a rate is read, over one prompt
    const [chatgpt, gemini] = spoken(india);
    expect(chatgpt).toMatch(/^ChatGPT: \d+%, \d+ of 7 answers, 1 prompt$/);
    expect(gemini).toMatch(/^Gemini: \d+%, \d+ of 8 answers, 1 prompt$/);
    expect(within(frame).getByText('1 prompt in this scope')).toBeInTheDocument();
    const germany = within(frame).getByRole('list', { name: 'Mention rate by engine in Germany' });
    expect(spoken(germany)).toHaveLength(2);
  });

  it('reads a country with too few answers as its answers and a country without any as unknown, never as 0%', async () => {
    serveCountries({ DE: [prompt('d1', [1, 3], null)], IN: GERMANY });
    renderCard();
    const frame = await section();
    const germany = await within(frame).findByRole('list', { name: 'Mention rate by engine in Germany' });
    expect(spoken(germany)).toEqual(['ChatGPT: 3 answers, too few for a rate', 'Gemini: No answers']);
    expect(germany).not.toHaveTextContent('0%');
    expect(germany.querySelectorAll('[data-slot="bar-list-bar"]')).toHaveLength(0);
  });

  it('draws every group on one scale: the same rate is the same bar length in every country', async () => {
    serveCountries({ DE: GERMANY, IN: GERMANY });
    renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Mention rate by engine in India' });
    const widths = [...frame.querySelectorAll<HTMLElement>('[data-slot="bar-list-bar"]')].map((bar) => bar.style.width);
    // ChatGPT 4 of 8 (50%) and Gemini 2 of 5 (40%), in both countries, on a scale from 0 to 100%
    expect(widths).toEqual(['50%', '40%', '50%', '40%']);
  });

  it.each([
    ['citation', 'Citation rate', ['ChatGPT: 25%, 2 of 8 answers, 1 prompt']],
    ['share_of_voice', 'Share of voice', ['ChatGPT: 60%, 10 answers that name a brand, 1 prompt']],
  ] as const)('shows the %s of the option in place of the mention rate', async (metric, label, rows) => {
    serveCountries({ DE: GERMANY, IN: GERMANY });
    function WithMetric(props: CardProps): ReactElement {
      return <CountryBreakdownCard {...props} options={{ metric }} />;
    }
    renderCard(WINDOW, WithMetric);
    const frame = await section();
    const list = await within(frame).findByRole('list', { name: `${label} by engine in Germany` });
    expect(spoken(list).slice(0, rows.length)).toEqual(rows);
  });

  it('ignores the country filter of the page, reads every country, and says so in the meta line', async () => {
    const seen = serveCountries({ DE: GERMANY, IN: INDIA });
    renderCard(`${WINDOW}&country=IN`);
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Mention rate by engine in Germany' });
    expect(within(frame).getByRole('list', { name: 'Mention rate by engine in India' })).toBeInTheDocument();
    expect(frame).toHaveTextContent(/country filter of this page is not applied/);
    // The page is on India, and Germany is read all the same
    expect(new Set(seen.map((url) => url.searchParams.get('filter[country_iso]')))).toEqual(new Set(['DE', 'IN']));
  });

  it('names the window and the branded choice in the meta line, and says how a rate is read in the footnote', async () => {
    serveCountries({ DE: GERMANY, IN: INDIA });
    renderCard();
    const frame = await section();
    await waitFor(() => {
      expect(frame).toHaveTextContent(/2 prompts.*branded prompts left out/);
    });
    expect(frame).toHaveTextContent(/A rate needs 4 or more valid answers/);
  });

  it('is empty, and teaches, when the project asks in one country', async () => {
    serveMarkets(['DE']);
    serveCountries({ DE: GERMANY });
    renderCard();
    expect(await screen.findByText('This project asks in one country')).toBeInTheDocument();
    expect(screen.getByText('Compare markets by adding prompts for another country.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Topics and prompts' }).getAttribute('href')).toContain('/prompts');
  });

  it('shows the 8 countries with the most prompts and counts the rest in the footnote', async () => {
    const codes = ['DE', 'IN', 'FR', 'ES', 'IT', 'NL', 'PL', 'SE', 'NO', 'DK'];
    serveMarkets(codes);
    serveCountries(
      Object.fromEntries(
        codes.map((code, index) => [
          code,
          Array.from({ length: index + 1 }, (_, count) => prompt(`${code}${String(count)}`, [4, 8], [2, 5])),
        ]),
      ),
    );
    renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Mention rate by engine in Denmark' });
    expect(within(frame).getAllByRole('heading', { level: 3 })).toHaveLength(8);
    expect(within(frame).queryByRole('heading', { level: 3, name: 'Germany' })).not.toBeInTheDocument();
    expect(frame).toHaveTextContent('2 more countries are not shown');
  });

  it('leaves the other country and gives the one that failed its own Retry', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) => {
        const country = new URL(request.url).searchParams.get('filter[country_iso]');
        if (country === 'IN') return failing('req-india');
        return HttpResponse.json({
          data: summaryOf(country === 'DE' ? GERMANY : [], { codes: ['chatgpt_web', 'gemini_web'] }),
        });
      }),
    );
    const { user } = renderCard();
    const frame = await section();
    expect(await within(frame).findByText('Could not load India')).toBeInTheDocument();
    expect(within(frame).getByRole('list', { name: 'Mention rate by engine in Germany' })).toBeInTheDocument();
    expect(within(frame).getAllByText(/req-india/).length).toBeGreaterThan(0);
    serveCountries({ DE: GERMANY, IN: INDIA });
    await user.click(within(frame).getByRole('button', { name: 'Try again' }));
    expect(await within(frame).findByRole('list', { name: 'Mention rate by engine in India' })).toBeInTheDocument();
  });

  it('keeps Germany on screen and shows India as retrying, not a card-wide skeleton, while the failed country is read again', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) => {
        const country = new URL(request.url).searchParams.get('filter[country_iso]');
        if (country === 'IN') return failing('req-india');
        return HttpResponse.json({
          data: summaryOf(country === 'DE' ? GERMANY : [], { codes: ['chatgpt_web', 'gemini_web'] }),
        });
      }),
    );
    const { user } = renderCard();
    const frame = await section();
    await within(frame).findByText('Could not load India');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.resetHandlers();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        const country = new URL(request.url).searchParams.get('filter[country_iso]');
        if (country === 'IN') await gate;
        return HttpResponse.json({
          data: summaryOf(country === 'DE' ? GERMANY : INDIA, { codes: ['chatgpt_web', 'gemini_web'] }),
        });
      }),
    );
    await user.click(within(frame).getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(within(frame).getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
    });
    expect(frame.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(within(frame).getByRole('list', { name: 'Mention rate by engine in Germany' })).toBeInTheDocument();
    expect(within(frame).getByText('Could not load India')).toBeInTheDocument();
    expect(within(frame).getAllByText(/req-india/).length).toBeGreaterThan(0);
    act(() => {
      release();
    });
    expect(await within(frame).findByRole('list', { name: 'Mention rate by engine in India' })).toBeInTheDocument();
    expect(within(frame).getByRole('list', { name: 'Mention rate by engine in Germany' })).toBeInTheDocument();
  });

  it('shows no group of its own for the page country when no prompt asks in it', async () => {
    serveMarkets(['DE']);
    serveCountries({ DE: GERMANY });
    renderCard(`${WINDOW}&country=IN`);
    expect(await screen.findByText('This project asks in one country')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'India' })).not.toBeInTheDocument();
  });

  it('the Table view lists every country and engine with its counts and the CSV matches', async () => {
    serveCountries({ DE: GERMANY, IN: INDIA });
    const { user } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Mention rate by engine in India' });
    await user.click(within(frame).getByRole('button', { name: 'Table' }));
    const table = within(frame).getByRole('table', { name: 'Mention rate by country and engine' });
    expect(within(table).getAllByRole('row')).toHaveLength(1 + 4);
    expect(table).toHaveTextContent('Germany');
    expect(table).toHaveTextContent('4 of 8 answers');
    await user.click(within(frame).getByRole('button', { name: /More actions/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    expect(name).toBe('by-country.csv');
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Country,Engine,Mention rate,Answers,Prompts');
    expect(text).toContain('Germany,ChatGPT,50%,4 of 8 answers,1');
    expect(text).toContain('India,ChatGPT,3 answers,3 answers,1');
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
    expect(frame.querySelector('div[style*="height: 240px"]')).not.toBeNull();
    act(() => {
      release();
    });
    await waitFor(() => {
      expect(frame).not.toHaveAttribute('aria-busy', 'true');
    });
  });

  it('shows an error with Retry and the error id when the page read fails, and Retry reads again', async () => {
    server.use(http.get(SUMMARY, () => failing('req-country')));
    const { user } = renderCard();
    expect(await screen.findByText(`Could not load ${TITLE}`)).toBeInTheDocument();
    expect(screen.getAllByText(/req-country/).length).toBeGreaterThan(0);
    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Mention rate by engine in Germany' })).toBeInTheDocument();
  });

  it('keeps the groups and says the figures are stale when a later read fails', async () => {
    serveCountries({ DE: GERMANY, IN: INDIA });
    const { queryClient } = renderCard();
    const frame = await section();
    await within(frame).findByRole('list', { name: 'Mention rate by engine in India' });
    server.use(http.get(SUMMARY, () => failing('req-later')));
    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(await within(frame).findByText('Stale: these are the last figures read')).toBeInTheDocument();
    expect(within(frame).getByRole('list', { name: 'Mention rate by engine in Germany' })).toBeInTheDocument();
  });

  it('registers its Table view as an export block under the item id, with empty unknown cells and a status', async () => {
    serveCountries({ DE: GERMANY, IN: INDIA });
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <CountryBreakdownCard {...props} />
        </ExportProvider>
      );
    }
    renderCard(WINDOW, Wrapped);
    await waitFor(() => {
      expect(read().blocks).toHaveLength(1);
      expect(read().blocks[0]?.rows).toHaveLength(4);
    });
    const [block] = read().blocks;
    expect(block?.id).toBe(CARD_ID);
    expect(block?.header).toEqual([
      'country',
      'engine',
      'metric',
      'value',
      'successes',
      'answers',
      'prompts',
      'status',
    ]);
    expect(block?.rows[0]).toEqual(['DE', 'ChatGPT', 'mention', 50, 4, 8, 1, 'ok']);
    expect(block?.rows[2]).toEqual(['IN', 'ChatGPT', 'mention', null, 1, 3, 1, 'insufficient']);
    expect(block?.rows[3]).toEqual(['IN', 'Gemini', 'mention', null, null, null, null, 'no_answers']);
  });

  it('axe finds no violation', async () => {
    serveCountries({ DE: GERMANY, IN: INDIA });
    const { container } = renderCard();
    await screen.findByRole('list', { name: 'Mention rate by engine in India' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
