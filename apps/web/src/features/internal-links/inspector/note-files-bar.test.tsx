import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Route } from 'next';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DrawerNotesTab } from './drawer-notes-tab';
import type { PageDrawerContext } from './page-drawer-context';
import { announce } from '@/lib/a11y/announcer';
import { problemFrom, type ApiProblem } from '@/lib/api/problem';
import { clearAllNoteDrafts, noteDraftPending } from '@/lib/pages/note-drafts';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { SESSION_COOKIE } from '@/mocks/session';
import { axeWithNoteBox } from '@/test/axe-note-box';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/a11y/announcer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/a11y/announcer')>()),
  announce: vi.fn(),
}));

/**
 * Under jsdom MSW cannot read a multipart body (its interception cannot read jsdom's `FormData`; see `fetch-upload.ts`),
 * so the upload goes straight to the mock's store, which the notes routes read. The real upload is covered by the
 * mocks' own tests and by `note-uploads.test.tsx`. A test sets `script.respond` to answer in its own way.
 */
const script = vi.hoisted(() => ({
  respond: null as ((file: File, signal: AbortSignal | undefined) => Promise<unknown>) | null,
  calls: 0,
}));
vi.mock('@/lib/api/upload', async (importOriginal) => {
  const { uploadFile } = await import('@/mocks/internal-links-notes');
  const { problemFrom } = await import('@/lib/api/problem');
  return {
    ...(await importOriginal<typeof import('@/lib/api/upload')>()),
    uploadForm: async (path: string, form: FormData, options: { signal?: AbortSignal } = {}): Promise<unknown> => {
      const sent = form.get('file');
      if (sent === null || typeof sent === 'string') throw new TypeError('The form has no file');
      script.calls += 1;
      // An answer of `undefined` leaves the file to the mock's own store
      const scripted = await script.respond?.(sent, options.signal);
      if (scripted !== undefined) return scripted;
      const [, workspaceId = '', projectId = '', urlId = ''] =
        /workspaces\/([^/]+)\/projects\/([^/]+)\/internal-links\/pages\/([^/]+)\//.exec(path) ?? [];
      const editor = mockUser('editor');
      const stored = uploadFile(
        workspaceId,
        projectId,
        urlId,
        { id: editor.user_id, name: editor.name, role: 'editor', writes: true },
        { name: sent.name, type: sent.type, bytes: new Uint8Array(await sent.arrayBuffer()) },
      );
      if (stored.ok) return { data: stored.file };
      throw problemFrom(new Response(null, { status: 415 }), { code: 'unsupported_media_type' });
    },
  };
});

const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const PRICING = '108';
const MB = 1024 * 1024;

const context: PageDrawerContext = {
  scope: SCOPE,
  crawl: { crawl: null, run: null, older: false, linksAvailable: true, unknown: false },
  linkScope: 'editorial',
  tiers: [],
  timeZone: 'UTC',
  canWrite: false,
  canNote: true,
  openPage: () => undefined,
  hrefs: {
    journey: () => '/journey' as Route,
    linksFrom: () => '/from' as Route,
    linksTo: () => '/to' as Route,
    issueCheck: () => null,
    taxonomy: '/taxonomy' as Route,
    integrations: '/integrations' as Route,
  },
};

const Tab = (): ReactElement => <DrawerNotesTab context={context} urlId={PRICING} path="/pricing" active />;

/** A file with real bytes, so the mock server keeps it; `size` can be forced for the checks that go by size. */
const file = (name: string, type: string, size = 8): File => {
  const made = new File([new Uint8Array(8).fill(65)], name, { type, lastModified: 1 });
  if (size !== 8) Object.defineProperty(made, 'size', { value: size });
  return made;
};
const png = (name: string): File => file(name, 'image/png');
const refusal = (status: number, code: string): ApiProblem => problemFrom(new Response(null, { status }), { code });

const area = (): Promise<HTMLElement> => screen.findByRole('combobox', { name: 'Add a note to /pricing' });
const chooser = (container: HTMLElement): HTMLInputElement => {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('No file input');
  return input;
};
const choose = (container: HTMLElement, files: File[]): void => {
  fireEvent.change(chooser(container), { target: { files } });
};
/** The refusal line of the box (the app's own live region is an alert too, and empty). */
const alertLine = (): string => {
  const line = screen.getAllByRole('alert').find((node) => node.tagName === 'P');
  if (line === undefined) throw new Error('No refusal line');
  return line.textContent;
};

beforeEach(() => {
  clearAllNoteDrafts();
  script.respond = null;
  script.calls = 0;
  vi.mocked(announce).mockClear();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  server.events.removeAllListeners();
});

