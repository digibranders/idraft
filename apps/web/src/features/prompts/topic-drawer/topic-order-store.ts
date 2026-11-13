'use client';

import { useSyncExternalStore } from 'react';

/**
 * The topics the Topics tab last drew, in the order drawn, per project: what the topic drawer's Previous, Next, J and K
 * step through and its "3 of 13" counts. The view fills it while it is mounted and empties it when it goes. A small
 * store and not a prop, since the drawer and the table are two branches of the screen.
 */

const orders = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

/** The keys of the topics in the order drawn (a term id, or `__none`), or `null` when no table has drawn them. */
export const getTopicOrder = (projectId: string): readonly string[] | null => orders.get(projectId) ?? null;

export function setTopicOrder(projectId: string, keys: readonly string[] | null): void {
  if (keys === null) orders.delete(projectId);
  else orders.set(projectId, keys);
  for (const listener of listeners) listener();
}

/** Calls `listener` after every change; returns the function that stops it. */
export const subscribeTopicOrder = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The order a table drew, read live: the drawer follows the table. */
export function useTopicOrder(projectId: string): readonly string[] | null {
  return useSyncExternalStore(
    subscribeTopicOrder,
    () => getTopicOrder(projectId),
    () => null,
  );
}
