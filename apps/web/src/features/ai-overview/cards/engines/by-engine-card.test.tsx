import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ByEngineCard from './by-engine-card';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { ExportProvider, useExportBlocks, type ExportRead } from '../../export/export-registry';
import type { CardProps } from '@/features/layouts';
import type { PromptsSummary } from '@/lib/api/types';
import * as csvWrite from '@/lib/csv/csv-write';
import { formatPercent } from '@/lib/format';
import { engineRates } from '@/lib/rates/strip-model';
import { axe } from '@/test/axe';
import { cardInOverview } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
// Nothing is downloaded: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const WINDOW = 'from=2026-10-16&to=2026-11-12';
const TYPE = 'ai.by_engine';
const SUMMARY = '*/api/v1/workspaces/:w/projects/:p/ai/prompts-summary';
const PREVIOUS_TO = '2026-10-15';

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  vi.mocked(csvWrite.downloadBlob).mockClear();
  stubViewport();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (search: string = WINDOW, card: ReactElement = cardInOverview({ type: TYPE, Card: ByEngineCard })) =>
  renderWithProviders(card, { searchParams: search });

const tableOf = (): Promise<HTMLElement> => screen.findByRole('table', { name: 'AI by engine' });

const answers = (summary: PromptsSummary): Response => HttpResponse.json({ data: summary });

