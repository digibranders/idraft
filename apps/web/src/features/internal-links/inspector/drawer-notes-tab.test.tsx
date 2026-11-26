import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { Route } from 'next';
import { useState, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DrawerNotesTab } from './drawer-notes-tab';
import type { PageDrawerContext } from './page-drawer-context';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import { announce } from '@/lib/a11y/announcer';
import type { Role } from '@/lib/api/types';
import { browserTimeZone, formatDetailDateTime } from '@/lib/format';
import type { PageNote } from '@/lib/internal-links/types';
import { clearAllNoteDrafts, noteDraft } from '@/lib/pages/note-drafts';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { EVENTUS } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { axe } from '@/test/axe';
import { server } from '@/test/msw';
import { renderWithProviders } from '@/test/render';

vi.mock('@/lib/a11y/announcer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/a11y/announcer')>()),
  announce: vi.fn(),
}));

const NOTES = mswPath('/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links/pages/{url_id}/notes');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const PRICING = '108';
const HOME = '101';
const PROBLEM = { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' };
const FAILED = { status: 500, headers: { 'content-type': 'application/problem+json' } };
const NONE = { data: [], meta: { total: 0, limit: 50, has_more: false, next_cursor: null } };

const onClose = vi.fn();
const onStep = vi.fn();

function contextOf(canNote: boolean): PageDrawerContext {
  const route = (path: string): Route => path as Route;
  return {
    scope: SCOPE,
    crawl: { crawl: null, run: null, older: false, linksAvailable: true, unknown: false },
    linkScope: 'editorial',
    tiers: [],
    timeZone: 'UTC',
    canWrite: false,
    canNote,
    openPage: () => undefined,
    hrefs: {
      journey: () => route('/journey'),
      linksFrom: () => route('/from'),
      linksTo: () => route('/to'),
      issueCheck: () => null,
      taxonomy: route('/taxonomy'),
      integrations: route('/integrations'),
    },
  };
}

/** The tab inside the real inspector, with buttons that step to another page and to another tab. */
function Harness({ canNote = true }: { canNote?: boolean }): ReactElement {
  const [urlId, setUrlId] = useState(PRICING);
  const [onNotes, setOnNotes] = useState(true);
  const path = urlId === PRICING ? '/pricing' : '/';
  return (
    <InspectorLayout
      inspector={
        <Inspector
          type="page"
          header={{ title: path, typeLabel: 'Page', typeNoun: 'page' }}
          backLabel="Back to pages"
          onClose={onClose}
          onStep={onStep}
        >
          <InspectorBody>
            {onNotes ? (
              <DrawerNotesTab context={contextOf(canNote)} urlId={urlId} path={path} active />
            ) : (
              <p>Another tab</p>
            )}
          </InspectorBody>
        </Inspector>
      }
    >
      <button type="button" onClick={() => setUrlId(urlId === PRICING ? HOME : PRICING)}>
        Other page
      </button>
      <button type="button" onClick={() => setOnNotes(!onNotes)}>
        Switch tab
      </button>
    </InspectorLayout>
  );
}

const signIn = (role: Role): void => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
};
const box = (): Promise<HTMLElement> => screen.findByRole('textbox', { name: 'Add a note to /pricing' });
const announced = (): string[] => vi.mocked(announce).mock.calls.map((call) => call[0]);
const items = (): HTMLElement[] =>
  within(screen.getByRole('list', { name: 'Notes, newest first' })).getAllByRole('listitem');
const itemOf = (text: string): HTMLElement => {
  const found = items().find((item) => item.textContent.includes(text));
  if (found === undefined) throw new Error(`No note with ${text}`);
  return found;
};
const PRIYA_NOTE = 'Rewrote the title and the first heading to name the three plans.';
const TOMAS_NOTE = 'Plan table moved above the fold.';
/** A toast names itself twice (its title and a hidden copy for assistive technology). */
const toasted = async (text: string): Promise<HTMLElement | undefined> => (await screen.findAllByText(text))[0];
const detailTime = (instant: string): string => formatDetailDateTime(instant, browserTimeZone());

/** The list read, once the seeded notes are in. */
const loaded = async (): Promise<void> => {
  await box();
  await waitFor(() => itemOf(PRIYA_NOTE));
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('innerWidth', 1440);
  Object.defineProperty(Element.prototype, 'getAnimations', { configurable: true, value: () => [] });
  vi.mocked(announce).mockClear();
  onClose.mockReset();
  onStep.mockReset();
  clearAllNoteDrafts();
  signIn('editor');
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
  server.events.removeAllListeners();
});

