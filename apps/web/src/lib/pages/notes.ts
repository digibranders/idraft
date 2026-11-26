import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { apiMutation } from '@/lib/api/query';
import { PAGE_NOTE, PAGE_NOTES, checkUrlId, pageKey, pageNotesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageNote, PageNoteList } from '@/lib/internal-links/types';

/** The longest note the API takes, in characters (`NOTE_MAX` of the backend). */
export const NOTE_MAX = 2000;
/** From this length on the box shows its count. */
export const NOTE_COUNT_FROM = 1800;

export type NotesRead =
  | { state: 'loading' }
  | { state: 'error'; retry: () => void }
  | {
      state: 'ready';
      notes: readonly PageNote[];
      total: number;
      hasMore: boolean;
      loadMore: () => void;
      loadingMore: boolean;
    };

/** The notes of one page, newest first, asked only while `enabled` (the tab is open). Throws `UrlIdError` for a bad id. */
export function usePageNotes(scope: LinksScope, urlId: string, enabled: boolean): NotesRead {
  const query = useInfiniteQuery({ ...pageNotesQuery(scope, urlId), enabled });
  if (query.data === undefined) {
    return query.isError
      ? {
          state: 'error',
          retry: () => {
            void query.refetch();
          },
        }
      : { state: 'loading' };
  }
  const { pages } = query.data;
  return {
    state: 'ready',
    notes: pages.flatMap((page) => page.data),
    // Every page carries the total as of its own read: the latest one is the freshest
    total: pages.at(-1)?.meta.total ?? 0,
    hasMore: query.hasNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    loadingMore: query.isFetchingNextPage,
  };
}

export interface PageNoteWrites {
  add: (body: string) => Promise<PageNote>;
  change: (noteId: string, body: string) => Promise<PageNote>;
  /** The note leaves the list at once; it comes back when the API refuses. */
  remove: (noteId: string) => Promise<void>;
  /** Undo of `remove`: the API allows it only for the one who deleted the note. */
  restore: (noteId: string) => Promise<PageNote>;
  /** A write is running. */
  pending: boolean;
}

const createNote = apiMutation('post', PAGE_NOTES);
const changeNote = apiMutation('patch', PAGE_NOTE);
const deleteNote = apiMutation('delete', PAGE_NOTE);
const restoreNote = apiMutation('post', `${PAGE_NOTE}/restore` as const);

type Notes = InfiniteData<PageNoteList>;

/** The notes as they read once `noteId` is gone: the page that held it loses it and every page's total follows. */
function withoutNote(notes: Notes, noteId: string): Notes {
  const held = notes.pages.some((page) => page.data.some((note) => note.id === noteId));
  return {
    ...notes,
    pages: notes.pages.map((page) => ({
      data: page.data.filter((note) => note.id !== noteId),
      meta: held ? { ...page.meta, total: page.meta.total - 1 } : page.meta,
    })),
  };
}

/**
 * Add, change, delete and restore a note of one page. A refused write rejects with the API's `ApiProblem` and leaves the
 * list as it was. After any write, the notes of the page and the detail of the page (its `notes_count`, in every crawl)
 * are read again, and nothing else.
 */
export function usePageNoteWrites(scope: LinksScope, urlId: string): PageNoteWrites {
  const queryClient = useQueryClient();
  const create = useMutation(createNote);
  const change = useMutation(changeNote);
  const remove = useMutation(deleteNote);
  const restore = useMutation(restoreNote);
  const path = { workspace_id: scope.workspaceId, project_id: scope.projectId, url_id: checkUrlId(urlId) };
  const notesKey = pageNotesQuery(scope, urlId).queryKey;
  const page = pageKey(scope, urlId);

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: notesKey });
    // The detail key is the page's key and its query; the page's other reads have a name in between
    void queryClient.invalidateQueries({
      queryKey: page,
      predicate: (query) => query.queryKey.length === page.length + 1,
    });
  };

  return {
    add: async (body) => {
      try {
        return (await create.mutateAsync({ params: { path }, body: { body } })).data;
      } finally {
        refresh();
      }
    },
    change: async (noteId, body) => {
      try {
        return (await change.mutateAsync({ params: { path: { ...path, note_id: noteId } }, body: { body } })).data;
      } finally {
        refresh();
      }
    },
    remove: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: notesKey });
      const before = queryClient.getQueryData(notesKey);
      queryClient.setQueryData(notesKey, (notes) => (notes === undefined ? notes : withoutNote(notes, noteId)));
      try {
        await remove.mutateAsync({ params: { path: { ...path, note_id: noteId } } });
      } catch (failure) {
        queryClient.setQueryData(notesKey, before);
        throw failure;
      } finally {
        refresh();
      }
    },
    restore: async (noteId) => {
      try {
        return (await restore.mutateAsync({ params: { path: { ...path, note_id: noteId } } })).data;
      } finally {
        refresh();
      }
    },
    pending: create.isPending || change.isPending || remove.isPending || restore.isPending,
  };
}
