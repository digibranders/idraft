import type { Route } from 'next';

import { withQuery } from '@/lib/routes/paths';

/**
 * Where the back link of the page leads: the Keywords list as the person left it (24-page-templates.md
 * section 5, "href restored from sessionStorage per tab"). Every access to the storage is in a try block:
 * a private window or blocked site data makes it throw, and the link then simply leads to the bare list.
 */

const KEY_PREFIX = 'idraft:keywords-list:';
/** The keys of the inspector, which the list opens over a keyword: the page replaces that, so they are not kept. */
const INSPECTOR_KEYS = ['inspect', 'itab'];

/** The query of `search` without the keys of the inspector, as text without its `?`. */
function listQueryOf(search: string): string {
  const query = new URLSearchParams(search);
  for (const key of INSPECTOR_KEYS) query.delete(key);
  return query.toString();
}

/** Remembers the query of the list at `path` (as `window.location.search` has it). Nothing is kept for an empty one. */
export function rememberListHref(storage: Storage | null, path: string, search: string): void {
  if (storage === null) return;
  try {
    const query = listQueryOf(search);
    if (query === '') storage.removeItem(KEY_PREFIX + path);
    else storage.setItem(KEY_PREFIX + path, query);
  } catch {
    // Storage is refused (a private window): the back link leads to the bare list
  }
}

/** The list at `path` with the query remembered for it, or the bare `path` when there is none. */
export function listReturnHref(storage: Storage | null, path: Route): Route {
  if (storage === null) return path;
  try {
    return withQuery(path, storage.getItem(KEY_PREFIX + path) ?? '');
  } catch {
    return path;
  }
}

/** The storage of this tab, or `null` where the browser has none or refuses to name it. */
export function tabStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