describe('choosing files', () => {
  it('has a paperclip named Attach files and a chooser that is multiple, limited to the seven types, and no tab stop', async () => {
    const { container } = renderWithProviders(<Tab />);
    await area();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument();
    const input = chooser(container);
    expect(input).toHaveAttribute('multiple');
    expect(input.accept.split(',')).toHaveLength(7);
    expect(input).toHaveAttribute('tabindex', '-1');
  });

  it('opens the chooser from the paperclip', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    const open = vi.spyOn(chooser(container), 'click');
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows a chip for each file with its name and size, and Remove takes it out and frees its preview', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('shot.png'), file('data.csv', 'text/csv')]);
    const list = screen.getByRole('list', { name: 'Files in this note' });
    expect(within(list).getByText('shot.png')).toBeInTheDocument();
    expect(within(list).getByText('data.csv')).toBeInTheDocument();
    expect(list.querySelectorAll('img')).toHaveLength(1);
    expect(list.querySelector('img')).toHaveAttribute('alt', '');
    await user.click(within(list).getByRole('button', { name: 'Remove shot.png' }));
    expect(within(list).queryByText('shot.png')).not.toBeInTheDocument();
    expect(vi.mocked(URL.revokeObjectURL)).toHaveBeenCalledWith('blob:preview');
  });

  it('enables Add note for files with no text, and not for neither', async () => {
    const { container } = renderWithProviders(<Tab />);
    await area();
    const add = screen.getByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    choose(container, [png('a.png')]);
    expect(add).toBeEnabled();
  });
});

describe('drop and paste', () => {
  const zoneOf = (element: HTMLElement): Element => {
    const zone = element.closest('[data-slot="field"]');
    if (zone === null) throw new Error('No box');
    return zone;
  };

  it('says Drop files to attach while files are dragged over the box, and attaches what is dropped', async () => {
    renderWithProviders(<Tab />);
    const zone = zoneOf(await area());
    const dataTransfer = { types: ['Files'], files: [png('dropped.png')] };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(screen.getByText('Drop files to attach')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer });
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
    expect(screen.getByText('dropped.png')).toBeInTheDocument();
  });

  it('leaves a drop of text to the text area', async () => {
    renderWithProviders(<Tab />);
    const zone = zoneOf(await area());
    const dataTransfer = { types: ['text/plain'], files: [] };
    fireEvent.dragEnter(zone, { dataTransfer });
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument();
    expect(fireEvent.drop(zone, { dataTransfer })).toBe(true);
    expect(screen.queryByRole('list', { name: 'Files in this note' })).not.toBeInTheDocument();
  });

  it('attaches a picture pasted from the clipboard and pastes no text', async () => {
    renderWithProviders(<Tab />);
    const box = await area();
    const allowed = fireEvent.paste(box, { clipboardData: { files: [png('clip.png')], getData: () => '' } });
    expect(allowed).toBe(false);
    expect(screen.getByText('clip.png')).toBeInTheDocument();
    expect(box).toHaveValue('');
  });

  it('pastes text as text even when a file comes with it', async () => {
    renderWithProviders(<Tab />);
    const box = await area();
    const allowed = fireEvent.paste(box, { clipboardData: { files: [png('cells.png')], getData: () => 'a b' } });
    expect(allowed).toBe(true);
    expect(screen.queryByText('cells.png')).not.toBeInTheDocument();
  });
});

describe('refusals', () => {
  it('says why in one line: a sixth file, a wrong type, a file over 10 MB, all at once', async () => {
    const { container } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('1.png'), png('2.png'), png('3.png'), png('4.png'), png('5.png')]);
    choose(container, [png('6.png')]);
    expect(alertLine()).toBe('At most 5 files per note.');
    // Remove one, then three problems in one go
    fireEvent.click(screen.getByRole('button', { name: 'Remove 5.png' }));
    choose(container, [
      file('a.zip', 'application/zip'),
      file('huge.png', 'image/png', 11 * MB),
      png('7.png'),
      png('8.png'),
    ]);
    expect(alertLine()).toBe(
      'a.zip: only images (PNG, JPEG, GIF, WebP), PDF, text and CSV files. huge.png: over 10 MB. At most 5 files per note.',
    );
    expect(screen.getAllByRole('alert').filter((node) => node.tagName === 'P')).toHaveLength(1);
  });

  it('keeps the accepted files, and clears the line with the next accepted file', async () => {
    const { container } = renderWithProviders(<Tab />);
    await area();
    choose(container, [file('a.zip', 'application/zip'), png('ok.png')]);
    expect(alertLine()).toContain('a.zip');
    expect(screen.getByText('ok.png')).toBeInTheDocument();
    choose(container, [png('next.png')]);
    expect(alertLine()).toBe('');
  });

  it('words an empty file and a file chosen twice', async () => {
    const { container } = renderWithProviders(<Tab />);
    await area();
    choose(container, [file('none.png', 'image/png', 0), png('twice.png')]);
    choose(container, [png('twice.png')]);
    expect(alertLine()).toBe('twice.png is already in this note.');
    choose(container, [file('none.png', 'image/png', 0)]);
    expect(alertLine()).toBe('none.png is empty.');
  });
});

