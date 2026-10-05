import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CANCEL_PATH, CONFIRM_PATH, IMPORT, IMPORTS, IMPORT_ROWS } from './import-queries';
import { MOCK_VOCABULARY_IDS } from '@/mocks/entity-fixtures';
import { forgetImports } from '@/mocks/handlers/keyword-imports';
import { invalidField, mswPath, problem } from '@/mocks/respond';
import {
  Controlled,
  MAP_INTRO,
  PARSED,
  SLOW_TEST,
  WRITTEN,
  answerImportAs,
  choose,
  chooseFile,
  csv,
  fileInput,
  openImport,
  press,
  realImport,
  spy,
  uploadAndContinue,
  routeControls,
} from '@/test/import-harness';
import { resetUploadScript, uploadScript } from '@/test/fetch-upload';
import { server } from '@/test/msw';
import { fynix, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders } from '@/test/render';

vi.mock('@/components/app/chart/echart', () => ({ EChart: () => <div data-testid="echart-canvas" /> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/digibranders/fynix/seo/rankings',
}));
// See `import.test.tsx`: under jsdom the upload goes to the JSON route of the mocks, row by row
vi.mock('@/lib/api/upload', async () => {
  const { fetchUpload } = await import('@/test/fetch-upload');
  return { uploadForm: fetchUpload };
});

beforeEach(stubWideScreen);
afterEach(() => {
  restoreWideScreen();
  forgetImports();
  resetUploadScript();
});

const VOCABULARIES = '/api/v1/workspaces/{workspace_id}/vocabularies';
const COULD_NOT_CONTINUE = 'The import could not continue. Try again.';
const ROW_ACTIONS = z.object({ row_actions: z.array(z.object({ row_no: z.number(), action: z.string() })) });

/** A promise a test settles from outside. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Goes through Upload and Map with `text` and stands on Review. */
async function toReview(user: ReturnType<typeof renderWithProviders>['user'], text: string): Promise<HTMLElement> {
  const { dialog } = await openImport(user);
  await uploadAndContinue(user, dialog, csv(text));
  await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
  await press(dialog, 'Continue');
  await within(dialog).findByRole('heading', { name: 'Archived' }, PARSED);
  return dialog;
}

