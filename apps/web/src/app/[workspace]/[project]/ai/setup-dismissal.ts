'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether the person closed the setup checklist for good on the AI Overview of one project, kept in this browser's
 * `localStorage` (WB-SET-17, open question 3 of the checklist: keeping it dismissed is the page's). It is a
 * convenience of one browser, never an API call: storage may be missing, full or blocked, and then the checklist
 * shows and a dismissal lasts until the page reloads. Readers subscribe, so a dismissal reaches every mounted
 * checklist, in this tab and in others.
 */

export const dismissalKey = (workspaceId: string, projectId: string): string =>
  `idraft.setup.ai.dismissed:${workspaceId}:${projectId}`;

const listeners = new Set<() => void>();
// Dismissals that storage refused, until the page reloads
const memory = new Set<string>();

function isDismissed(key: string): boolean {
  if (memory.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function dismiss(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    memory.add(key);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * `dismissed` and how to set it for the project. On the server nothing is known, so the checklist is not drawn
 * there: a person who dismissed it never sees it flash, and the first visit gets it once the page is on screen.
 */
export function useSetupDismissed(workspaceId: string, projectId: string): { dismissed: boolean; dismiss: () => void } {
  const key = dismissalKey(workspaceId, projectId);
  const dismissed = useSyncExternalStore(
    subscribe,
    () => isDismissed(key),
    () => true,
  );
  const onDismiss = useCallback(() => dismiss(key), [key]);
  return { dismissed, dismiss: onDismiss };
}