describe('the box', () => {
  it('is a named text area with a limit, described by its hint, and Add note waits for text', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    expect(area).toHaveAttribute('maxlength', '2000');
    expect(area).toHaveAccessibleDescription(/Cmd or Ctrl \+ Enter saves/);
    const add = screen.getByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    await user.type(area, '   ');
    expect(add).toBeDisabled();
    await user.type(area, 'x');
    expect(add).toBeEnabled();
  });

  it('adds a trimmed note first in the list, empties the box, keeps its focus and announces it', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    await user.type(area, '  Checked the schema.  ');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(items()[0]).toHaveTextContent('Checked the schema.');
    });
    expect(area).toHaveValue('');
    expect(area).toHaveFocus();
    expect(announced()).toEqual(['Note added']);
    expect(noteDraft(SCOPE, PRICING)).toBe('');
  });

  it.each([
    ['Control', '{Control>}{Enter}{/Control}'],
    ['Meta', '{Meta>}{Enter}{/Meta}'],
  ])('saves with %s and Enter, and a bare Enter only adds a line', async (_name, keys) => {
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    await loaded();
    await user.type(area, 'one{Enter}two');
    expect(area).toHaveValue('one\ntwo');
    expect(items()).toHaveLength(3);
    await user.keyboard(keys);
    await waitFor(() => {
      expect(items()).toHaveLength(4);
    });
    expect(items()[0]?.textContent).toContain('one');
  });

  it('shows its count from 1,800 characters', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    fireEvent.change(area, { target: { value: 'a'.repeat(1799) } });
    expect(screen.queryByText(/of 2,000/)).not.toBeInTheDocument();
    await user.type(area, 'b');
    expect(screen.getByText('1,800 of 2,000')).toBeInTheDocument();
    expect(area).toHaveAccessibleDescription(/1,800 of 2,000/);
  });

  it('types j and k as letters and does not step to another page', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    await user.type(area, 'jk');
    expect(area).toHaveValue('jk');
    expect(onStep).not.toHaveBeenCalled();
  });

  it('keeps the draft over a tab switch, a step to another page and a close, and drops it with a save', async () => {
    const { user, unmount } = renderWithProviders(<Harness />);
    await user.type(await box(), 'half a thought');
    await user.click(screen.getByRole('button', { name: 'Switch tab' }));
    expect(screen.getByText('Another tab')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch tab' }));
    expect(await box()).toHaveValue('half a thought');

    await user.click(screen.getByRole('button', { name: 'Other page' }));
    expect(await screen.findByRole('textbox', { name: 'Add a note to /' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Other page' }));
    expect(await box()).toHaveValue('half a thought');

    // The drawer closes and opens again
    unmount();
    renderWithProviders(<Harness />);
    const reopened = await box();
    expect(reopened).toHaveValue('half a thought');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => {
      expect(reopened).toHaveValue('');
    });
    expect(noteDraft(SCOPE, PRICING)).toBe('');
  });

  it('closes the drawer on Escape and keeps what was typed', async () => {
    const { user } = renderWithProviders(<Harness />);
    await user.type(await box(), 'keep me');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(noteDraft(SCOPE, PRICING)).toBe('keep me');
  });

  it('keeps the text and says so when the note cannot be added', async () => {
    server.use(http.post(NOTES, () => HttpResponse.json(PROBLEM, FAILED)));
    const { user } = renderWithProviders(<Harness />);
    const area = await box();
    await user.type(area, 'do not lose me');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await toasted('The note could not be added. Your text is still in the box.')).toBeTruthy();
    expect(area).toHaveValue('do not lose me');
    expect(announced()).not.toContain('Note added');
  });
});