describe('saving a note with files', () => {
  it('uploads the files one by one, adds the note with them, empties the box and keeps the focus', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const box = await area();
    await user.type(box, 'See the shots');
    choose(container, [png('one.png'), file('two.csv', 'text/csv')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const list = await screen.findByRole('list', { name: 'Notes, newest first' });
    await waitFor(() => {
      expect(within(list).getByRole('link', { name: /^one\.png, 8 B\. Opens in a new tab\.$/ })).toBeInTheDocument();
    });
    expect(within(list).getByRole('link', { name: /^two\.csv, 8 B\. Opens in a new tab\.$/ })).toBeInTheDocument();
    expect(script.calls).toBe(2);
    expect(vi.mocked(announce).mock.calls.map((call) => call[0])).toContain('Uploading 2 of 2 files');
    expect(vi.mocked(announce).mock.calls.filter((call) => call[0] === 'Uploading 1 of 2 files')).toHaveLength(1);
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
    expect(noteDraftPending(SCOPE, PRICING)).toEqual([]);
  });

  it('saves a note of a file and no text, with no empty paragraph', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('only.png')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const link = await screen.findByRole('link', { name: /only\.png/ });
    const item = link.closest('li[data-note-id]');
    expect(item).not.toBeNull();
    expect(item?.querySelector('p')).toBeNull();
  });

  it('shows the image of a saved note as a thumbnail in a new tab, loaded from our own origin', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('<b>x.png')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const link = await screen.findByRole('link', { name: /Opens in a new tab/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const image = within(link).getByRole('img');
    expect(image).toHaveAttribute('alt', '<b>x.png');
    expect(link).toHaveAccessibleName('<b>x.png, 8 B. Opens in a new tab.');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image.getAttribute('src')).toMatch(/^\/api\/v1\/.*\/note-attachments\//);
    expect(link.querySelector('b')).toBeNull();
  });

  it('keeps the text and every file, words the refusal, and sends only the rest on a retry', async () => {
    script.respond = (sent) =>
      sent.name === 'bad.png' ? Promise.reject(refusal(415, 'unsupported_media_type')) : Promise.resolve(undefined);
    const { container, user } = renderWithProviders(<Tab />);
    const box = await area();
    await user.type(box, 'keep me');
    choose(container, [png('good.png'), png('bad.png')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(alertLine()).toBe('bad.png: only images (PNG, JPEG, GIF, WebP), PDF, text and CSV files.');
    });
    expect(box).toHaveValue('keep me');
    expect(screen.getByText('bad.png')).toBeInTheDocument();
    expect(screen.getByText('good.png')).toBeInTheDocument();
    expect(script.calls).toBe(2);
    // The refused file goes; the stored one is not sent again
    await user.click(screen.getByRole('button', { name: 'Remove bad.png' }));
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(box).toHaveValue('');
    });
    expect(script.calls).toBe(2);
  });

  it('words a refusal of the quota the same way as the client', async () => {
    script.respond = () => Promise.reject(refusal(422, 'quota_exceeded'));
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('a.png')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(alertLine()).toBe('Your workspace has no room left for files.');
    });
  });

  it('shows a progress bar named for the file while it goes up, and stops when the file is removed', async () => {
    // Held until the request is stopped, as a real upload ends when it is aborted
    script.respond = (_sent, signal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('The upload was stopped', 'AbortError')));
      });
    const { container, user } = renderWithProviders(<Tab />);
    await area();
    choose(container, [png('slow.png')]);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByRole('progressbar', { name: 'Uploading slow.png' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove slow.png' }));
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('slow.png')).not.toBeInTheDocument();
    expect(alertLine()).toBe('');
  });

  it('keeps the chosen files over a close, and not after a save', async () => {
    const first = renderWithProviders(<Tab />);
    await area();
    choose(first.container, [png('kept.png')]);
    first.unmount();
    const { user } = renderWithProviders(<Tab />);
    await area();
    expect(screen.getByText('kept.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await screen.findByRole('link', { name: /kept\.png/ });
    expect(noteDraftPending(SCOPE, PRICING)).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument();
  });
});

