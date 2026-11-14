import { screen, waitFor, within } from '@testing-library/react';
import { getResponse, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportBlock } from './export-model';
import * as csvWrite from '@/lib/csv/csv-write';
import { parseCsv } from '@/lib/csv/csv';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { overviewAs } from '@/test/ai-overview-harness';
import { stubViewport } from '@/test/customize-harness';
import { fakeCards } from '@/test/fake-overview-cards';
import { gate } from '@/test/gate';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('next/navigation', async () => (await import('@/test/next-navigation')).navigationModule);
// No card package draws anything here: each card is a stand-in that tells the export what the test says
vi.mock('../cards/registry', async () => (await import('@/test/fake-overview-cards')).fakeRegistryModule());
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csvWrite>()),
  downloadBlob: vi.fn(),
}));

const NOW = new Date('2026-11-12T12:00:00Z');
const SUMMARY = mswPath('/api/v1/workspaces/:w/projects/:p/ai/prompts-summary');

const FAILED = 'The file could not be made. Try again.';
const NOTE_UNKNOWN = 'An empty value means unknown, never zero. The status column says why a value is empty.';
const NOTE_POOLED =
  'For prompt weighted rates the value is the mean of each prompt’s rate; numerator and denominator are the pooled answer counts.';

beforeEach(() => {
  vi.setSystemTime(NOW);
  stubViewport();
  fakeCards.block = null;
  vi.mocked(csvWrite.downloadBlob).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const exportButton = (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Export' });

/** The file the last download handed to the browser, as rows of cells, and the name it was given. */
async function downloaded(): Promise<{ rows: string[][]; name: string }> {
  const [blob, name] = vi.mocked(csvWrite.downloadBlob).mock.calls[0] ?? [];
  if (!(blob instanceof Blob) || typeof name !== 'string') throw new Error('No file was downloaded');
  return { rows: parseCsv(await blob.text()), name };
}

/** Opens the Export menu and chooses Numbers (CSV) once it can be chosen. */
async function exportNumbers(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
  await user.click(await exportButton());
  const item = await screen.findByRole('menuitem', { name: 'Numbers (CSV)' });
  await waitFor(() => {
    expect(item).not.toHaveAttribute('aria-disabled', 'true');
  });
  await user.click(item);
}

const rowsOfBlock = (rows: string[][], id: string): string[][] => rows.filter((row) => row[0] === id);

describe('the Export menu of the AI visibility page', () => {
  it('is a labelled secondary button between Customize and More actions, and opens a menu with Numbers (CSV)', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const button = await exportButton();
    const customize = await screen.findByRole('button', { name: 'Customize' });
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(customize.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(button);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Numbers (CSV)' })).toBeInTheDocument();
  });

  it('opens with Enter, closes with Escape and hands focus back to the button', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const button = await exportButton();
    button.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Numbers (CSV)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    expect(button).toHaveFocus();
  });

  it('disables Numbers (CSV) with a reason while the summary has not been read, and enables it once it has', async () => {
    const release = gate();
    server.use(
      http.get(SUMMARY, async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    const { user } = renderWithProviders(overviewAs('admin'));
    await user.click(await exportButton());
    const item = await screen.findByRole('menuitem', { name: 'Numbers (CSV)' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('Available once the numbers have loaded');
    await user.click(item);
    expect(csvWrite.downloadBlob).not.toHaveBeenCalled();
    release.open();
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Numbers (CSV)' })).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('disables Numbers (CSV) on a project with no engine on, and says why', async () => {
    const { user } = renderWithProviders(overviewAs('admin', { world: 'cleanstart' }));
    await screen.findByRole('heading', { name: 'No AI engine is on' });
    await user.click(await exportButton());
    const item = await screen.findByRole('menuitem', { name: 'Numbers (CSV)' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('No AI engine is on');
  });

  it('downloads one file of the strip and its two notes when no card has a table, and toasts the rows', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    await exportNumbers(user);
    expect(csvWrite.downloadBlob).toHaveBeenCalledOnce();
    const { rows, name } = await downloaded();
    expect(name).toBe('ai-overview-fynix-2026-10-16-to-2026-11-12.csv');
    expect(rows[0]?.slice(0, 5)).toEqual(['block', 'project', 'number', 'engine', 'value']);
    const numbers = rows.filter((row) => row[0] === 'numbers');
    // One block, no table of a card: every other row is a note
    expect(rows.filter((row) => row[0] !== 'numbers' && row[0] !== 'note').length).toBe(1);
    const notes = rows.filter((row) => row[0] === 'note').map((row) => row[1]);
    expect(notes).toEqual([NOTE_UNKNOWN, NOTE_POOLED]);
    expect(await screen.findByText(`${numbers.length} rows exported`)).toBeInTheDocument();
  });

  it('writes the numbers the strip shows: the same value and the same counts', async () => {
    const { user } = renderWithProviders(overviewAs('admin'));
    const strip = await screen.findByRole('group', { name: /AI visibility numbers/ });
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    await exportNumbers(user);
    const { rows } = await downloaded();
    const mention = rows.find((row) => row[2] === 'ai.mention_rate' && row[3] === 'chatgpt_web');
    if (mention === undefined) throw new Error('The file has no ChatGPT mention rate');
    const [, , , , value = '', unit, numerator = '', denominator = ''] = mention;
    expect(unit).toBe('percent');
    // The strip's numbers in order: Prompts, then ChatGPT, Gemini and AI Mode
    const [promptsCell, chatgptCell] = within(strip).getAllByRole('definition');
    const text = chatgptCell?.textContent ?? '';
    const percent = /(\d+(?:\.\d)?)%/.exec(text)?.[1];
    expect(Math.abs(Number(percent) - Number(value))).toBeLessThanOrEqual(0.5);
    expect(chatgptCell).toHaveAccessibleDescription(
      new RegExp(
        `${Number(numerator).toLocaleString('en-US')} of ${Number(denominator).toLocaleString('en-US')} (?:valid )?answers`,
      ),
    );
    const prompts = rows.find((row) => row[2] === 'ai.prompts_in_scope');
    expect(promptsCell).toHaveTextContent(new RegExp(`^${prompts?.[4] ?? 'none'}`));
    // AI Mode is off in Fynix: no value, never zero
    const off = rows.find((row) => row[2] === 'ai.mention_rate' && row[3] === 'google_ai_mode');
    expect(off?.[4]).toBe('');
    expect(off?.[10]).toBe('off');
  });

  it('writes the table of a card after the strip, in its own block under its own header, and an unmounted card leaves it out', async () => {
    const block = (id: string): ExportBlock => ({
      id,
      header: ['label', 'value'],
      rows: [
        ['a', 1],
        ['b', 2],
      ],
    });
    fakeCards.block = block;
    const { user } = renderWithProviders(overviewAs('admin'));
    await screen.findByTestId('fake-card-rate-trend');
    await exportNumbers(user);
    const first = await downloaded();
    const lastNumbers = first.rows.map((row) => row[0]).lastIndexOf('numbers');
    const at = first.rows.findIndex((row) => row[0] === 'rate-trend');
    expect(at).toBeGreaterThan(lastNumbers);
    // The block starts under a header row of its own whose first cell is `block`
    expect(first.rows[at - 1]).toEqual(['block', 'label', 'value']);
    expect(rowsOfBlock(first.rows, 'rate-trend')).toEqual([
      ['rate-trend', 'a', '1'],
      ['rate-trend', 'b', '2'],
    ]);
    expect(rowsOfBlock(first.rows, 'change-summary')).toHaveLength(2);
    // The rows of the blocks are counted with the numbers, never the headers or the notes
    const counted = first.rows.filter((row) => row[0] === 'numbers').length + 9 * 2;
    expect(await screen.findByText(`${counted} rows exported`)).toBeInTheDocument();

    // Hiding a card in customize mode takes it off the page, and its table out of the next file
    await user.click(screen.getByRole('button', { name: 'Customize' }));
    await user.click((await screen.findAllByRole('button', { name: /^Hide / }))[0] as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByTestId('fake-card-change-summary')).not.toBeInTheDocument();
    });
    vi.mocked(csvWrite.downloadBlob).mockClear();
    await exportNumbers(user);
    const second = await downloaded();
    expect(rowsOfBlock(second.rows, 'change-summary')).toHaveLength(0);
    expect(rowsOfBlock(second.rows, 'rate-trend')).toHaveLength(2);
  });

  it('leaves out the card that is still loading and says how many in a note', async () => {
    fakeCards.block = (id) => (id === 'rate-trend' ? { id, header: ['label'], rows: [['a']] } : null);
    const { user } = renderWithProviders(overviewAs('admin'));
    await screen.findByTestId('fake-card-rate-trend');
    await exportNumbers(user);
    const { rows } = await downloaded();
    expect(rowsOfBlock(rows, 'rate-trend')).toHaveLength(1);
    expect(rows.filter((row) => row[0] === 'note').map((row) => row[1])).toEqual([
      NOTE_UNKNOWN,
      NOTE_POOLED,
      '8 cards were still loading and left out.',
    ]);
  });

  it('reads the sources and the fan-out when the menu opens, once, and the file then carries their figures', async () => {
    const asked: string[] = [];
    const listener = ({ request }: { request: Request }): void => {
      const path = new URL(request.url).pathname;
      if (/\/ai\/(sources\/domains|fanout-queries)$/.test(path)) asked.push(path.split('/ai/')[1] ?? path);
    };
    server.events.on('request:start', listener);
    const { user } = renderWithProviders(overviewAs('admin'));
    const strip = await screen.findByRole('group', { name: /AI visibility numbers/ });
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    // The default strip needs neither read, so nothing asked them yet
    expect(asked).toEqual([]);
    await exportNumbers(user);
    server.events.removeListener('request:start', listener);
    expect([...asked].sort()).toEqual(['fanout-queries', 'sources/domains']);
    const { rows } = await downloaded();
    const status = (metric: string): string | undefined =>
      rows.find((row) => row[2] === metric && row[3] === 'chatgpt_web')?.[10];
    expect(status('ai.citation_share')).not.toBe('unread');
    expect(status('ai.fanout_presence_rate')).not.toBe('unread');
    expect(rows.filter((row) => row[0] === 'note')).toHaveLength(2);
  });

  it('is disabled with the waiting reason while the sources and the fan-out are being read', async () => {
    const release = gate();
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/projects/:p/ai/sources/domains'), async ({ request }) => {
        await release.promise;
        return getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      }),
    );
    const { user } = renderWithProviders(overviewAs('admin'));
    const strip = await screen.findByRole('group', { name: /AI visibility numbers/ });
    await waitFor(() => {
      expect(strip).not.toHaveAttribute('aria-busy');
    });
    await user.click(await exportButton());
    const item = await screen.findByRole('menuitem', { name: 'Numbers (CSV)' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('Available once the numbers have loaded');
    release.open();
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Numbers (CSV)' })).not.toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('says in a note which read failed, and leaves its rows unread with no value', async () => {
    server.use(
      http.get(mswPath('/api/v1/workspaces/:w/projects/:p/ai/sources/domains'), () =>
        HttpResponse.json({ type: 'about:blank', title: 'Internal', status: 500, code: 'internal' }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(overviewAs('admin'));
    await exportNumbers(user);
    const { rows } = await downloaded();
    const share = rows.find((row) => row[2] === 'ai.citation_share' && row[3] === 'chatgpt_web');
    expect(share?.[4]).toBe('');
    expect(share?.[10]).toBe('unread');
    expect(rows.filter((row) => row[0] === 'note').map((row) => row[1])).toEqual([
      NOTE_UNKNOWN,
      NOTE_POOLED,
      'Citation share could not be read, so its rows have no value.',
    ]);
  });

  it('shows the error toast and downloads nothing when the file cannot be made', async () => {
    vi.mocked(csvWrite.downloadBlob).mockImplementationOnce(() => {
      throw new Error('The browser refused the file');
    });
    const { user } = renderWithProviders(overviewAs('admin'));
    await exportNumbers(user);
    // The toast and its live region both carry the words
    expect((await screen.findAllByText(FAILED)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/rows exported/)).not.toBeInTheDocument();
  });

  it('shows the error toast when a card cannot build its table, and writes no file', async () => {
    fakeCards.block = () => {
      throw new Error('A card broke');
    };
    const { user } = renderWithProviders(overviewAs('admin'));
    await screen.findByTestId('fake-card-rate-trend');
    await exportNumbers(user);
    expect((await screen.findAllByText(FAILED)).length).toBeGreaterThan(0);
    expect(csvWrite.downloadBlob).not.toHaveBeenCalled();
  });
});
