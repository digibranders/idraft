import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IMPORT, IMPORTS } from './import-queries';
import { dismissToast } from '@/components/ui/toast';
import type { KeywordImport } from '@/lib/api/types';
import { writeTrouble } from '@/mocks/handlers/keyword-imports';
import { mswPath } from '@/mocks/respond';
import {
  Controlled,
  PARSED,
  WRITE_TEST,
  WRITTEN,
  answerImportAs,
  csv,
  importPaste,
  openImport,
  uploadAndContinue,
} from '@/test/import-harness';
import { IMPORT_FIXTURE_ID, importFixture } from '@/test/import-fixtures';
import { server } from '@/test/msw';
import { fynix, loadedGrid, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));
vi.mock('@/lib/api/upload', async () => {
  const { fetchUpload } = await import('@/test/fetch-upload');
  return { uploadForm: fetchUpload };
});

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  vi.restoreAllMocks();
});

const LIST_PAGE = { limit: 1, next_cursor: null, has_more: false };
const OTHER_IMPORT_ID = '0192d1a8-e007-7a10-8e07-0000000009bb';
const KNOWN_REPORT = new RegExp(
  `^/api/v1/workspaces/[^/]+/projects/${fynix.project_id}/keyword-imports/${IMPORT_FIXTURE_ID}/report$`,
);

/** The import being written, as the list of writes answers it on a reload; `later` is what it reads from then on. */
function resumeWrite(running: KeywordImport, later: () => KeywordImport = () => running): void {
  server.use(
    http.get(mswPath(IMPORTS), () => HttpResponse.json({ data: [running], page: LIST_PAGE })),
    http.get(mswPath(IMPORT), ({ params }) =>
      params.import_id === running.import_id ? HttpResponse.json({ data: later() }) : undefined,
    ),
  );
}

/** An import that finished writing: 5 added and 1 skipped, with the report link the API gives. */
const finished = (links: KeywordImport['operation']['links'], over: Partial<KeywordImport> = {}): KeywordImport =>
  importFixture({
    status: 'completed',
    counts: { ...importFixture().counts, created: 5, skipped: 1 },
    finished_at: '2026-10-05T09:01:00Z',
    operation: {
      ...importFixture().operation,
      status: 'succeeded',
      progress: { done: 40, total: 40, unit: 'rows' },
      finished_at: '2026-10-05T09:01:00Z',
      links,
    },
    ...over,
  });

/** Records what the download of a report clicks. */
function recordDownloads(): { href: string | null; download: string }[] {
  const clicked: { href: string | null; download: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href'), download: this.download });
  });
  return clicked;
}

describe('The report of an import', () => {
  it('is downloaded from the link the finished import gives', async () => {
    const clicked = recordDownloads();
    resumeWrite(importFixture(), () =>
      finished({ self: '/api/v1/import', result: `/api/v1/workspaces/w/projects/p/keyword-imports/x/report?v=2` }),
    );
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(await screen.findByText('Import finished: 5 added, 1 skipped')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download report' }));
    expect(clicked.map((click) => click.href)).toEqual([
      '/api/v1/workspaces/w/projects/p/keyword-imports/x/report?v=2',
    ]);
  });

  it('is not offered when the finished import has no link to one', async () => {
    resumeWrite(importFixture(), () => finished({ self: '/api/v1/import' }));
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(await screen.findByText('Import finished: 5 added, 1 skipped')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download report' })).toBeNull();
  });

  it('is taken from the known path when the link leaves this app', async () => {
    const clicked = recordDownloads();
    resumeWrite(importFixture(), () =>
      finished({ self: '/api/v1/import', result: 'https://elsewhere.example/api/v1/import/report' }),
    );
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    await screen.findByText('Import finished: 5 added, 1 skipped');
    await user.click(screen.getByRole('button', { name: 'Download report' }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.href).toMatch(KNOWN_REPORT);
  });
});

describe('An import whose write goes wrong', () => {
  it(
    'offers the report and reads the keywords again when the write stopped on an error, not "try again"',
    async () => {
      const clicked = recordDownloads();
      writeTrouble.stopAfterBatches = 1;
      writeTrouble.batchSize = 1;
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'fresh idea one\nfresh idea two', 'Import 2 keywords');
      expect(
        await screen.findAllByText(
          'Import failed: Some keywords were added before the import stopped. The report lists what was and was not written.',
          undefined,
          WRITTEN,
        ),
      ).not.toHaveLength(0);
      expect(screen.queryByText(/Try the import again/)).toBeNull();
      // The keyword of the batch that went through is in the table, read again after the failure; the one
      // after it is not (the search is in memory, so only a list read again can hold either)
      await user.type(screen.getByRole('searchbox', { name: 'Search in table' }), 'fresh idea');
      await waitFor(() =>
        expect(screen.getByRole('grid', { name: 'Tracked keywords' })).toHaveTextContent('fresh idea one'),
      );
      expect(screen.getByRole('grid', { name: 'Tracked keywords' })).not.toHaveTextContent('fresh idea two');
      // An error toast is announced through the live region and hidden from the tree until it is focused
      await user.click(screen.getByRole('button', { name: 'Download report', hidden: true }));
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.href).toMatch(/\/keyword-imports\/[^/]+\/report$/);
    },
    WRITE_TEST,
  );

  it(
    'says an import finished with errors when rows could not be written, and offers the report',
    async () => {
      writeTrouble.failedRows = [2];
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'fresh idea one\nfresh idea two', 'Import 2 keywords');
      expect(
        await screen.findAllByText(
          'Import finished with errors: 1 added, 0 updated, 0 skipped. The report lists the rows that could not be written.',
          undefined,
          WRITTEN,
        ),
      ).not.toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Download report' })).toBeInTheDocument();
    },
    WRITE_TEST,
  );

  it(
    'still reads a finished import as finished when only the preview skipped rows',
    async () => {
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'fresh idea one\nsite:fynix.digital seo', 'Import 1 keyword');
      expect(await screen.findByText('Import finished: 1 added, 1 skipped', undefined, WRITTEN)).toBeInTheDocument();
    },
    WRITE_TEST,
  );
});