describe('Import dialog: archived keywords that were told to unarchive', () => {
  /** An import with 1,001 archived rows (two requests of 1,000), of which the API takes the requests below. */
  function manyArchivedRows(): void {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      row_no: index + 1,
      part: 1,
      raw: {},
      keyword: `archived ${String(index + 1)}`,
      normalized_text: null,
      location_id: null,
      language_code: null,
      device: 'desktop',
      outcome: 'conflict',
      reason_code: 'conflict',
      reason: null,
      existing_tracked_keyword_id: null,
      action: 'skip',
    }));
    server.use(
      http.get(mswPath(IMPORT_ROWS), ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get('filter[outcome_in]') !== 'conflict') return undefined;
        const from = Number(url.searchParams.get('cursor') ?? '0');
        const limit = Number(url.searchParams.get('limit'));
        const next = from + limit;
        return HttpResponse.json({
          data: rows.slice(from, next),
          page: { limit, has_more: next < rows.length, next_cursor: next < rows.length ? String(next) : null },
        });
      }),
    );
    const archived = (view: Awaited<ReturnType<typeof realImport>>): Awaited<ReturnType<typeof realImport>> =>
      view.status === 'preview_ready' ? { ...view, counts: { ...view.counts, conflict: 1001 } } : view;
    answerImportAs(archived);
  }

  it(
    'sends the skip pass for every archived row when a later batch failed after an earlier one was applied',
    async () => {
      manyArchivedRows();
      const sent: { count: number; action: string }[] = [];
      let requests = 0;
      server.use(
        http.patch(mswPath(IMPORT), async ({ request }) => {
          const { row_actions: actions } = ROW_ACTIONS.parse(await request.clone().json());
          requests += 1;
          sent.push({ count: actions.length, action: actions[0]?.action ?? 'none' });
          // The first batch is applied; the second one is lost on its way
          if (requests === 2) return HttpResponse.error();
          const real = await realImport(new Request(request.url, { headers: request.headers }));
          return HttpResponse.json({ data: { ...real, counts: { ...real.counts, conflict: 1001 } } }, { status: 202 });
        }),
      );
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const dialog = await toReview(user, 'keyword\nseo meme\nbacklink watcher');
      await user.click(within(dialog).getByRole('radio', { name: "Unarchive them with the file's settings" }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1,002 keywords');
      expect(await within(dialog).findByText(COULD_NOT_CONTINUE)).toBeInTheDocument();
      expect(sent).toEqual([
        { count: 1000, action: 'merge' },
        { count: 1, action: 'merge' },
      ]);

      // The first batch is applied on the API, so leaving them archived must say so for every row
      await press(dialog, 'Back');
      await user.click(within(dialog).getByRole('radio', { name: 'Leave them archived' }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1 keyword');
      await waitFor(() => expect(changes.at(-1)).toBe(false));
      expect(sent.slice(2)).toEqual([
        { count: 1000, action: 'skip' },
        { count: 1, action: 'skip' },
      ]);
    },
    SLOW_TEST,
  );

  it(
    'does the same when the answer to the first request is lost',
    async () => {
      const sent: string[] = [];
      server.use(
        http.patch(mswPath(IMPORT), async ({ request }) => {
          const { row_actions: actions } = ROW_ACTIONS.parse(await request.clone().json());
          sent.push(actions.map((item) => item.action).join());
          return sent.length === 1 ? HttpResponse.error() : undefined;
        }),
      );
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const dialog = await toReview(user, 'keyword\nseo meme\nbacklink watcher');
      await user.click(within(dialog).getByRole('radio', { name: "Unarchive them with the file's settings" }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 2 keywords');
      expect(await within(dialog).findByText(COULD_NOT_CONTINUE)).toBeInTheDocument();
      await press(dialog, 'Back');
      await user.click(within(dialog).getByRole('radio', { name: 'Leave them archived' }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1 keyword');
      await waitFor(() => expect(changes.at(-1)).toBe(false));
      expect(sent).toEqual(['merge', 'skip']);
    },
    SLOW_TEST,
  );

  it(
    'shows on Review and Confirm that unarchiving goes over the limit, as the answer to the row actions says',
    async () => {
      const confirms = spy('post', CONFIRM_PATH);
      server.use(
        http.patch(mswPath(IMPORT), async ({ request }) => {
          const real = await realImport(request);
          return HttpResponse.json(
            { data: { ...real, quota: { limit: 10, used: 9, would_use: 12 } } },
            { status: 202 },
          );
        }),
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const dialog = await toReview(user, 'keyword\nseo meme\nbacklink watcher');
      await user.click(within(dialog).getByRole('radio', { name: "Unarchive them with the file's settings" }));
      await press(dialog, 'Continue');
      await press(dialog, 'Import 2 keywords');
      expect(await within(dialog).findByText("The import is over your plan's keyword limit.")).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Import 2 keywords' })).toBeDisabled();
      expect(confirms.bodies).toEqual([]);
      await press(dialog, 'Back');
      expect(
        within(dialog).getByText(
          "2 keywords are over your plan's limit of 10. Skip rows or archive keywords, then import again.",
        ),
      ).toBeInTheDocument();
    },
    SLOW_TEST,
  );
});

describe('Import dialog: Back and Continue', () => {
  it(
    'opens Map again after Back from Map, when the import still needs its mapping',
    async () => {
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword,tags\nrank tracker api,blog'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      expect(within(dialog).getByText('Choose the vocabulary these terms belong to.')).toBeInTheDocument();
      await choose(user, dialog, 'Vocabulary for tags', 'Topics');
      await press(dialog, 'Back');
      await press(dialog, 'Continue');
      // Not "could not continue": the file is the same, so the person goes on to the step that fixes it
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      expect(within(dialog).queryByText(COULD_NOT_CONTINUE)).toBeNull();
      expect(within(dialog).getByRole('combobox', { name: 'Vocabulary for tags' })).toHaveTextContent('Topics');
      expect(patches.bodies).toEqual([]);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      expect(patches.bodies).toMatchObject([{ defaults: { tags_vocabulary_id: MOCK_VOCABULARY_IDS.topics } }]);
    },
    SLOW_TEST,
  );

  it(
    'changes the defaults of the import it has, keeping the mapping, when only an option changed',
    async () => {
      const uploads = spy('post', IMPORTS);
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword,notes\nbacklink watcher,x\nrank tracker api,y'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      await choose(user, dialog, 'notes', 'Group');
      await press(dialog, 'Back');
      await choose(user, dialog, 'Device', 'Mobile');
      await press(dialog, 'Continue');
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      // The file is not sent again, and what was chosen on Map is still chosen
      expect(uploads.bodies).toHaveLength(1);
      expect(patches.bodies).toHaveLength(1);
      expect(patches.bodies[0]).toMatchObject({ defaults: { device: 'mobile' } });
      expect(patches.bodies[0]).not.toHaveProperty('column_mapping');
      expect(within(dialog).getByRole('combobox', { name: 'notes' })).toHaveTextContent('Group');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      expect(patches.bodies).toHaveLength(2);
      expect(patches.bodies[1]).toMatchObject({
        column_mapping: { keyword: 'keyword', notes: 'group' },
        defaults: { device: 'mobile' },
      });
    },
    SLOW_TEST,
  );

  it(
    'does not offer a jump to the old Review once Map has the file read again',
    async () => {
      // Once the file is read again the API is not ready with a preview, for as long as the test says
      let unready = false;
      answerImportAs((view) =>
        unready && view.status === 'preview_ready'
          ? { ...view, status: 'needs_mapping', error_code: 'keyword_column_missing' }
          : view,
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword,notes\nbacklink watcher,x\nrank tracker api,y'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Continue');
      await within(dialog).findByText(/^When you confirm/);
      const steps = within(dialog).getByRole('list', { name: 'Import steps' });
      await user.click(within(steps).getByRole('button', { name: /^Map columns/ }));
      // Nothing is read again yet: the person may still go back to the Review they had
      expect(within(steps).getByRole('button', { name: /^Review/ })).toBeInTheDocument();
      unready = true;
      await choose(user, dialog, 'notes', 'Group');
      await press(dialog, 'Continue');
      // The file was read again and the counts of the old Review are gone with it: no jump back to them
      await within(dialog).findByText(COULD_NOT_CONTINUE, undefined, PARSED);
      expect(within(steps).queryByRole('button', { name: /^Review/ })).toBeNull();
    },
    SLOW_TEST,
  );
});

describe('Import dialog: the mapping of the API and the headers of the file', () => {
  /** The API said the keys as the file wrote them, with spaces and in another case. */
  function echoRawKeys(): void {
    answerImportAs((view) => ({
      ...view,
      column_mapping: Object.fromEntries(
        Object.entries(view.column_mapping).map(([header, field]) => [
          header === 'keyword' ? 'KEYWORD' : ` ${header} `,
          field,
        ]),
      ),
    }));
  }

  it(
    'shows each column once and sends nothing when the keys are the same headers in other spelling',
    async () => {
      echoRawKeys();
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword, group\nbacklink watcher,Services\nrank tracker api,Blog'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      expect(within(dialog).getByRole('combobox', { name: 'keyword' })).toHaveTextContent('Keyword');
      expect(within(dialog).getByRole('combobox', { name: 'group' })).toHaveTextContent('Group');
      expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      expect(patches.bodies).toEqual([]);
    },
    SLOW_TEST,
  );

  it(
    'leaves no entry of the API in the mapping it sends',
    async () => {
      echoRawKeys();
      const patches = spy('patch', IMPORT);
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword, group\nbacklink watcher,Services\nrank tracker api,Blog'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      await choose(user, dialog, 'group', 'Ignore');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      expect(patches.bodies).toMatchObject([{ column_mapping: { keyword: 'keyword' } }]);
      expect(
        Object.keys(
          z.object({ column_mapping: z.record(z.string(), z.string()) }).parse(patches.bodies[0]).column_mapping,
        ),
      ).toEqual(['keyword']);
    },
    SLOW_TEST,
  );
});

describe('Import dialog: the session ends during an upload', () => {
  it('hands a 401 of the upload to the signed-out handling, as every request of the app does', async () => {
    server.use(http.post(mswPath(IMPORTS), ({ request }) => problem(request, 'session_expired')));
    const onSignedOut = vi.fn(() => false);
    const { user } = renderWithProviders(<Controlled changes={[]} />, { onSignedOut });
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });
});

describe('Import dialog: a Confirm that answers late', () => {
  it(
    'tells the header about the write, and moves nobody, when the dialog was closed meanwhile',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const reached = gate();
      const answer = gate();
      server.use(
        http.post(mswPath(CONFIRM_PATH), async () => {
          reached.open();
          await answer.promise;
          return undefined;
        }),
      );
      const changes: boolean[] = [];
      const controls = routeControls();
      const { user } = renderWithProviders(<Controlled changes={changes} controls={controls} />);
      const { dialog } = await openImport(user);
      await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
      await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
      await user.paste('rank tracker api\nbacklink watcher');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Continue');
      await press(dialog, 'Import 2 keywords');
      await reached.promise;
      // The browser's Back button closes the route's dialog while Confirm is on its way
      act(() => controls.close());
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
      answer.open();
      expect(await screen.findByRole('progressbar', { name: 'Importing keywords' }, WRITTEN)).toBeInTheDocument();
      // The write started, so nothing cancels it, and the route is not asked to close what is closed already
      expect(changes).toEqual([true]);
      expect(cancels.bodies).toEqual([]);
    },
    SLOW_TEST,
  );
});

describe('Import dialog: closing', () => {
  it(
    'cancels an import the upload made even when the dialog closes while it is first read',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const asked = gate();
      const read = gate();
      let reads = 0;
      server.use(
        http.get(mswPath(IMPORT), async () => {
          reads += 1;
          if (reads === 1) {
            asked.open();
            await read.promise;
          }
          return undefined;
        }),
      );
      const controls = routeControls();
      const { user } = renderWithProviders(<Controlled changes={[]} controls={controls} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await asked.promise;
      act(() => controls.close());
      read.open();
      await waitFor(() => expect(cancels.bodies).toHaveLength(1));
    },
    SLOW_TEST,
  );

  it(
    'stops the import once, whether the dialog or the screen goes first',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const controls = routeControls();
      const { user, unmount } = renderWithProviders(<Controlled changes={[]} controls={controls} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      act(() => controls.close());
      await waitFor(() => expect(cancels.bodies).toHaveLength(1));
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(cancels.bodies).toHaveLength(1);
    },
    SLOW_TEST,
  );

  it(
    'does not cancel the import it confirmed when the screen goes away after it',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const { user, unmount } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
      await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
      await user.paste('rank tracker api');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1 keyword');
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(cancels.bodies).toEqual([]);
    },
    SLOW_TEST,
  );

  it(
    'cancels an import that is being read when the screen goes away',
    async () => {
      const cancels = spy('post', CANCEL_PATH);
      const uploads = spy('post', IMPORTS);
      const { user, unmount } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await waitFor(() => expect(uploads.bodies).toHaveLength(1));
      unmount();
      await waitFor(() => expect(cancels.bodies).toHaveLength(1));
    },
    SLOW_TEST,
  );

  it(
    'stops an upload that is under way when the screen goes away, so nothing is sent after it',
    async () => {
      const held = gate();
      uploadScript.hold = held.promise;
      const uploads = spy('post', IMPORTS);
      const cancels = spy('post', CANCEL_PATH);
      const { user, unmount } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await within(dialog).findByRole('progressbar', { name: 'Uploading keywords.csv' });
      unmount();
      held.open();
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(uploads.bodies).toEqual([]);
      expect(cancels.bodies).toEqual([]);
    },
    SLOW_TEST,
  );

  it(
    'keeps what the dialog showed while it closes, and starts empty when it opens again',
    async () => {
      const animation = gate();
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      // The dialog's exit animation takes as long as the test says
      Object.defineProperty(Element.prototype, 'getAnimations', {
        value: () => [{ finished: animation.promise }],
        configurable: true,
        writable: true,
      });
      await press(dialog, 'Close');
      await user.click(
        await within(await screen.findByRole('alertdialog')).findByRole('button', { name: 'Stop import' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      // Still closing: the steps are those of the import, not an empty first step
      expect(screen.queryByText('Drop a CSV file here, or choose one')).toBeNull();
      animation.open();
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Import' }));
      const again = await screen.findByRole('dialog', { name: 'Import keywords' });
      expect(within(again).getByText('Drop a CSV file here, or choose one')).toBeInTheDocument();
    },
    SLOW_TEST,
  );
});

describe('Import dialog: the file', () => {
  it('tells a file that cannot be read, and goes on with the next one', async () => {
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    const unreadable = csv('keyword\nseo');
    const failing = new Blob([]);
    Object.defineProperty(failing, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('The file is not readable', 'NotReadableError')),
    });
    Object.defineProperty(unreadable, 'slice', { value: () => failing });
    await user.upload(fileInput(), unreadable);
    expect(await within(dialog).findByText('This file could not be read.')).toBeInTheDocument();
    await chooseFile(user, dialog, csv('keyword\nseo'));
    expect(within(dialog).queryByText('This file could not be read.')).toBeNull();
  });

  it('refuses a file with two columns of one name, and a file with a header line only', async () => {
    const uploads = spy('post', IMPORTS);
    const permissive = userEvent.setup({ applyAccept: false });
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await permissive.upload(fileInput(), csv('keyword, Keyword\nseo,seo'));
    expect(
      await within(dialog).findByText(
        'Two columns of this file have the same name. Rename one of them and choose the file again.',
      ),
    ).toBeInTheDocument();
    await permissive.upload(fileInput(), csv('keyword,tags\n'));
    expect(
      await within(dialog).findByText('This file has a header line and no rows. Add the keywords below it.'),
    ).toBeInTheDocument();
    await press(dialog, 'Continue');
    expect(within(dialog).getByText('Choose a CSV file to import.')).toBeInTheDocument();
    expect(uploads.bodies).toEqual([]);
  });

  it('reads a file whose lines end in a lone CR', async () => {
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword,notes\rbacklink watcher,x\rrank tracker api,y'));
    await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
    expect(within(dialog).getByRole('combobox', { name: 'notes' })).toBeInTheDocument();
  });

  it('shows how far the upload has gone, in numbers and in words', async () => {
    const held = gate();
    uploadScript.events = [
      { loaded: 25, total: 100 },
      { loaded: 60, total: 100 },
    ];
    uploadScript.hold = held.promise;
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const { dialog } = await openImport(user);
    await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
    const bar = await within(dialog).findByRole('progressbar', { name: 'Uploading keywords.csv' });
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveAttribute('aria-valuetext', '60% uploaded');
    held.open();
    await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
  });

  it(
    'puts focus on Choose file after Start again',
    async () => {
      answerImportAs((view) => ({ ...view, status: 'expired' }));
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword\nbacklink watcher'));
      await within(dialog).findByText(/^This preview expired/, undefined, PARSED);
      await press(dialog, 'Start again');
      expect(within(dialog).getByRole('button', { name: 'Choose file' })).toHaveFocus();
    },
    SLOW_TEST,
  );
});

describe('Import dialog: vocabularies', () => {
  const optionNames = async (): Promise<string[]> =>
    (await screen.findAllByRole('option')).map((option) => option.textContent ?? '');

  async function pasteWithTags(user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> {
    const { dialog } = await openImport(user);
    await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
    await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
    await user.paste('rank tracker api\tblog');
    return dialog;
  }

  it('offers every vocabulary to a member of every project', async () => {
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const dialog = await pasteWithTags(user);
    await user.click(within(dialog).getByRole('combobox', { name: 'Vocabulary for tags' }));
    expect(await optionNames()).toEqual(['Services', 'Topics']);
  });

  it('offers a member limited to some projects the vocabularies of a project only, in Upload and in Map', async () => {
    const { user } = renderWithProviders(<Controlled changes={[]} projectIds={[fynix.project_id]} />);
    const dialog = await pasteWithTags(user);
    await user.click(within(dialog).getByRole('combobox', { name: 'Vocabulary for tags' }));
    expect(await optionNames()).toEqual(['Services']);
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('radio', { name: 'CSV file' }));
    await uploadAndContinue(user, dialog, csv('keyword,tags\nrank tracker api,blog'));
    await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
    await user.click(within(dialog).getByRole('combobox', { name: 'Vocabulary for tags' }));
    expect(await optionNames()).toEqual(['Services']);
  });

  it(
    'puts the API refusal of a vocabulary on the vocabulary, with a way to choose another',
    async () => {
      server.use(
        http.patch(mswPath(IMPORT), ({ request }) =>
          invalidField(
            request,
            'defaults.tags_vocabulary_id',
            'vocabulary_not_allowed',
            'Choose a vocabulary of this project.',
          ),
        ),
      );
      const { user } = renderWithProviders(<Controlled changes={[]} />);
      const { dialog } = await openImport(user);
      await uploadAndContinue(user, dialog, csv('keyword,tags\nrank tracker api,blog'));
      await within(dialog).findByText(MAP_INTRO, undefined, PARSED);
      await choose(user, dialog, 'Vocabulary for tags', 'Topics');
      await press(dialog, 'Continue');
      expect(
        await within(dialog).findByText(
          'Choose a vocabulary of this project. Vocabularies shared by every project are for admins.',
        ),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('combobox', { name: 'Vocabulary for tags' })).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(within(dialog).queryByText(COULD_NOT_CONTINUE)).toBeNull();
      await choose(user, dialog, 'Vocabulary for tags', 'Services');
      expect(
        within(dialog).queryByText(
          'Choose a vocabulary of this project. Vocabularies shared by every project are for admins.',
        ),
      ).toBeNull();
    },
    SLOW_TEST,
  );

  it(
    'says a refused Confirm is about a shared vocabulary, and not about permission to import',
    async () => {
      server.use(http.post(mswPath(CONFIRM_PATH), ({ request }) => problem(request, 'forbidden')));
      const changes: boolean[] = [];
      const { user } = renderWithProviders(<Controlled changes={changes} />);
      const { dialog } = await openImport(user);
      await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
      await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
      await user.paste('rank tracker api');
      await press(dialog, 'Continue');
      await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
      await press(dialog, 'Continue');
      await press(dialog, 'Import 1 keyword');
      expect(
        await within(dialog).findByText(
          'This import uses a vocabulary shared across the workspace. Choose a vocabulary of this project, or ask an admin.',
        ),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText('Importing keywords needs permission to import.')).toBeNull();
      expect(changes).toEqual([true]);
    },
    SLOW_TEST,
  );

  it('says the vocabularies are loading, then offers them', async () => {
    const loaded = gate();
    server.use(
      http.get(mswPath(VOCABULARIES), async () => {
        await loaded.promise;
        return undefined;
      }),
    );
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const dialog = await pasteWithTags(user);
    expect(within(dialog).getByText('Loading vocabularies')).toBeInTheDocument();
    loaded.open();
    await user.click(await within(dialog).findByRole('combobox', { name: 'Vocabulary for tags' }));
    expect(await optionNames()).toEqual(['Services', 'Topics']);
    expect(within(dialog).queryByText('Loading vocabularies')).toBeNull();
  });

  it('says the vocabularies could not be loaded, and loads them again on Retry', async () => {
    let failing = true;
    server.use(
      http.get(mswPath(VOCABULARIES), ({ request }) => (failing ? problem(request, 'rate_limited') : undefined)),
    );
    const { user } = renderWithProviders(<Controlled changes={[]} />);
    const dialog = await pasteWithTags(user);
    expect(await within(dialog).findByText('The vocabularies could not be loaded.')).toBeInTheDocument();
    failing = false;
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await user.click(await within(dialog).findByRole('combobox', { name: 'Vocabulary for tags' }));
    expect(await optionNames()).toEqual(['Services', 'Topics']);
    expect(within(dialog).queryByText('The vocabularies could not be loaded.')).toBeNull();
  });
});