describe('the list', () => {
  it('is an ordered list, newest first, with the author, an instant in a time element and the body', async () => {
    renderWithProviders(<Harness />);
    await loaded();
    expect(screen.getByRole('list', { name: 'Notes, newest first' }).tagName).toBe('OL');
    const [newest, , oldest] = items();
    expect(newest).toHaveTextContent('Tomás Rivera');
    expect(oldest).toHaveTextContent('Priya Natarajan');
    const time = within(itemOf(PRIYA_NOTE)).getByText(detailTime('2026-11-20T09:30:00Z'));
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', '2026-11-20T09:30:00Z');
  });

  it('keeps the line break of a body, as text', async () => {
    renderWithProviders(<Harness />);
    const body = await screen.findByText(/Watch the click-through/);
    expect(body.textContent).toContain('\n');
    expect(body).toHaveClass('whitespace-pre-wrap');
  });

  it('gives the time of an edit to assistive technology, beside the word edited', async () => {
    renderWithProviders(<Harness />);
    const word = await screen.findByText('edited');
    expect(word).toHaveAccessibleDescription(`Edited ${detailTime('2026-11-24T15:40:00Z')}`);
    expect(screen.getAllByText('edited')).toHaveLength(1);
  });

  it('draws markup in a note as the characters it is made of', async () => {
    const body = '<img src=x onerror=alert(1)> and <a href="https://x.test">x</a>';
    server.use(
      http.get(NOTES, () =>
        HttpResponse.json({
          data: [
            {
              id: 'n1',
              author: { id: 'a', name: 'Ana' },
              body,
              created_at: '2026-11-20T10:00:00Z',
              edited_at: null,
              can_edit: false,
              can_delete: false,
            } satisfies PageNote,
          ],
          meta: { total: 1, limit: 50, has_more: false, next_cursor: null },
        }),
      ),
    );
    renderWithProviders(<Harness />);
    const list = await screen.findByRole('list', { name: 'Notes, newest first' });
    expect(list).toHaveTextContent(body);
    expect(list.querySelector('img')).toBeNull();
    expect(list.querySelector('a')).toBeNull();
  });

  it('shows the controls the API allows: an editor has both on her own notes only', async () => {
    renderWithProviders(<Harness />);
    await loaded();
    const own = itemOf(PRIYA_NOTE);
    expect(within(own).getByRole('button', { name: 'Edit note' })).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
    expect(within(itemOf(TOMAS_NOTE)).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets an admin delete another person note and not edit it', async () => {
    signIn('admin');
    renderWithProviders(<Harness />);
    await loaded();
    const other = itemOf(PRIYA_NOTE);
    expect(within(other).getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Edit note' })).not.toBeInTheDocument();
  });

  it('shows a viewer the notes and no box and no button', async () => {
    signIn('viewer');
    renderWithProviders(<Harness canNote={false} />);
    await screen.findByRole('list', { name: 'Notes, newest first' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const body = screen.getByRole('list', { name: 'Notes, newest first' }).parentElement as HTMLElement;
    expect(within(body).queryByRole('button')).not.toBeInTheDocument();
  });

  it('says there are no notes, with the reason for those who may write, and always ends with the footer', async () => {
    server.use(http.get(NOTES, () => HttpResponse.json(NONE)));
    renderWithProviders(<Harness />);
    expect(await screen.findByText('No notes on this page yet.')).toBeInTheDocument();
    expect(screen.getByText(/Write down what you changed and when/)).toBeInTheDocument();
    expect(screen.getByText(/Everyone in this workspace can read these notes/)).toHaveTextContent(
      'They stay with this address when the site is crawled again.',
    );
  });

  it('gives a viewer only the first sentence of the empty state', async () => {
    signIn('viewer');
    server.use(http.get(NOTES, () => HttpResponse.json(NONE)));
    renderWithProviders(<Harness canNote={false} />);
    expect(await screen.findByText('No notes on this page yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Write down what you changed/)).not.toBeInTheDocument();
  });

  it('says when the read failed, with a Retry that works', async () => {
    let failing = true;
    server.use(http.get(NOTES, () => (failing ? HttpResponse.json(PROBLEM, FAILED) : undefined)));
    const { user } = renderWithProviders(<Harness />);
    expect(await screen.findByText('The notes of this page could not be loaded')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Notes, newest first' })).toBeInTheDocument();
  });

  it('pages older notes in, and moves the focus to the first of them when the button goes', async () => {
    const note = (id: string): PageNote => ({
      id,
      author: { id: 'a', name: 'Ana Brandt' },
      body: `Body of ${id}`,
      created_at: '2026-11-20T10:00:00Z',
      edited_at: null,
      can_edit: false,
      can_delete: false,
    });
    server.use(
      http.get(NOTES, ({ request }) =>
        new URL(request.url).searchParams.get('cursor') === null
          ? HttpResponse.json({
              data: [note('first')],
              meta: { total: 2, limit: 1, has_more: true, next_cursor: 'c1' },
            })
          : HttpResponse.json({
              data: [note('older')],
              meta: { total: 2, limit: 1, has_more: false, next_cursor: null },
            }),
      ),
    );
    const { user } = renderWithProviders(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Show older notes' }));
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    expect(screen.queryByRole('button', { name: 'Show older notes' })).not.toBeInTheDocument();
    expect(items()[1]).toHaveFocus();
  });
});

describe('editing', () => {
  const startEdit = async (user: ReturnType<typeof renderWithProviders>['user']): Promise<HTMLElement> => {
    await loaded();
    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Edit note' }));
    return screen.findByRole('textbox', { name: 'Edit your note' });
  };

  it('turns the body into a box, saves the new text, shows edited, announces it and returns the focus', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await startEdit(user);
    expect(area).toHaveValue(PRIYA_NOTE);
    await user.clear(area);
    await user.type(area, 'Rewritten once more');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Edit your note' })).not.toBeInTheDocument();
    });
    const saved = itemOf('Rewritten once more');
    expect(saved).toHaveTextContent('edited');
    expect(announced()).toEqual(['Note saved']);
    expect(within(saved).getByRole('button', { name: 'Edit note' })).toHaveFocus();
  });

  it('does not save an empty text, saves with Ctrl and Enter, and sends nothing for an unchanged text', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.method !== 'GET') seen.push(request.method);
    });
    const { user } = renderWithProviders(<Harness />);
    const area = await startEdit(user);
    await user.clear(area);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(seen).toEqual([]);
    await user.type(area, PRIYA_NOTE);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Edit your note' })).not.toBeInTheDocument();
    });
    expect(seen).toEqual([]);
    expect(announced()).toEqual([]);

    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Edit note' }));
    await user.type(await screen.findByRole('textbox', { name: 'Edit your note' }), '!');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => {
      expect(seen).toEqual(['PATCH']);
    });
  });

  it('cancels with Escape and not the drawer: the first text is back and the focus is on Edit', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await startEdit(user);
    await user.type(area, ' extra');
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    const own = itemOf(PRIYA_NOTE);
    expect(own).not.toHaveTextContent('extra');
    expect(within(own).getByRole('button', { name: 'Edit note' })).toHaveFocus();
  });

  it('cancels with the Cancel button', async () => {
    const { user } = renderWithProviders(<Harness />);
    await startEdit(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Edit your note' })).not.toBeInTheDocument();
    expect(itemOf(PRIYA_NOTE)).toBeInTheDocument();
  });

  it('types j and k in the edit box', async () => {
    const { user } = renderWithProviders(<Harness />);
    const area = await startEdit(user);
    await user.type(area, 'jk');
    expect(area).toHaveValue(`${PRIYA_NOTE}jk`);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('keeps the edit box and its text when the save fails', async () => {
    server.use(http.patch(`${NOTES}/:note`, () => HttpResponse.json(PROBLEM, FAILED)));
    const { user } = renderWithProviders(<Harness />);
    const area = await startEdit(user);
    await user.type(area, ' more');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await toasted('The note could not be saved. Your text is still in the box.')).toBeTruthy();
    expect(area).toHaveValue(`${PRIYA_NOTE} more`);
  });

  it('lets only one note be in edit', async () => {
    const { user } = renderWithProviders(<Harness />);
    await startEdit(user);
    await user.click(within(itemOf('Pricing page now links')).getByRole('button', { name: 'Edit note' }));
    expect(screen.getAllByRole('textbox', { name: 'Edit your note' })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Edit your note' })).toHaveValue(
      'Pricing page now links to the VAPT and managed detection pages.',
    );
  });
});

