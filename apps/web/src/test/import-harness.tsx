import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getResponse, http, HttpResponse } from 'msw';
import { useEffect, useState, type ReactElement } from 'react';
import { expect } from 'vitest';
import { z } from 'zod';

import { IMPORT } from '@/features/rankings/import/import-queries';
import type { KeywordImport, Role } from '@/lib/api/types';
import { handlers } from '@/mocks/handlers';
import { mswPath } from '@/mocks/respond';
import { KEYWORD_IMPORT } from '@/test/api-shapes';
import { server } from '@/test/msw';
import { fynix, loadedGrid, rankingsAs } from '@/test/rankings-harness';
import type { ProvidedRender } from '@/test/render';

/** What the tests of the import dialog and its header progress share. */

/** A parse of the mocks takes 1.5 seconds and the dialog asks again every second. */
export const PARSED = { timeout: 8_000 };
export const SLOW_TEST = 30_000;
/** The header asks about a write every 5 seconds, and the mock writes three rows in 3. */
export const WRITTEN = { timeout: 15_000 };
export const WRITE_TEST = 40_000;

export const PROJECT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
export const UPLOAD = `${PROJECT}/keyword-imports/upload`;
const IMPORT_SHAPE = z.object({ data: KEYWORD_IMPORT });

export const csv = (text: string, name = 'keywords.csv'): File => new File([text], name, { type: 'text/csv' });

/** Every request of a route, with its JSON body, answered as before: `return undefined` passes it on. */
export function spy(method: 'post' | 'patch' | 'get', path: string): { bodies: unknown[] } {
  const seen: { bodies: unknown[] } = { bodies: [] };
  const handler = async ({ request }: { request: Request }): Promise<undefined> => {
    const text = await request.clone().text();
    seen.bodies.push(text === '' ? null : text.startsWith('{') ? JSON.parse(text) : text);
    return undefined;
  };
  server.use(http[method](mswPath(path), handler));
  return seen;
}

/** What the mocks themselves answer to `request`, the import it is about: the tests change it and answer that. */
export async function realImport(request: Request): Promise<KeywordImport> {
  const real = await getResponse([...handlers], request.clone());
  return IMPORT_SHAPE.parse(await real?.json()).data;
}

/** The answers about an import, changed by `change`: what the API would say of an import in another state. */
export function answerImportAs(change: (view: KeywordImport) => KeywordImport): void {
  server.use(
    http.get(mswPath(IMPORT), async ({ request }) =>
      HttpResponse.json({ data: change(await realImport(new Request(request.url, { headers: request.headers }))) }),
    ),
  );
}

/** What a test holds to close the dialog the way the route does (the browser's Back button). */
export interface RouteControls {
  /** Closes the dialog from outside, as the route does; does nothing before the screen has mounted. */
  close: () => void;
  /** Called by the screen under test with the way to close its dialog. */
  register: (close: () => void) => void;
}

export function routeControls(): RouteControls {
  let closer: () => void = () => undefined;
  return {
    close: () => closer(),
    register: (close) => {
      closer = close;
    },
  };
}

/** Rankings with the Import button wired to a state, as the route does. */
export function Controlled({
  member = 'editor',
  changes,
  projectIds = null,
  controls,
}: {
  member?: Role;
  changes: boolean[];
  projectIds?: readonly string[] | null;
  controls?: RouteControls;
}): ReactElement {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    controls?.register(() => setOpen(false));
  }, [controls]);
  return rankingsAs(
    member,
    fynix.project_id,
    {
      importOpen: open,
      onImportOpenChange: (next) => {
        changes.push(next);
        setOpen(next);
      },
    },
    projectIds,
  );
}

export async function openImport(
  user: ProvidedRender['user'],
  changes: boolean[] = [],
): Promise<{ dialog: HTMLElement; changes: boolean[] }> {
  await loadedGrid();
  await user.click(screen.getByRole('button', { name: 'Import' }));
  return { dialog: await screen.findByRole('dialog', { name: 'Import keywords' }), changes };
}

/** The value of a metric of the strip: the definition after the term named `label`. */
export function countIn(strip: HTMLElement, label: string): HTMLElement {
  const value = within(strip).getByText(label).closest('dt')?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`The summary has no count for ${label}`);
  return value;
}

export const fileInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('The dialog has no file input');
  return input;
};

export const press = (dialog: HTMLElement, name: string): Promise<void> =>
  userEvent.click(within(dialog).getByRole('button', { name }));

/** Chooses `option` in the Select named `name`. */
export async function choose(
  user: ProvidedRender['user'],
  dialog: HTMLElement,
  name: string,
  option: string,
): Promise<void> {
  await user.click(within(dialog).getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

/** Chooses `file` in the Upload step and waits for it to be read. */
export async function chooseFile(user: ProvidedRender['user'], dialog: HTMLElement, file: File): Promise<void> {
  await user.upload(fileInput(), file);
  await within(dialog).findByText(new RegExp(`^${file.name}, `));
}

/** Uploads `file` and continues to the next step. */
export async function uploadAndContinue(user: ProvidedRender['user'], dialog: HTMLElement, file: File): Promise<void> {
  await chooseFile(user, dialog, file);
  await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
}

export const NEW_AND_TAGGED = [
  'keyword,tags',
  'rank tracker api,blog',
  'seo audit,guides',
  'site:example.com seo,blog',
  'backlink watcher,blog',
].join('\n');

export const MAP_INTRO = /^Choose what each column of the file holds/;

/** Pastes `text`, goes through Review and Confirm, and presses the last button. */
export async function importPaste(user: ProvidedRender['user'], text: string, button: string): Promise<void> {
  const { dialog } = await openImport(user);
  await user.click(within(dialog).getByRole('radio', { name: 'Paste' }));
  await user.click(within(dialog).getByRole('textbox', { name: 'Keywords' }));
  await user.paste(text);
  await press(dialog, 'Continue');
  await within(dialog).findByRole('heading', { name: 'New' }, PARSED);
  await press(dialog, 'Continue');
  await press(dialog, button);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import keywords' })).toBeNull());
}