describe('Why a write failed, in words', () => {
  const failedWrite = (code: string | null): KeywordImport =>
    importFixture({
      status: 'failed',
      error_code: code,
      operation: {
        ...importFixture().operation,
        status: 'failed',
        error: code === null ? null : { code, detail: 'An English detail that is not shown' },
      },
    });

  it.each([
    [
      'write_failed',
      'Some keywords were added before the import stopped. The report lists what was and was not written.',
    ],
    ['project_gone', 'This project no longer exists, so nothing was imported.'],
    ['source_corrupt', 'The stored copy of the file is damaged. Upload the file again.'],
    ['source_unreadable', 'The stored copy of the file could not be read. Try again, or upload the file again.'],
  ])('tells the code %s', async (code, words) => {
    resumeWrite(importFixture(), () => failedWrite(code));
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(await screen.findAllByText(`Import failed: ${words}`)).not.toHaveLength(0);
    expect(screen.queryByText(/An English detail/)).toBeNull();
  });

  it('keeps the generic words for a code it does not know, and for none', async () => {
    resumeWrite(importFixture(), () => failedWrite('something_new'));
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(await screen.findAllByText('Import failed: The import could not continue. Try again.')).not.toHaveLength(0);
    expect(screen.queryByText(/An English detail/)).toBeNull();
  });

  it('keeps the generic words when the write names no code', async () => {
    resumeWrite(importFixture(), () => failedWrite(null));
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(await screen.findAllByText('Import failed: The import could not continue. Try again.')).not.toHaveLength(0);
  });
});