describe('the AI by engine card', () => {
  it('has a row per asked engine in catalog order, with the engine name, and no AI Mode (off)', async () => {
    render();
    const table = await tableOf();
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Mention', 'Citation', 'Share of voice', 'Own citation']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual(['ChatGPT', 'Gemini']);
  });

  it('writes the equal-weight line beside the rows: avg of 2, the engines named, each counted once', async () => {
    render();
    await tableOf();
    const section = screen.getByRole('heading', { name: 'AI by engine' }).closest('section') as HTMLElement;
    expect(section).toHaveTextContent(/avg of 2 \(ChatGPT and Gemini, each counted once\): Mention rate \d/);
  });

  it('says in the footnote that the mean of the prompts can sit outside the interval of the pooled answers', async () => {
    render();
    await tableOf();
    const section = screen.getByRole('heading', { name: 'AI by engine' }).closest('section') as HTMLElement;
    expect(section).toHaveTextContent('That mean can sit outside the interval of the pooled answers.');
  });

  it('names the prompts in the meta line but no pooled valid answers: each engine states its own counts', async () => {
    render();
    await tableOf();
    const section = screen.getByRole('heading', { name: 'AI by engine' }).closest('section') as HTMLElement;
    expect(section.textContent).toMatch(/\d[\d,]* prompts? · branded prompts left out, each prompt counts once/);
    expect(section.textContent).not.toMatch(/\d[\d,]* valid answers?/);
  });

  it('has no Recommendation column', async () => {
    const { user } = render();
    const table = await tableOf();
    expect(within(table).queryByRole('columnheader', { name: /Recommendation/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.queryByRole('columnheader', { name: /Recommendation/ })).not.toBeInTheDocument();
  });

  it('a thin cell says "3 answers" and has no percent', async () => {
    server.use(
      http.get(SUMMARY, () =>
        answers(
          summaryOf(
            [
              promptRow('p1', [
                engineCells('chatgpt_web', { mentioned: [1, 3], cited: [5, 10], shareOfVoice: [4, 8] }),
                engineCells('gemini_web', { mentioned: [4, 10], cited: [5, 10], shareOfVoice: [4, 8] }),
              ]),
            ],
            { codes: ['chatgpt_web', 'gemini_web'] },
          ),
        ),
      ),
    );
    render();
    const table = await tableOf();
    const chatgpt = within(table).getByRole('row', { name: /ChatGPT/ });
    const [mention, citation] = within(chatgpt).getAllByRole('cell');
    expect(mention).toHaveTextContent('3 answers');
    expect(mention?.textContent).not.toContain('%');
    expect(citation?.textContent).toContain('50.0%');
    // The thin engine is left out of the average, which then has one value and so no line
    const section = screen.getByRole('heading', { name: 'AI by engine' }).closest('section') as HTMLElement;
    expect(section.textContent).not.toMatch(/avg of \d \([^)]*\): Mention rate/);
  });

  it("the numbers equal the strip's for the same scope (R12)", async () => {
    const bodies: { data: PromptsSummary }[] = [];
    const listener = ({ response, request }: { response: Response; request: Request }): void => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/ai/prompts-summary') && url.searchParams.get('to') === '2026-11-12') {
        void response
          .clone()
          .json()
          .then((body: { data: PromptsSummary }) => bodies.push(body));
      }
    };
    server.events.on('response:mocked', listener);
    render();
    const table = await tableOf();
    await vi.waitFor(() => {
      expect(bodies.length).toBeGreaterThan(0);
    });
    server.events.removeListener('response:mocked', listener);
    const prompts = bodies[0]?.data.prompts ?? [];
    const strip = engineRates(prompts, 'chatgpt_web');
    const chatgpt = within(table).getByRole('row', { name: /ChatGPT/ });
    const [mention, citation, share] = within(chatgpt).getAllByRole('cell');
    expect(mention).toHaveTextContent(formatPercent(strip.mentioned.value));
    expect(mention).toHaveTextContent(`${String(strip.mentioned.successes)} of ${String(strip.mentioned.answers)}`);
    expect(citation).toHaveTextContent(formatPercent(strip.cited.value));
    expect(share).toHaveTextContent(formatPercent(strip.shareOfVoice.value));
  });

  it('links the engine to the Prompts page filtered to it', async () => {
    render();
    const table = await tableOf();
    const link = within(within(table).getByRole('row', { name: /Gemini/ })).getByRole('link', { name: 'Gemini' });
    expect(link.getAttribute('href')).toMatch(/^\/digibranders\/fynix\/ai\/prompts\?/);
    expect(link.getAttribute('href')).toContain('engine=gemini_web');
  });

  it('shows the partial notice and n/a deltas when the previous window cannot be read', async () => {
    server.use(
      http.get(SUMMARY, ({ request }) => {
        if (new URL(request.url).searchParams.get('to') !== PREVIOUS_TO) return undefined;
        return HttpResponse.json(
          { type: 'about:blank', title: 'Internal error', status: 500, code: 'internal_error', request_id: 'req-prev' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        );
      }),
    );
    render();
    const table = await tableOf();
    expect(await screen.findByText('Partial data: the previous window could not be read')).toBeInTheDocument();
    // No change is made up from a window that was not read
    expect(within(table).queryAllByText(/pts/)).toHaveLength(0);
  });

  it('a window with no valid answers says so, counts the answers that were not valid and offers View runs', async () => {
    server.use(
      http.get(SUMMARY, () =>
        answers(
          summaryOf(
            [
              promptRow('p1', [
                engineCells('chatgpt_web', { mentioned: [0, 0, 5] }),
                engineCells('gemini_web', { mentioned: [0, 0, 3] }),
              ]),
            ],
            { codes: ['chatgpt_web', 'gemini_web'] },
          ),
        ),
      ),
    );
    render();
    expect(await screen.findByText('No valid answers in these 28 days')).toBeInTheDocument();
    expect(screen.getByText('8 answers were not valid.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View runs' }).getAttribute('href')).toContain('/runs');
  });

  it('says own citation is not available while only branded prompts are shown, and never writes 0 for it', async () => {
    render(`${WINDOW}&branded=only`);
    const table = await tableOf();
    const own = within(within(table).getByRole('row', { name: /ChatGPT/ })).getAllByRole('cell')[3];
    expect(own).toHaveTextContent('n/a');
    expect(own).toHaveTextContent('Not available when only branded prompts are shown');
    expect(own?.textContent).not.toMatch(/\b0(\.0)?%/);
  });

  it('shows the reason own citation is n/a as visible text, not only to a screen reader', async () => {
    render(`${WINDOW}&branded=only`);
    const table = await tableOf();
    const own = within(within(table).getByRole('row', { name: /ChatGPT/ })).getAllByRole('cell')[3] as HTMLElement;
    const reason = within(own).getByText('Not available when only branded prompts are shown');
    expect(reason.closest('.sr-only')).toBeNull();
  });

  it('says what the share of voice count is: the answers that name a brand, as the tooltip does', async () => {
    render();
    const table = await tableOf();
    const chatgpt = within(table).getByRole('row', { name: /ChatGPT/ });
    const [mention, , share] = within(chatgpt).getAllByRole('cell');
    // The visible count line of the cell (the delta's tip carries its own words, so the line is read on its own)
    const lines = Array.from(share?.querySelectorAll('span') ?? []).map((node) => node.textContent ?? '');
    expect(lines.some((text) => /^[\d,]+ answers? that names? a brand$/.test(text))).toBe(true);
    expect(lines.some((text) => /^[\d,]+ answers$/.test(text))).toBe(false);
    // The mention count is over valid answers, and says so by its own form
    expect(mention?.textContent).toMatch(/\d[\d,]* of \d[\d,]* answers/);
  });

  it('the Table view adds k, n, prompts and the interval, and the CSV is the same words', async () => {
    const { user } = render();
    await tableOf();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const long = await screen.findByRole('table', { name: 'AI by engine' });
    expect(
      within(long)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Engine', 'Metric', 'Rate', 'Answers that count', 'Valid answers', 'Prompts', '95% interval', 'Change']);
    const rows = within(long).getAllByRole('row').slice(1);
    // ChatGPT: mention, citation, share of voice, own citation; then Gemini
    expect(rows).toHaveLength(8);
    const first = within(rows[0] as HTMLElement)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);
    expect(first[0]).toBe('Mention rate');
    expect(first[1]).toMatch(/^\d+(\.\d)?%$/);
    expect(first[2]).toMatch(/^\d+$/);
    expect(first[3]).toMatch(/^[\d,]+$/);

    await user.click(screen.getByRole('button', { name: 'More actions for AI by engine' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Download CSV' }));
    const [blob] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
    if (!(blob instanceof Blob)) throw new Error('No file was downloaded');
    const text = await blob.text();
    expect(text).toContain('Engine,Metric,Rate,Answers that count,Valid answers,Prompts,95% interval,Change');
    const lines = text.split('\n');
    const firstLine = lines[1] ?? '';
    expect(firstLine.startsWith('ChatGPT,Mention rate,')).toBe(true);
    // The percent, k and n of the table are the first cells of the file's row
    expect(firstLine).toContain(first[1] ?? 'missing');
  });

  it('registers the long table as an export block of the layout item, unknown values empty with a status', async () => {
    let read: () => ExportRead = () => ({ blocks: [], loading: 0 });
    function Reader(): ReactElement {
      read = useExportBlocks();
      return <></>;
    }
    function Wrapped(props: CardProps): ReactElement {
      return (
        <ExportProvider>
          <Reader />
          <ByEngineCard {...props} />
        </ExportProvider>
      );
    }
    render(`${WINDOW}&branded=only`, cardInOverview({ type: TYPE, Card: Wrapped }));
    await tableOf();
    const [block] = read().blocks;
    expect(block?.id).toBe('card-under-test');
    expect(block?.header).toEqual([
      'engine',
      'metric',
      'value_percent',
      'k',
      'n',
      'prompts',
      'interval_low_percent',
      'interval_high_percent',
      'change_points',
      'change_detectable',
      'status',
    ]);
    const own = block?.rows.find((row) => row[1] === 'ownCitation');
    expect(own?.slice(2, 5)).toEqual([null, null, null]);
    expect(own?.[10]).toBe('branded_only');
  });

  it('axe finds no violation, in either view', async () => {
    const { user, container } = render();
    await tableOf();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