describe('deleting', () => {
  it('removes the note, offers Undo, announces it and moves the focus to the box', async () => {
    const { user } = renderWithProviders(<Harness />);
    await loaded();
    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    expect(await toasted('Note deleted')).toBeTruthy();
    expect(announced()).toContain('Note deleted');
    expect(await box()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    // There is no optimistic put-back: the note shows once the list is read again, in its first place
    await waitFor(() => {
      expect(items()).toHaveLength(3);
    });
    expect(items()[1]).toHaveTextContent(PRIYA_NOTE);
    expect(items()[1]).toHaveTextContent(detailTime('2026-11-20T09:30:00Z'));
    expect(announced()).toContain('Note restored');
  });

  it('says so when the delete is refused, and the note stays', async () => {
    server.use(http.delete(`${NOTES}/:note`, () => HttpResponse.json(PROBLEM, FAILED)));
    const { user } = renderWithProviders(<Harness />);
    await loaded();
    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Delete note' }));
    expect(await toasted('The note could not be deleted')).toBeTruthy();
    await waitFor(() => {
      expect(items()).toHaveLength(3);
    });
    expect(announced()).not.toContain('Note deleted');
  });

  it('says so when Undo is refused', async () => {
    server.use(http.post(`${NOTES}/:note/restore`, () => HttpResponse.json(PROBLEM, FAILED)));
    const { user } = renderWithProviders(<Harness />);
    await loaded();
    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Delete note' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await toasted('The note could not be restored')).toBeTruthy();
    expect(announced()).not.toContain('Note restored');
  });
});

describe('accessibility', () => {
  it('has no violations with notes, and in edit', async () => {
    const { container, user } = renderWithProviders(<Harness />);
    await loaded();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(itemOf(PRIYA_NOTE)).getByRole('button', { name: 'Edit note' }));
    await screen.findByRole('textbox', { name: 'Edit your note' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no violations when empty', async () => {
    server.use(http.get(NOTES, () => HttpResponse.json(NONE)));
    const { container } = renderWithProviders(<Harness />);
    await screen.findByText('No notes on this page yet.');
    expect(await axe(container)).toHaveNoViolations();
  });
});
