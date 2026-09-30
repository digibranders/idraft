'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A value from the URL fragment (`/reset-password#token=...`), read once and then removed from the address
 * bar. Emailed tokens travel in the fragment because the browser never sends it to a server, so they reach
 * no access log; removing it keeps them out of the history, a shared screen and a copied link
 * (20-frontend-specification.md section 3.2).
 *
 * Returns `undefined` until the fragment is read (the server render and hydration, so the two agree), then
 * the value, or `null` when the fragment has none.
 *
 * The fragment is read when the component subscribes, after it is on screen, not during a render: removing
 * it changes the history, which must not happen while React renders. What was read belongs to the address
 * it left behind, so a second mount on that address (React's strict mode mounts twice) sees the value the
 * first one took out, and any other address is read afresh.
 */
const taken = new Map<string, string | null>();
/** The full address after the last read, once the value is out of it. */
let readAt = '';
/** The address the last read found, until the value is removed from it. */
let readFrom = '';

/**
 * Removes the value from the address bar a microtask later: by then the App Router has patched
 * `history.replaceState` (its effect runs after the page's), and a call without state of its own is one
 * the router copies its state into and follows, so a later router update does not put the token back.
 */
function removeFromAddress(url: string): void {
  queueMicrotask(() => {
    window.history.replaceState(null, '', url);
    readFrom = '';
  });
}

function take(name: string): void {
  const { href } = window.location;
  if (href !== readAt && href !== readFrom) taken.clear();
  if (taken.has(name)) return;
  const { pathname, search, hash } = window.location;
  const fragment = new URLSearchParams(hash.slice(1));
  const value = fragment.get(name);
  taken.set(name, value);
  if (value === null) {
    readAt = href;
    return;
  }
  fragment.delete(name);
  const rest = fragment.toString();
  const without = `${pathname}${search}${rest === '' ? '' : `#${rest}`}`;
  readFrom = href;
  readAt = new URL(without, href).href;
  removeFromAddress(without);
}

const onServer = (): undefined => undefined;

/**
 * Once the last reader is gone, what was read is forgotten, so a later visit to the same address reads the
 * URL again. Except right away: React's strict mode unmounts and mounts again synchronously, and that second
 * mount must keep the value, because the URL no longer has it. "Right away" is until the next microtask.
 */
let readers = 0;
let justReleased = false;

function release(): void {
  readers -= 1;
  if (readers > 0) return;
  justReleased = true;
  queueMicrotask(() => {
    justReleased = false;
    if (readers === 0) {
      taken.clear();
      readAt = '';
    }
  });
}

export function useFragmentParam(name: string): string | null | undefined {
  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      readers += 1;
      take(name);
      notify();
      return release;
    },
    [name],
  );
  const snapshot = useCallback((): string | null | undefined => {
    // Nothing is read for a component that has not subscribed yet, even at an address read before
    if (readers === 0 && !justReleased) return undefined;
    const { href } = window.location;
    return href === readAt || href === readFrom ? taken.get(name) : undefined;
  }, [name]);
  return useSyncExternalStore(subscribe, snapshot, onServer);
}
