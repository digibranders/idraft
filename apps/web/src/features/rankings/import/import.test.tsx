import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CANCEL_PATH, CONFIRM_PATH, IMPORT, IMPORTS } from './import-queries';
import { MOCK_VOCABULARY_IDS } from '@/mocks/entity-fixtures';
import { writeTrouble } from '@/mocks/handlers/keyword-imports';
import { mswPath, problem } from '@/mocks/respond';
import { axe } from '@/test/axe';
import {
  Controlled,
  NEW_AND_TAGGED,
  PARSED,
  SLOW_TEST,
  UPLOAD,
  WRITE_TEST,
  WRITTEN,
  answerImportAs,
  choose,
  countIn,
  csv,
  fileInput,
  importPaste,
  openImport,
  press,
  spy,
  uploadAndContinue,
} from '@/test/import-harness';
import { importFixture } from '@/test/import-fixtures';
import { server } from '@/test/msw';
import { fynix, keywordsIn, loadedGrid, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));
// Under jsdom MSW cannot take a multipart upload (see `fetch-upload.ts`), so the dialog "uploads" through a
// `fetch` that sends the file's rows to the JSON route; `upload.test.ts` and the browser run cover the real one
vi.mock('@/lib/api/upload', async () => {
  const { fetchUpload } = await import('@/test/fetch-upload');
  return { uploadForm: fetchUpload };
});

beforeEach(stubWideScreen);
// The mocks' imports are forgotten after every test (resetMockState): one test's write is not the next one's
afterEach(restoreWideScreen);

