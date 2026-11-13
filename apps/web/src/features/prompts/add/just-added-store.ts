import { useSyncExternalStore } from 'react';

/** How long the prompts of an add are marked as new in the table. */
export const JUST_ADDED_MS = 4000;

const NONE: ReadonlySet<string> = new Set();
let current: ReadonlySet<string> = NONE;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

/** The ids of the prompts an add created, held for `JUST_ADDED_MS`; a later add replaces them. No ids clears them. */
export function markJustAdded(ids: readonly string[]): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (ids.length === 0) {
    publish(NONE);
    return;
  }
  publish(new Set(ids));
  timer = setTimeout(() => {
    timer = null;
    publish(NONE);
  }, JUST_ADDED_MS);
}

export const clearJustAdded = (): void => markJustAdded([]);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The ids of the prompts just added, for the table's highlight and the "Added just now" chip. */
export const useJustAdded = (): ReadonlySet<string> =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => NONE,
  );
