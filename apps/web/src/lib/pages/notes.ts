import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { apiMutation } from '@/lib/api/query';
import type { Schemas } from '@/lib/api/types';
import { PAGE_NOTE, PAGE_NOTES, checkUrlId, pageKey, pageNotesQuery } from '@/lib/internal-links/queries';
import type { LinksScope, PageNote, PageNoteFile, PageNoteList } from '@/lib/internal-links/types';
import type { NoteMention } from '@/lib/pages/note-mentions';

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

/** A file by its id: the stored file the box holds, or anything with an id. */
export type FileRef = Pick<PageNoteFile, 'id'>;

/**
 * What a change does to the files of a note: the files the note had when the edit began (`held`) and the files the box
 * holds now (`next`: the kept ones and the new ones). Never an id list built by hand.
 */
export interface NoteFileEdit {
  held: readonly FileRef[];
  next: readonly FileRef[];
}

/**
 * The `attachment_ids` of a change, or `undefined` for none. On a change the server takes the key as the EXACT list of
 * the files afterwards: `[]` detaches ALL of them, irreversibly, and a list of only the new ones detaches the kept
 * ones. So the key is left out unless the set of files changed, and then it is the whole of `next`. `[]` comes out
 * only when the note had files and the box has none.
 */
export function attachmentIdsOf({ held, next }: NoteFileEdit): string[] | undefined {
  const kept = new Set(held.map((file) => file.id));
  const same = next.length === kept.size && next.every((file) => kept.has(file.id));
  return same ? undefined : next.map((file) => file.id);
}

/** The files of an edit set against the live files of the note: what to send, and whether a kept file is gone. */
export interface ReconciledFiles {
  /** The live files the user kept or never saw, then the new ones. */
  next: readonly FileRef[];
  /** A file the edit began with, and the user kept, no longer exists. */
  gone: boolean;
}

/**
 * A change sends the EXACT list of files afterwards, and the server drops every live file that is not in it for good.
 * So a live file the edit never showed (it began without it) is kept, and a file the edit began with that is not live
 * any more is not sent again (the server would refuse it).
 */
export function reconcileFiles({ held, next }: NoteFileEdit, live: readonly FileRef[]): ReconciledFiles {
  const began = new Set(held.map((file) => file.id));
  const liveIds = new Set(live.map((file) => file.id));
  const nextIds = new Set(next.map((file) => file.id));
  return {
    next: [
      ...live.filter((file) => nextIds.has(file.id) || !began.has(file.id)),
      ...next.filter((file) => !liveIds.has(file.id) && !began.has(file.id)),
    ],
    gone: next.some((file) => began.has(file.id) && !liveIds.has(file.id)),
  };
}

/** What a write carries besides the body: the mentions the text still holds. */
export interface NoteWriteExtras {
  mentions?: readonly NoteMention[] | undefined;
  /** The files a new note holds (uploaded before, attached by their ids). */
  files?: readonly FileRef[] | undefined;
}

/** What a change carries besides the body. Its files are an edit, so the wrong call (`[]`) cannot be written. */
export interface NoteChangeExtras {
  mentions?: readonly NoteMention[] | undefined;
  files?: NoteFileEdit | undefined;
}

/** `mentions` only when there are some (the server keeps the stored ones whose label is still in the text otherwise). */
const mentionsPart = ({
  mentions,
}: {
  mentions?: readonly NoteMention[] | undefined;
}): Pick<Schemas['PageNoteWrite'], 'mentions'> =>
  mentions === undefined || mentions.length === 0
    ? {}
    : { mentions: mentions.map(({ type, label, target }) => ({ type, label, target })) };

export interface PageNoteWrites {
  add: (body: string, extras?: NoteWriteExtras) => Promise<PageNote>;
  /** `extras.files` left out, or an edit that leaves the files as they were, keeps the files of the note. */
  change: (noteId: string, body: string, extras?: NoteChangeExtras) => Promise<PageNote>;
  /**
   * The files the note holds now, read again from the API (every loaded page). `null` when the note is no longer in
   * the list; rejects when the read fails.
   */
  liveFiles: (noteId: string) => Promise<readonly PageNoteFile[] | null>;
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

interface HeldNote {
  note: PageNote;
  page: number;
  index: number;
}

function locate(notes: Notes | undefined, noteId: string): HeldNote | undefined {
  for (const [page, list] of (notes?.pages ?? []).entries()) {
    const index = list.data.findIndex((note) => note.id === noteId);
    const note = list.data[index];
    if (note !== undefined) return { note, page, index };
  }
  return undefined;
}

/** `held` goes back where it was in the notes as they are now; other changes to the list are kept. */
function withNote(notes: Notes, held: HeldNote): Notes {
  if (locate(notes, held.note.id) !== undefined) return notes;
  const target = Math.min(held.page, notes.pages.length - 1);
  return {
    ...notes,
    pages: notes.pages.map((page, at) => {
      if (at !== target) return page;
      const data = [...page.data];
      data.splice(Math.min(held.index, data.length), 0, held.note);
      return { data, meta: { ...page.meta, total: page.meta.total + 1 } };
    }),
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
    add: async (body, extras = {}) => {
      const files = extras.files ?? [];
      try {
        return (
          await create.mutateAsync({
            params: { path },
            body: {
              body,
              ...mentionsPart(extras),
              ...(files.length === 0 ? {} : { attachment_ids: files.map((file) => file.id) }),
            },
          })
        ).data;
      } finally {
        refresh();
      }
    },
    change: async (noteId, body, extras = {}) => {
      const attachmentIds = extras.files === undefined ? undefined : attachmentIdsOf(extras.files);
      try {
        return (
          await change.mutateAsync({
            params: { path: { ...path, note_id: noteId } },
            body: {
              body,
              ...mentionsPart(extras),
              ...(attachmentIds === undefined ? {} : { attachment_ids: attachmentIds }),
            },
          })
        ).data;
      } finally {
        refresh();
      }
    },
    liveFiles: async (noteId) => {
      await queryClient.refetchQueries({ queryKey: notesKey, exact: true }, { throwOnError: true });
      return locate(queryClient.getQueryData(notesKey), noteId)?.note.attachments ?? null;
    },
    remove: async (noteId) => {
      await queryClient.cancelQueries({ queryKey: notesKey });
      const held = locate(queryClient.getQueryData(notesKey), noteId);
      queryClient.setQueryData(notesKey, (notes) => (notes === undefined ? notes : withoutNote(notes, noteId)));
      try {
        await remove.mutateAsync({ params: { path: { ...path, note_id: noteId } } });
      } catch (failure) {
        // Only this note goes back: a second delete or a page loaded meanwhile stays as it is
        if (held !== undefined) {
          queryClient.setQueryData(notesKey, (notes) => (notes === undefined ? notes : withNote(notes, held)));
        }
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