describe('a saved note with files', () => {
  type User = ReturnType<typeof renderWithProviders>['user'];

  /** Adds a note of `text` with `files` through the box, and gives its list item once the files are under it. */
  const addNote = async (container: HTMLElement, user: User, text: string, files: File[]): Promise<HTMLElement> => {
    const box = await area();
    if (text !== '') await user.type(box, text);
    choose(container, files);
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const link = await screen.findByRole('link', { name: new RegExp(`^${files[0]?.name ?? ''},`) });
    const item = link.closest('li[data-note-id]');
    if (!(item instanceof HTMLElement)) throw new Error('No note');
    return item;
  };
  const idOf = (item: HTMLElement, name: RegExp): string =>
    (within(item).getByRole('link', { name }).getAttribute('href') ?? '').split('/').pop() ?? '';

  const patches: Record<string, unknown>[] = [];
  const changed = async (count: number): Promise<Record<string, unknown>> => {
    await waitFor(() => {
      expect(patches).toHaveLength(count);
    });
    return patches[count - 1] ?? {};
  };
  beforeEach(() => {
    patches.length = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'PATCH') {
        void request
          .clone()
          .json()
          .then((sent: Record<string, unknown>) => patches.push(sent));
      }
    });
  });

  const edit = async (user: User, item: HTMLElement): Promise<HTMLElement> => {
    await user.click(within(item).getByRole('button', { name: 'Edit note' }));
    return screen.findByRole('combobox', { name: 'Edit your note' });
  };
  const editing = (): HTMLElement => {
    const item = screen.getByRole('combobox', { name: 'Edit your note' }).closest('li');
    if (item === null) throw new Error('No edit');
    return item;
  };

  it('sends no attachment_ids when only the text changes', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, 'Shots', [png('one.png')]);
    const box = await edit(user, item);
    await user.type(box, ' again');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const sent = await changed(1);
    expect(sent.body).toBe('Shots again');
    expect('attachment_ids' in sent).toBe(false);
  });

  it('sends the ids that are kept when one file is removed, and lists the files with Remove buttons', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, 'Shots', [png('one.png'), png('two.png')]);
    const keep = idOf(item, /^two\.png/);
    await edit(user, item);
    await user.click(within(editing()).getByRole('button', { name: 'Remove one.png' }));
    expect(within(editing()).getByText('two.png')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await changed(1)).attachment_ids).toEqual([keep]);
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /^one\.png/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /^two\.png/ })).toBeInTheDocument();
  });

  it('sends the kept ids and the new one when a file is added in an edit', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, 'Shots', [png('one.png')]);
    const keep = idOf(item, /^one\.png/);
    await edit(user, item);
    choose(editing(), [png('added.png')]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const ids = (await changed(1)).attachment_ids;
    expect(Array.isArray(ids) ? ids : []).toHaveLength(2);
    expect(Array.isArray(ids) ? ids[0] : null).toBe(keep);
  });

  it('sends an empty list only when the last file was removed on purpose', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, 'Shots', [png('one.png')]);
    await edit(user, item);
    await user.click(within(editing()).getByRole('button', { name: 'Remove one.png' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await changed(1)).attachment_ids).toEqual([]);
  });

  it('refuses a note left with no text and no file, and says so', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, '', [png('only.png')]);
    await edit(user, item);
    await user.click(within(editing()).getByRole('button', { name: 'Remove only.png' }));
    expect(within(editing()).getByRole('alert')).toHaveTextContent('A note needs text or a file.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patches).toEqual([]);
  });

  it('brings the files back with the note when a delete is undone', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const item = await addNote(container, user, 'Shots', [png('one.png')]);
    await user.click(within(item).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /^one\.png/ })).not.toBeInTheDocument();
    });
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('link', { name: /^one\.png/ })).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations with files in the box, with the drop state, and with files under a note', async () => {
    const { container, user } = renderWithProviders(<Tab />);
    const box = await area();
    choose(container, [png('a.png'), file('b.pdf', 'application/pdf')]);
    expect(await axeWithNoteBox(container)).toHaveNoViolations();
    const zone = box.closest('[data-slot="field"]');
    if (zone === null) throw new Error('No box');
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(await axeWithNoteBox(container)).toHaveNoViolations();
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [] } });
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await screen.findByRole('link', { name: /a\.png/ });
    expect(await axeWithNoteBox(container)).toHaveNoViolations();
  });
});
