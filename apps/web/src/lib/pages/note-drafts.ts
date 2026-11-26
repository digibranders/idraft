import type { LinksScope } from '@/lib/internal-links/types';

/** Text typed into a page's note box and not saved yet. In memory only: it lives as long as the browser tab. */
const drafts = new Map<string, string>();

const keyOf = (scope: LinksScope, urlId: string): string => `${scope.workspaceId}/${scope.projectId}/${urlId}`;

export function noteDraft(scope: LinksScope, urlId: string): string {
  return drafts.get(keyOf(scope, urlId)) ?? '';
}

/** The most pages that hold a draft at once; past it the one typed in longest ago is dropped. */
export const NOTE_DRAFTS_MAX = 50;

/** An empty text removes the draft, so the map never holds a page with nothing typed. */
export function setNoteDraft(scope: LinksScope, urlId: string, text: string): void {
  const key = keyOf(scope, urlId);
  drafts.delete(key);
  if (text === '') return;
  drafts.set(key, text);
  // A Map iterates in insertion order and the delete above re-inserts the key last: the first key is the oldest
  const oldest = drafts.keys().next();
  if (drafts.size > NOTE_DRAFTS_MAX && oldest.done !== true) drafts.delete(oldest.value);
}

/** When the session ends: the next person in this tab must not find the last one's unsaved text. */
export function clearAllNoteDrafts(): void {
  drafts.clear();
}

/** After a save or a discard. */
export function clearNoteDraft(scope: LinksScope, urlId: string): void {
  drafts.delete(keyOf(scope, urlId));
}