describe('Import dialog', () => {
  it(
    'takes a file through Upload, Map, Review and Confirm, and sends what was chosen',
    async () => {
      const patches = spy('patch', IMPORT);
      const confirms = spy('post', CONFIRM_PATH);
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      expect(await axe(dialog)).toHaveNoViolations();

      await uploadAndContinue(user, dialog, csv(NEW_AND_TAGGED));
      // The upload is read, then the Map step lists the file's own headers; tags need a vocabulary
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      expect(within(dialog).getByRole('combobox', { name: 'keyword' })).toHaveTextContent('Keyword');
      expect(within(dialog).getByRole('combobox', { name: 'tags' })).toHaveTextContent('Tags');
      expect(within(dialog).getByText('Choose the vocabulary these terms belong to.')).toBeInTheDocument();
      expect(await axe(dialog)).toHaveNoViolations();

      await choose(user, dialog, 'Vocabulary for tags', 'Topics');
      await press(dialog, 'Continue');
      await within(dialog).findByText('Search operators such as site: are not tracked.', undefined, PARSED);
      expect(patches.bodies).toMatchObject([
        {
          column_mapping: { keyword: 'keyword', tags: 'tags' },
          defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics },
        },
      ]);
      const summary = within(dialog).getByRole('group', { name: 'Rows by outcome' });
      expect(countIn(summary, 'New')).toHaveTextContent('2');
      expect(countIn(summary, 'Duplicate')).toHaveTextContent('1');
      expect(countIn(summary, 'Invalid')).toHaveTextContent('1');
      expect(await axe(dialog)).toHaveNoViolations();

      await press(dialog, 'Continue');
      expect(await within(dialog).findByText('2 keywords are tracked')).toBeInTheDocument();
      await press(dialog, 'Import 2 keywords');
      await waitFor(() => expect(changes.at(-1)).toBe(false));
      expect(confirms.bodies).toEqual([{ duplicate_action: 'skip' }]);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
      // Focus goes back to the button that opened the dialog
      expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus();
    },
    SLOW_TEST,
  );

  it(
    'sends the choices of Review: tracked keywords merged and archived ones unarchived',
    async () => {
      const patches = spy('patch', IMPORT);
      const confirms = spy('post', CONFIRM_PATH);
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nseo audit\nseo meme\nbacklink watcher'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      // Nothing changed on Map, so Continue sends nothing
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'Archived' }, PARSED);
      expect(patches.bodies).toEqual([]);
      await user.click(
        within(dialog).getByRole('radio', { name: 'Add their groups and tags to the tracked keywords' }),
      );
      await user.click(within(dialog).getByRole('radio', { name: "Unarchive them with the file's settings" }));
      expect(within(dialog).getByText('seo meme')).toBeInTheDocument();
      await press(dialog, 'Continue');
      expect(await within(dialog).findByText("1 tracked keyword gets the file's groups and tags")).toBeInTheDocument();
      await press(dialog, 'Import 2 keywords');
      await waitFor(() => expect(changes.at(-1)).toBe(false));
      expect(patches.bodies).toEqual([{ row_actions: [{ row_no: 2, part: 1, action: 'merge' }] }]);
      expect(confirms.bodies).toEqual([{ duplicate_action: 'merge_terms' }]);
    },
    SLOW_TEST,
  );

  it(
    'takes back unarchiving when a refused Confirm is followed by leaving the keywords archived',
    async () => {
      const patches = spy('patch', IMPORT);
      let refused = false;
      server.use(
        http.post(mswPath(CONFIRM_PATH), ({ request }) => {
          if (refused) return undefined;
          refused = true;
          return problem(request, 'quota_exceeded', { limit: 5000, used: 4999, requested: 2 });
        }),
      );
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nseo meme\nbacklink watcher'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'Archived' }, PARSED);
      await user.click(within(dialog).getByRole('radio', { name: "Unarchive them with the file's settings" }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 2 keywords');
      await within(dialog).findByText(/^The import is over your plan's limit/);
      expect(patches.bodies).toEqual([{ row_actions: [{ row_no: 1, part: 1, action: 'merge' }] }]);

      await press(dialog, 'Back');
      await user.click(within(dialog).getByRole('radio', { name: 'Leave them archived' }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1 keyword');
      await waitFor(() => expect(changes.at(-1)).toBe(false));
      // The archived row was told to unarchive, then told to stay: it is not unarchived behind the choice
      expect(patches.bodies).toEqual([
        { row_actions: [{ row_no: 1, part: 1, action: 'merge' }] },
        { row_actions: [{ row_no: 1, part: 1, action: 'skip' }] },
      ]);
    },
    SLOW_TEST,
  );

  it(
    'goes back with every choice kept, and sends nothing for an unchanged mapping',
    async () => {
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      const text = 'keyword,notes\nbacklink watcher,x\nrank tracker api,y';
      await uploadAndContinue(user, dialog, csv(text));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await choose(user, dialog, 'notes', 'Group');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Back');
      expect(within(dialog).getByRole('combobox', { name: 'notes' })).toHaveTextContent('Group');
      await press(dialog, 'Back');
      expect(within(dialog).getByText(`keywords.csv, ${String(text.length)} B`)).toBeInTheDocument();
      await press(dialog, 'Continue');
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' });
      // One change of the mapping, one request: neither Back nor the second Continue sent another
      expect(patches.bodies).toHaveLength(1);
    },
    SLOW_TEST,
  );

  it(
    'checks the mapping before it sends anything',
    async () => {
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword,query\nbacklink watcher,rank tracker api'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await choose(user, dialog, 'query', 'Keyword');
      await press(dialog, 'Continue');
      expect(within(dialog).getAllByText('Map each field from one column only.')).toHaveLength(2);
      await choose(user, dialog, 'query', 'Ignore');
      await choose(user, dialog, 'keyword', 'Ignore');
      await press(dialog, 'Continue');
      expect(within(dialog).getByText('Map a column to Keyword.')).toBeInTheDocument();
      expect(patches.bodies).toEqual([]);
    },
    SLOW_TEST,
  );

  it(
    'skips the Map step for a paste',
    async () => {
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
      const steps = within(dialog).getByRole('list', { name: 'Import steps' });
      expect(within(steps).queryByText('Map columns')).toBeNull();
      await press(dialog, 'Continue');
      expect(within(dialog).getByText('Paste at least one keyword.')).toBeInTheDocument();
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Keywords' }),
        'rank tracker api{Enter}backlink watcher',
      );
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      expect(within(dialog).getByRole('group', { name: 'Rows by outcome' })).toHaveTextContent('New2');
      expect(within(dialog).getByText('rank tracker api')).toBeInTheDocument();
    },
    SLOW_TEST,
  );

  it(
    'asks for a vocabulary when a pasted line has tags',
    async () => {
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
      await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
      await user.paste('rank tracker api\tblog|guides');
      await press(dialog, 'Continue');
      expect(within(dialog).getByText('Choose the vocabulary these terms belong to.')).toBeInTheDocument();
      await choose(user, dialog, 'Vocabulary for tags', 'Topics');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
    },
    SLOW_TEST,
  );

  it('does not send a file with a header line and no rows: the API would read it into a preview of nothing', async () => {
    const created = spy('post', UPLOAD);
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await user.upload(fileInput(), csv('keyword\n'));
    expect(
      await within(dialog).findByText('This file has a header line and no rows. Add the keywords below it.'),
    ).toBeInTheDocument();
    expect(created.bodies).toEqual([]);
  });

  it('refuses a file that is not a CSV, too large or not UTF-8, before any upload', async () => {
    const uploads = spy('post', UPLOAD);
    const permissive = userEvent.setup({ applyAccept: false });
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);

    await permissive.upload(fileInput(), new File(['keyword'], 'keywords.txt', { type: 'text/plain' }));
    expect(await within(dialog).findByText('Only CSV files can be imported.')).toBeInTheDocument();

    const large = csv('keyword', 'large.csv');
    Object.defineProperty(large, 'size', { value: 50 * 1024 * 1024 + 1 });
    await permissive.upload(fileInput(), large);
    expect(
      await within(dialog).findByText('This file is larger than 50 MB. Split it into smaller files.'),
    ).toBeInTheDocument();

    await permissive.upload(fileInput(), new File([new Uint8Array([0xff, 0xfe])], 'binary.csv', { type: 'text/csv' }));
    expect(
      await within(dialog).findByText('This file is not UTF-8. Export it again as CSV UTF-8.'),
    ).toBeInTheDocument();

    await press(dialog, 'Continue');
    expect(within(dialog).getByText('Choose a CSV file to import.')).toBeInTheDocument();
    expect(uploads.bodies).toEqual([]);
  });

  it(
    'says so when the preview expired, and starts again from an empty Upload step',
    async () => {
      answerImportAs((view) => ({ ...view, status: 'expired' }));
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      expect(
        await within(dialog).findByText(
          'This preview expired after 7 days. Start the import again.',
          undefined,
          PARSED,
        ),
      ).toBeInTheDocument();
      await press(dialog, 'Start again');
      expect(within(dialog).queryByText(/^keywords.csv, /)).toBeNull();
      expect(within(dialog).getByText('Drop a CSV file here, or choose one')).toBeInTheDocument();
    },
    SLOW_TEST,
  );

  it(
    'does not let an import over the plan limit be confirmed',
    async () => {
      const confirms = spy('post', CONFIRM_PATH);
      answerImportAs((view) =>
        view.status === 'preview_ready' ? { ...view, quota: { limit: 10, used: 9, would_use: 12 } } : view,
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher\nrank tracker api'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await press(dialog, 'Continue');
      expect(
        await within(dialog).findByText(
          "2 keywords are over your plan's limit of 10. Skip rows or archive keywords, then import again.",
          undefined,
          PARSED,
        ),
      ).toBeInTheDocument();
      await press(dialog, 'Continue');
      expect(within(dialog).getByText("The import is over your plan's keyword limit.")).toBeInTheDocument();
      const confirm = within(dialog).getByRole('button', { name: 'Import 2 keywords' });
      expect(confirm).toBeDisabled();
      await user.click(confirm);
      expect(confirms.bodies).toEqual([]);
    },
    SLOW_TEST,
  );

  it(
    'names the numbers when the API refuses a confirm over the limit, and keeps the dialog',
    async () => {
      server.use(
        http.post(mswPath(CONFIRM_PATH), ({ request }) =>
          problem(request, 'quota_exceeded', { limit: 5000, used: 4999, requested: 2 }),
        ),
      );
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher\nrank tracker api'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Continue');
      await press(dialog, 'Import 2 keywords');
      expect(
        await within(dialog).findByText(
          "The import is over your plan's limit: 4,999 of 5,000 keywords are tracked and this adds 2.",
        ),
      ).toBeInTheDocument();
      expect(changes).toEqual([true]);
    },
    SLOW_TEST,
  );

  it(
    'asks before closing past the first step, then cancels the import and closes',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await within(dialog).findByText(/^Choose what each column of the file holds/, undefined, PARSED);
      await press(dialog, 'Close');
      const question = await screen.findByRole('alertdialog', { name: 'Stop this import?' });
      await user.click(within(question).getByRole('button', { name: 'Keep importing' }));
      expect(cancels.bodies).toEqual([]);
      await press(dialog, 'Close');
      await user.click(
        await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Stop import' }),
      );
      await waitFor(() => expect(cancels.bodies).toHaveLength(1));
      expect(changes).toEqual([true, false]);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
      // Opened again, the dialog starts empty
      await user.click(screen.getByRole('button', { name: 'Import' }));
      const again = await screen.findByRole('dialog', { name: 'Import keywords' });
      expect(within(again).getByText('Drop a CSV file here, or choose one')).toBeInTheDocument();
    },
    SLOW_TEST,
  );

  it('shows the Import button to people who may import, and to nobody else', async () => {
    const editor = renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
    editor.unmount();
    renderWithProviders(<Controlled member="viewer" changes={[]} />);
    await loadedGrid();
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
  });
});

