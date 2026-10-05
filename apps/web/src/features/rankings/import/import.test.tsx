import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getResponse, http, HttpResponse } from 'msw';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CANCEL_PATH, CONFIRM_PATH, IMPORT } from './import-queries';
import type { Role } from '@/lib/api/types';
import { MOCK_VOCABULARY_IDS } from '@/mocks/entity-fixtures';
import { handlers } from '@/mocks/handlers';
import { mswPath, problem } from '@/mocks/respond';
import { KEYWORD_IMPORT } from '@/test/api-shapes';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { fynix, loadedGrid, rankingsAs as as, restoreWideScreen, stubWideScreen } from '@/test/rankings-harness';
import { renderWithProviders, type ProvidedRender } from '@/test/render';

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
afterEach(restoreWideScreen);

/** A parse of the mocks takes 1.5 seconds and the dialog asks again every second. */
const PARSED = { timeout: 8_000 };
const SLOW_TEST = 30_000;

const PROJECT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const UPLOAD = `${PROJECT}/keyword-imports/upload`;
const IMPORT_SHAPE = z.object({ data: KEYWORD_IMPORT });

const csv = (text: string, name = 'keywords.csv'): File => new File([text], name, { type: 'text/csv' });

/** Every request of a route, with its JSON body, answered as before: `return undefined` passes it on. */
function spy(method: 'post' | 'patch' | 'get', path: string): { bodies: unknown[] } {
  const seen: { bodies: unknown[] } = { bodies: [] };
  const handler = async ({ request }: { request: Request }): Promise<undefined> => {
    const text = await request.clone().text();
    seen.bodies.push(text === '' ? null : text.startsWith('{') ? JSON.parse(text) : text);
    return undefined;
  };
  server.use(http[method](mswPath(path), handler));
  return seen;
}

/** The answers about an import, changed by `change`: what the API would say of an import in another state. */
function answerImportAs(change: (view: z.infer<typeof KEYWORD_IMPORT>) => z.infer<typeof KEYWORD_IMPORT>): void {
  server.use(
    http.get(mswPath(IMPORT), async ({ request }) => {
      const real = await getResponse([...handlers], new Request(request.url, { headers: request.headers }));
      const body = IMPORT_SHAPE.parse(await real?.json());
      return HttpResponse.json({ data: change(body.data) });
    }),
  );
}

/** Rankings with the Import button wired to a state, as the route does. */
function Controlled({ member = 'editor', changes }: { member?: Role; changes: boolean[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return as(member, fynix.project_id, {
    importOpen: open,
    onImportOpenChange: (next) => {
      changes.push(next);
      setOpen(next);
    },
  });
}

async function openImport(
  user: ProvidedRender['user'],
  changes: boolean[] = [],
): Promise<{ dialog: HTMLElement; changes: boolean[] }> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Import' }));
  return { dialog: await screen.findByRole('dialog', { name: 'Import keywords' }), changes };
}

/** The value of a metric of the strip: the definition after the term named `label`. */
function countIn(strip: HTMLElement, label: string): HTMLElement {
  const value = within(strip).getByText(label).closest('dt')?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`The summary has no count for ${label}`);
  return value;
}

const fileInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('The dialog has no file input');
  return input;
};

const press = (dialog: HTMLElement, name: string): Promise<void> =>
  userEvent.click(within(dialog).getByRole('button', { name }));

/** Chooses `option` in the Select named `name`. */
async function choose(user: ProvidedRender['user'], dialog: HTMLElement, name: string, option: string): Promise<void> {
  await user.click(within(dialog).getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Uploads `file` and continues to the next step. */
async function uploadAndContinue(user: ProvidedRender['user'], dialog: HTMLElement, file: File): Promise<void> {
  await user.upload(fileInput(), file);
  await within(dialog).findByText(new RegExp(`^${file.name}, `));
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
}

const NEW_AND_TAGGED = [
  'keyword,tags',
  'rank tracker api,blog',
  'seo audit,guides',
  'site:example.com seo,blog',
  'backlink watcher,blog',
].join('\n');

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
