import type { LinksScope, PageNoteFile } from '@/lib/internal-links/types';
import type { NoteMention } from '@/lib/pages/note-mentions';

/** The most pages that hold a draft at once; past it the one typed in longest ago is dropped. */
export const NOTE_DRAFTS_MAX = 50;

const keyOf = (scope: LinksScope, urlId: string): string => `${scope.workspaceId}/${scope.projectId}/${urlId}`;

interface Drafts<T> {
  get: (key: string) => T;
  set: (key: string, value: T) => void;
  clear: (key: string) => void;
  clearAll: () => void;
}

/** One kind of draft by page, in memory only: it lives as long as the browser tab. An empty value holds nothing. */
function drafts<T extends string | readonly unknown[]>(empty: T): Drafts<T> {
  const held = new Map<string, T>();
  return {
    get: (key) => held.get(key) ?? empty,
    set: (key, value) => {
      held.delete(key);
      if (value.length === 0) return;
      held.set(key, value);
      // A Map iterates in insertion order and the delete above re-inserts the key last: the first key is the oldest
      const oldest = held.keys().next();
      if (held.size > NOTE_DRAFTS_MAX && oldest.done !== true) held.delete(oldest.value);
    },
    clear: (key) => {
      held.delete(key);
    },
    clearAll: () => {
      held.clear();
    },
  };
}

const texts = drafts<string>('');
const mentions = drafts<readonly NoteMention[]>([]);
const files = drafts<readonly PageNoteFile[]>([]);

/** Text typed into a page's note box and not saved yet. */
export const noteDraft = (scope: LinksScope, urlId: string): string => texts.get(keyOf(scope, urlId));

/** An empty text removes the draft, so the map never holds a page with nothing typed. */
export const setNoteDraft = (scope: LinksScope, urlId: string, text: string): void => {
  texts.set(keyOf(scope, urlId), text);
};

/** The mentions picked into the draft, whose labels may still be in its text. */
export const noteDraftMentions = (scope: LinksScope, urlId: string): readonly NoteMention[] =>
  mentions.get(keyOf(scope, urlId));

export const setNoteDraftMentions = (scope: LinksScope, urlId: string, list: readonly NoteMention[]): void => {
  mentions.set(keyOf(scope, urlId), list);
};

/**
 * The files already uploaded for the draft (they are attached by id when the note is saved). Memory only, like the text.
 * A draft that is discarded, or lost with the tab, leaves its files stored on the server without a note: orphans, which
 * count against the workspace quota and are never served (no purge is built, decision D27).
 */
export const noteDraftFiles = (scope: LinksScope, urlId: string): readonly PageNoteFile[] =>
  files.get(keyOf(scope, urlId));

export const setNoteDraftFiles = (scope: LinksScope, urlId: string, list: readonly PageNoteFile[]): void => {
  files.set(keyOf(scope, urlId), list);
};

/** When the session ends: the next person in this tab must not find the last one's unsaved text. */
export function clearAllNoteDrafts(): void {
  texts.clearAll();
  mentions.clearAll();
  files.clearAll();
}

/** After a save or a discard. */
export function clearNoteDraft(scope: LinksScope, urlId: string): void {
  const key = keyOf(scope, urlId);
  texts.clear(key);
  mentions.clear(key);
  files.clear(key);
}