describe('Why an import failed in the dialog, in words', () => {
  const FILE = [
    ['not_utf8', 'The file is not UTF-8. Export it again as CSV UTF-8.'],
    ['not_csv', 'The file is not a CSV. Export it again as CSV.'],
    ['no_header', 'The file has no header line. Put the column names on the first line.'],
    ['no_rows', 'The file has no rows below its header line. Add the keywords and upload it again.'],
    ['duplicate_headers', 'Two columns have the same name. Rename one of them and upload the file again.'],
    ['too_many_rows', 'The file has more than 10,000 rows. Split it into smaller files.'],
    ['too_many_columns', 'The file has more than 100 columns. Remove the columns you do not need and upload it again.'],
    ['parse_failed', 'The file could not be parsed. Check that it is a well-formed CSV, then try again.'],
  ] as const;
  const SYSTEM = [
    [
      'write_failed',
      'Some keywords were added before the import stopped. The report lists what was and was not written.',
    ],
    ['source_corrupt', 'The stored copy of the file is damaged. Upload the file again.'],
    ['source_unreadable', 'The stored copy of the file could not be read. Try again, or upload the file again.'],
    ['project_gone', 'This project no longer exists, so nothing was imported.'],
    ['expired', 'This import expired. Start it again.'],
  ] as const;

  async function failWith(code: string | null, operationCode: string | null = null): Promise<HTMLElement> {
    answerImportAs((view) => ({
      ...view,
      status: 'failed',
      error_code: code,
      operation: {
        ...view.operation,
        status: 'failed',
        error: operationCode === null ? null : { code: operationCode, detail: 'An English detail' },
      },
    }));
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
    return dialog;
  }

  it.each(FILE)('tells the file problem %s', async (code, words) => {
    const dialog = await failWith(code);
    expect(await within(dialog).findByText(words, undefined, PARSED)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Start again' })).toBeInTheDocument();
  });

  it.each(SYSTEM)('tells the failure %s', async (code, words) => {
    const dialog = await failWith(code);
    expect(await within(dialog).findByText(words, undefined, PARSED)).toBeInTheDocument();
  });

  it('reads the code of the operation when the import names none', async () => {
    const dialog = await failWith(null, 'too_many_rows');
    expect(
      await within(dialog).findByText(
        'The file has more than 10,000 rows. Split it into smaller files.',
        undefined,
        PARSED,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/An English detail/)).toBeNull();
  });

  const GENERIC = 'The file could not be read. Check that it is a CSV with a header line, then try again.';

  it('keeps the generic words for a code it does not know', async () => {
    const dialog = await failWith('something_new', 'something_new');
    expect(await within(dialog).findByText(GENERIC, undefined, PARSED)).toBeInTheDocument();
    expect(within(dialog).queryByText(/An English detail/)).toBeNull();
  });

  it('keeps the generic words when the import names no code', async () => {
    const dialog = await failWith(null);
    expect(await within(dialog).findByText(GENERIC, undefined, PARSED)).toBeInTheDocument();
  });
});

describe('Following imports from the header', () => {
  it(
    'does not bring back the toast of an import that ended when the next one ends',
    async () => {
      const clicked = recordDownloads();
      const first = importFixture({ import_id: OTHER_IMPORT_ID });
      resumeWrite(first, () =>
        finished({ self: '/api/v1/import', result: '/api/v1/import/report' }, { import_id: OTHER_IMPORT_ID }),
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      const firstToast = 'Import finished: 5 added, 1 skipped';
      expect(await screen.findByText(firstToast)).toBeInTheDocument();
      // The person has read it and closed it
      act(() => dismissToast());
      await waitFor(() => expect(screen.queryByText(firstToast)).toBeNull());

      await importPaste(user, 'rank tracker api\nbacklink watcher', 'Import 2 keywords');
      expect(await screen.findByText('Import finished: 2 added, 0 skipped', undefined, WRITTEN)).toBeInTheDocument();
      // The first import is over: it does not come back with the second one's end
      await expect(screen.findByText(firstToast, undefined, { timeout: 1_500 })).rejects.toThrow();
      expect(clicked).toEqual([]);
    },
    WRITE_TEST,
  );

  it(
    'follows an import started while another is written, and tells each end with its own report',
    async () => {
      const clicked = recordDownloads();
      let firstDone = false;
      const first = importFixture({ import_id: OTHER_IMPORT_ID });
      resumeWrite(first, () =>
        firstDone
          ? finished({ self: '/api/v1/import', result: '/api/v1/first/report' }, { import_id: OTHER_IMPORT_ID })
          : first,
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      expect(await screen.findByRole('progressbar', { name: 'Importing keywords' })).toBeInTheDocument();

      await importPaste(user, 'rank tracker api\nbacklink watcher', 'Import 2 keywords');
      // Both are followed: the second one did not take the place of the first
      await waitFor(() => expect(screen.getAllByRole('progressbar', { name: 'Importing keywords' })).toHaveLength(2));
      firstDone = true;
      expect(await screen.findByText('Import finished: 5 added, 1 skipped', undefined, WRITTEN)).toBeInTheDocument();
      expect(await screen.findByText('Import finished: 2 added, 0 skipped', undefined, WRITTEN)).toBeInTheDocument();
      const buttons = screen.getAllByRole('button', { name: 'Download report' });
      expect(buttons).toHaveLength(2);
      for (const button of buttons) await user.click(button);
      const hrefs = clicked.map((click) => click.href ?? '');
      expect(hrefs).toContain('/api/v1/first/report');
      expect(hrefs.filter((href) => /\/keyword-imports\/[^/]+\/report$/.test(href))).toHaveLength(1);
      expect(screen.queryByRole('progressbar', { name: 'Importing keywords' })).toBeNull();
    },
    WRITE_TEST,
  );
});