/** An import that is being written, 12 rows of 40 done: what a reload finds. */
const WRITING = importFixture();

describe('Import progress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'announces that the import started, which the bar does not say when it first shows',
    async () => {
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'rank tracker api\nbacklink watcher', 'Import 2 keywords');
      await waitFor(() =>
        expect(document.getElementById('live-region-polite')).toHaveTextContent(
          'Import started. Its progress shows under the page title.',
        ),
      );
    },
    WRITE_TEST,
  );

  it(
    'follows the write in the header, then offers the report and shows the new keywords',
    async () => {
      const clicked: { href: string | null; download: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.getAttribute('href'), download: this.download });
      });
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'rank tracker api\nbacklink watcher\nsite:example.com seo', 'Import 2 keywords');
      const bar = await screen.findByRole('progressbar', { name: 'Importing keywords' });
      expect(within(bar.parentElement ?? bar).getByText(/^\d+ of 3 rows$/)).toBeInTheDocument();
      expect(await axe(bar.parentElement ?? bar)).toHaveNoViolations();

      expect(await screen.findByText('Import finished: 2 added, 1 skipped', undefined, WRITTEN)).toBeInTheDocument();
      expect(screen.queryByRole('progressbar', { name: 'Importing keywords' })).toBeNull();
      // The list was read again: the new keywords are in the table
      const grid = await loadedGrid();
      await waitFor(() =>
        expect(keywordsIn(grid)).toEqual(expect.arrayContaining(['rank tracker api', 'backlink watcher'])),
      );

      await user.click(screen.getByRole('button', { name: 'Download report' }));
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
      expect(clicked).toHaveLength(1);
      expect(clicked[0]?.href).toMatch(
        new RegExp(`^/api/v1/workspaces/[^/]+/projects/${fynix.project_id}/keyword-imports/[^/]+/report$`),
      );
      expect(clicked[0]?.download).toBe(`keyword-import-${today}.csv`);
    },
    WRITE_TEST,
  );

  it('picks up a write that is under way when the page opens', async () => {
    server.use(
      http.get(mswPath(IMPORTS), () =>
        HttpResponse.json({ data: [WRITING], page: { limit: 1, next_cursor: null, has_more: false } }),
      ),
      http.get(mswPath(IMPORT), () => HttpResponse.json({ data: WRITING })),
    );
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    const bar = await screen.findByRole('progressbar', { name: 'Importing keywords' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuemax', '40');
    expect(within(bar.parentElement ?? bar).getByText('12 of 40 rows')).toBeInTheDocument();
  });

  it('says so, once, when a write it picked up cannot be read', async () => {
    server.use(
      http.get(mswPath(IMPORTS), () =>
        HttpResponse.json({ data: [WRITING], page: { limit: 1, next_cursor: null, has_more: false } }),
      ),
      http.get(mswPath(IMPORT), ({ request }) => problem(request, 'not_found')),
    );
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(
      await screen.findAllByText('The import could not be followed. Reload the page to see how it went.'),
    ).not.toHaveLength(0);
    expect(screen.queryByRole('progressbar', { name: 'Importing keywords' })).toBeNull();
  });

  it('shows nothing for the write of a project that has none', async () => {
    renderWithProviders(<Controlled changes={[]} />);
    await loadedGrid();
    expect(screen.queryByRole('progressbar', { name: 'Importing keywords' })).toBeNull();
  });

  it(
    'says why a write failed',
    async () => {
      // The write stops on an error after its first batch, as the backend ends an import it cannot write
      writeTrouble.stopAfterBatches = 1;
      writeTrouble.batchSize = 1;
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      await loadedGrid();
      await importPaste(user, 'rank tracker api\nbacklink watcher', 'Import 2 keywords');
      // An error toast is announced as well as shown, so the text is found twice; the code is told in words,
      // and the API's own English detail is not shown
      expect(
        await screen.findAllByText(
          'Import failed: Some keywords were added before the import stopped. The report lists what was and was not written.',
          undefined,
          WRITTEN,
        ),
      ).not.toHaveLength(0);
      expect(screen.queryByText(/The write stopped on an error/)).toBeNull();
      await waitFor(() => expect(screen.queryByRole('progressbar', { name: 'Importing keywords' })).toBeNull());
    },
    WRITE_TEST,
  );
});
