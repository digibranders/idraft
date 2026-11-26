import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { NOTE_COUNT_FROM, NOTE_MAX, usePageNotes, usePageNoteWrites, type NotesRead } from './notes';
import { ApiProblem } from '@/lib/api/problem';
import { makeQueryClient } from '@/lib/api/query-client';
import { pageDetailQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageNote } from '@/lib/internal-links/types';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { SESSION_COOKIE } from '@/mocks/session';
import type { Role } from '@/lib/api/types';
import { server } from '@/test/msw';

const EVENTUS = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
if (EVENTUS === undefined) throw new Error('No fixture project eventus-security');
const SCOPE: LinksScope = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const PRICING = '108';

function signIn(role: Role): void {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser(role).user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
}

function providers(client: QueryClient = makeQueryClient({ retry: false, onSignedOut: () => false })): {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => ReactNode;
} {
  return {
    client,
    wrapper: function Providers({ children }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

const readyNotes = (read: NotesRead): readonly PageNote[] => (read.state === 'ready' ? read.notes : []);

describe('the limits', () => {
  it('are the API limits', () => {
    expect(NOTE_MAX).toBe(2000);
    expect(NOTE_COUNT_FROM).toBe(1800);
  });
});

describe('usePageNotes', () => {
  it('loads, then gives the notes newest first with the total', async () => {
    signIn('editor');
    const { wrapper } = providers();
    const { result } = renderHook(() => usePageNotes(SCOPE, PRICING, true), { wrapper });
    expect(result.current).toEqual({ state: 'loading' });
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current.notes).toHaveLength(3);
    expect(result.current.total).toBe(3);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loadingMore).toBe(false);
  });

  it('pages older notes in with loadMore', async () => {
    signIn('editor');
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/notes', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const note = (id: string): PageNote => ({
          id,
          author: { id: 'a', name: 'A' },
          body: id,
          created_at: '2026-11-20T10:00:00Z',
          edited_at: null,
          can_edit: false,
          can_delete: false,
        });
        return HttpResponse.json(
          cursor === null
            ? { data: [note('n1')], meta: { total: 2, limit: 1, has_more: true, next_cursor: 'c1' } }
            : { data: [note('n2')], meta: { total: 2, limit: 1, has_more: false, next_cursor: null } },
        );
      }),
    );
    const { result } = renderHook(() => usePageNotes(SCOPE, PRICING, true), { wrapper: providers().wrapper });
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
    if (result.current.state !== 'ready') throw new Error('not ready');
    expect(result.current).toMatchObject({ total: 2, hasMore: true });
    act(() => {
      if (result.current.state === 'ready') result.current.loadMore();
    });
    await waitFor(() => {
      expect(readyNotes(result.current).map((note) => note.id)).toEqual(['n1', 'n2']);
    });
    expect(result.current).toMatchObject({ hasMore: false });
  });

  it('sends nothing while it is not enabled', async () => {
    signIn('editor');
    const asked: string[] = [];
    const log = ({ request }: { request: Request }): void => {
      asked.push(new URL(request.url).pathname);
    };
    server.events.on('request:start', log);
    try {
      const { result } = renderHook(() => usePageNotes(SCOPE, PRICING, false), { wrapper: providers().wrapper });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.current).toEqual({ state: 'loading' });
    } finally {
      server.events.removeListener('request:start', log);
    }
    expect(asked.filter((path) => path.includes('/notes'))).toEqual([]);
  });

  it('gives an error for a 500, with a retry that asks again', async () => {
    signIn('editor');
    let failing = true;
    server.use(
      http.get('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/notes', () =>
        failing
          ? HttpResponse.json(
              { type: 'about:blank', title: 'Server error', status: 500, code: 'internal_error', request_id: 'r1' },
              { status: 500, headers: { 'content-type': 'application/problem+json' } },
            )
          : undefined,
      ),
    );
    const { result } = renderHook(() => usePageNotes(SCOPE, PRICING, true), { wrapper: providers().wrapper });
    await waitFor(() => {
      expect(result.current.state).toBe('error');
    });
    failing = false;
    if (result.current.state !== 'error') throw new Error('no error');
    result.current.retry();
    await waitFor(() => {
      expect(result.current.state).toBe('ready');
    });
  });
});

