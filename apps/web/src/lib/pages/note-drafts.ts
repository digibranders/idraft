import type { LinksScope } from '@/lib/internal-links/types';

/** Text typed into a page's note box and not saved yet. In memory only: it lives as long as the browser tab. */
const drafts = new Map<string, string>();

const keyOf = (scope: LinksScope, urlId: string): string => `${scope.workspaceId}/${scope.projectId}/${urlId}`;

export function noteDraft(scope: LinksScope, urlId: string): string {
  return drafts.get(keyOf(scope, urlId)) ?? '';
}

/** An empty text removes the draft, so the map never holds a page with nothing typed. */
export function setNoteDraft(scope: LinksScope, urlId: string, text: string): void {
  if (text === '') drafts.delete(keyOf(scope, urlId));
  else drafts.set(keyOf(scope, urlId), text);
}

/** After a save or a discard. */
export function clearNoteDraft(scope: LinksScope, urlId: string): void {
  drafts.delete(keyOf(scope, urlId));
}
