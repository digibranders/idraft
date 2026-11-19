import { screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptRow } from '../prompt-columns';
import * as workbook from './prompts-workbook';
import { useScopeExport } from './use-scope-export';
import type { ProjectEngine } from '@/lib/api/types';
import { parseCsv } from '@/lib/csv/csv';
import * as csv from '@/lib/csv/csv-write';
import { renderWithProviders } from '@/test/render';

// The file is not written: the call is what the test reads
vi.mock('@/lib/csv/csv-write', async (importOriginal) => ({
  ...(await importOriginal<typeof csv>()),
  downloadBlob: vi.fn(),
}));
vi.mock('./prompts-workbook', async (importOriginal) => {
  const actual = await importOriginal<typeof workbook>();
  return { ...actual, buildPromptWorkbook: vi.fn(actual.buildPromptWorkbook) };
});

const RANGE = { from: '2026-10-16', to: '2026-11-12' };
const ENGINES = [{ engine: { engine_code: 'chatgpt_web', label: 'ChatGPT' } }] as unknown as ProjectEngine[];

const row = (text: string): PromptRow =>
  ({
    prompt: { prompt_id: text, current_version: { text }, is_branded: false },
    summary: undefined,
    countsLoaded: true,
    topics: null,
    topicList: [],
    country: null,
  }) as unknown as PromptRow;

const THREE = [row('First prompt'), row('Second prompt'), row('Third prompt')];

interface ProbeProps {
  rows: readonly PromptRow[];
  waiting?: string | null;
}

/** Each item of the hook as a button, so a test chooses it as a person chooses a menu item. */
function Probe({ rows, waiting = null }: ProbeProps): ReactNode {
  const { items } = useScopeExport({ rows, engines: ENGINES, range: RANGE, waiting });
  return (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" data-reason={item.disabledReason ?? ''} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </>
  );
}

beforeEach(() => {
  vi.mocked(csv.downloadBlob).mockReset();
  vi.mocked(workbook.buildPromptWorkbook).mockClear();
});
afterEach(() => vi.restoreAllMocks());

/** The file the last download handed to the browser, and the name it was given. */
function downloaded(): { blob: Blob; name: string } {
  const [blob, name] = vi.mocked(csv.downloadBlob).mock.calls[0] ?? [];
  if (!(blob instanceof Blob) || typeof name !== 'string') throw new Error('No file was downloaded');
  return { blob, name };
}

describe('the export of the prompts in scope', () => {
  it('offers Export CSV and Export XLSX', () => {
    renderWithProviders(<Probe rows={THREE} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Export CSV', 'Export XLSX']);
  });

  it('Export CSV downloads all rows in scope, not the selection', async () => {
    const { user } = renderWithProviders(<Probe rows={THREE} />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const lines = parseCsv(await downloaded().blob.text());
    // The header and one line for each prompt of the three in scope
    expect(lines).toHaveLength(1 + THREE.length);
    expect(lines.slice(1).map((cells) => cells[0])).toEqual(['First prompt', 'Second prompt', 'Third prompt']);
    expect(await screen.findByText('3 prompts exported')).toBeInTheDocument();
  });

  it('the file name is prompts-from-to-to.csv', async () => {
    const { user } = renderWithProviders(<Probe rows={THREE} />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(downloaded().name).toBe('prompts-2026-10-16-to-2026-11-12.csv');
  });

  it('a prompt text that starts with = is written with the leading apostrophe', async () => {
    const { user } = renderWithProviders(<Probe rows={[row('=HYPERLINK("http://x")')]} />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(parseCsv(await downloaded().blob.text())[1]?.[0]).toBe(`'=HYPERLINK("http://x")`);
  });

  it('Export XLSX downloads a blob named .xlsx and says how many prompts', async () => {
    const { user } = renderWithProviders(<Probe rows={THREE} />);
    await user.click(screen.getByRole('button', { name: 'Export XLSX' }));
    expect(await screen.findByText('3 prompts exported')).toBeInTheDocument();
    const { blob, name } = downloaded();
    expect(name).toBe('prompts-2026-10-16-to-2026-11-12.xlsx');
    expect(blob.type).toBe(workbook.XLSX_FILE_TYPE);
    expect(workbook.buildPromptWorkbook).toHaveBeenCalledWith(expect.anything(), 'Prompts');
    // Every prompt in scope reaches the workbook: the header and one row each
    const [table] = vi.mocked(workbook.buildPromptWorkbook).mock.calls[0] ?? [];
    expect(table?.rows.map((cells) => cells[0])).toEqual(['First prompt', 'Second prompt', 'Third prompt']);
  });

  it('does not load the writer for the CSV', async () => {
    const { user } = renderWithProviders(<Probe rows={THREE} />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(workbook.buildPromptWorkbook).not.toHaveBeenCalled();
  });

  it('no rows disables both items with the reason, and no file is written', async () => {
    const { user } = renderWithProviders(<Probe rows={[]} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.dataset.reason)).toEqual([
      'No prompts to export in this view',
      'No prompts to export in this view',
    ]);
    // Even a menu that let the item through writes nothing
    for (const button of buttons) await user.click(button);
    expect(csv.downloadBlob).not.toHaveBeenCalled();
  });

  it('a waiting list disables both with its reason', () => {
    renderWithProviders(<Probe rows={[]} waiting="The list is still loading" />);
    expect(screen.getAllByRole('button').map((button) => button.dataset.reason)).toEqual([
      'The list is still loading',
      'The list is still loading',
    ]);
  });

  it('a header only file is never written, and the page says there is nothing to export', async () => {
    const { user } = renderWithProviders(<Probe rows={[]} />);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await user.click(screen.getByRole('button', { name: 'Export XLSX' }));
    expect(await screen.findAllByText('No prompt to export')).not.toHaveLength(0);
    expect(csv.downloadBlob).not.toHaveBeenCalled();
    expect(workbook.buildPromptWorkbook).not.toHaveBeenCalled();
  });

  it('a failure of the writer says the export failed and writes nothing', async () => {
    vi.mocked(workbook.buildPromptWorkbook).mockRejectedValueOnce(new Error('writer'));
    const { user } = renderWithProviders(<Probe rows={THREE} />);
    await user.click(screen.getByRole('button', { name: 'Export XLSX' }));
    expect(await screen.findAllByText('The file could not be made. Try again in a moment.')).not.toHaveLength(0);
    await waitFor(() => {
      expect(csv.downloadBlob).not.toHaveBeenCalled();
    });
    expect(screen.queryByText('3 prompts exported')).not.toBeInTheDocument();
  });
});