/** The reads and the writes of one page, in one client, as the drawer holds them. */
function pageWith(role: Role): {
  client: QueryClient;
  notes: { current: NotesRead };
  writes: { current: ReturnType<typeof usePageNoteWrites> };
  count: () => Promise<number | undefined>;
} {
  signIn(role);
  const { client, wrapper } = providers();
  const both = renderHook(
    () => ({ notes: usePageNotes(SCOPE, PRICING, true), writes: usePageNoteWrites(SCOPE, PRICING) }),
    { wrapper },
  );
  const view = {
    get current(): NotesRead {
      return both.result.current.notes;
    },
  };
  const writes = {
    get current(): ReturnType<typeof usePageNoteWrites> {
      return both.result.current.writes;
    },
  };
  const count = async (): Promise<number | undefined> =>
    (await client.fetchQuery({ ...pageDetailQuery(SCOPE, PRICING, 'editorial', null), staleTime: 0 })).data.notes_count;
  return { client, notes: view, writes, count };
}

describe('usePageNoteWrites', () => {
  it('adds a note: it resolves with the note, the list holds it and the page detail count follows', async () => {
    const { client, notes, writes, count } = pageWith('editor');
    await waitFor(() => {
      expect(notes.current.state).toBe('ready');
    });
    // The detail of the page is read once, so its invalidation by the write can be seen
    expect(await count()).toBe(3);
    const made = await act(() => writes.current.add('  Checked the title.  '));
    expect(made.body).toBe('Checked the title.');
    await waitFor(() => {
      expect(readyNotes(notes.current)[0]?.id).toBe(made.id);
    });
    expect(client.getQueryState(pageDetailQuery(SCOPE, PRICING, 'editorial', null).queryKey)?.isInvalidated).toBe(true);
    expect(await count()).toBe(4);
  });

  it('changes a note and restores a deleted one', async () => {
    const { notes, writes } = pageWith('editor');
    await waitFor(() => {
      expect(notes.current.state).toBe('ready');
    });
    const mine = readyNotes(notes.current).find((note) => note.can_edit);
    if (mine === undefined) throw new Error('no note of the editor');
    const changed = await act(() => writes.current.change(mine.id, 'Rewritten'));
    expect(changed.body).toBe('Rewritten');
    await waitFor(() => {
      expect(readyNotes(notes.current).find((note) => note.id === mine.id)?.body).toBe('Rewritten');
    });

    await act(() => writes.current.remove(mine.id));
    await waitFor(() => {
      expect(readyNotes(notes.current).map((note) => note.id)).not.toContain(mine.id);
    });
    expect(notes.current).toMatchObject({ total: 2 });
    const back = await act(() => writes.current.restore(mine.id));
    expect(back.id).toBe(mine.id);
    await waitFor(() => {
      expect(readyNotes(notes.current)).toHaveLength(3);
    });
  });

  it('hides a deleted note at once, and brings it back when the write is refused', async () => {
    const { notes, writes } = pageWith('editor');
    await waitFor(() => {
      expect(notes.current.state).toBe('ready');
    });
    const before = readyNotes(notes.current);
    const theirs = before.find((note) => !note.can_delete);
    const mine = before.find((note) => note.can_delete);
    if (theirs === undefined || mine === undefined) throw new Error('the seed has both kinds of note');
    // Another editor's note is refused by the API; the list goes back to what it was
    await expect(act(() => writes.current.remove(theirs.id))).rejects.toBeInstanceOf(ApiProblem);
    await waitFor(() => {
      expect(readyNotes(notes.current).map((note) => note.id)).toEqual(before.map((note) => note.id));
    });
    expect(notes.current).toMatchObject({ total: 3 });

    // A slow delete: the list has already lost the note while the request runs
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.delete('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/notes/:note', async () => {
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = writes.current.remove(mine.id);
    });
    await waitFor(() => {
      expect(readyNotes(notes.current).some((note) => note.id === mine.id)).toBe(false);
    });
    expect(notes.current).toMatchObject({ total: 2 });
    release();
    await act(() => done);
  });

  it('rejects with the API error for a refused write and leaves the list as it was', async () => {
    const { notes, writes } = pageWith('viewer');
    await waitFor(() => {
      expect(notes.current.state).toBe('ready');
    });
    const before = readyNotes(notes.current).map((note) => note.id);
    await expect(act(() => writes.current.add('x'))).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    expect(readyNotes(notes.current).map((note) => note.id)).toEqual(before);
  });

  it('is pending while a write runs', async () => {
    const { notes, writes } = pageWith('editor');
    await waitFor(() => {
      expect(notes.current.state).toBe('ready');
    });
    expect(writes.current.pending).toBe(false);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post('*/api/v1/workspaces/:w/projects/:p/internal-links/pages/:id/notes', async () => {
        await gate;
        return undefined;
      }),
    );
    let done: Promise<PageNote> = Promise.reject(new Error('not started'));
    done.catch(() => undefined);
    act(() => {
      done = writes.current.add('Slow');
    });
    await waitFor(() => {
      expect(writes.current.pending).toBe(true);
    });
    release();
    await act(() => done);
    await waitFor(() => {
      expect(writes.current.pending).toBe(false);
    });
  });
});
