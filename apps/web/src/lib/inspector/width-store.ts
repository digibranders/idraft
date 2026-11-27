'use client';

import { createContext } from 'react';

import { INSPECTOR_TYPES, INSPECTOR_WIDTH } from './placement';
import { preferenceKey } from '@/lib/preferences/storage';

/**
 * The inspector width a person chose, one for every drawer, in `localStorage` under their user id with their other
 * preferences (16-drawers-dialogs-popovers.md section 2.2), so signing out removes it. A convenience of one browser:
 * storage may be missing, full or blocked, and then the width lasts until the page reloads.
 */

/** Whose width it is. The workspace provides the user id; without one (a preview, a test) the width stays in memory. */
export const InspectorWidthUserContext = createContext<string | null>(null);

const NAME = 'inspector-width';
const listeners = new Set<() => void>();
// Where a width lives without a user id, or when storage refused it: until the page reloads
const memory = new Map<string, number | null>();
const slotOf = (userId: string | null): string => userId ?? '';

export function readInspectorWidth(userId: string | null): number | null {
  const slot = slotOf(userId);
  if (memory.has(slot)) return memory.get(slot) ?? null;
  if (userId === null) return null;
  try {
    const stored = window.localStorage.getItem(preferenceKey(userId, NAME));
    if (stored === null || stored === '') return null;
    const width = Number(stored);
    return Number.isInteger(width) && width >= INSPECTOR_WIDTH.min && width <= INSPECTOR_WIDTH.max ? width : null;
  } catch {
    return null;
  }
}

/** Stores a width, or forgets it with `null` (a reset). */
export function writeInspectorWidth(userId: string | null, width: number | null): void {
  if (userId === null) {
    memory.set('', width);
  } else {
    try {
      if (width === null) window.localStorage.removeItem(preferenceKey(userId, NAME));
      else window.localStorage.setItem(preferenceKey(userId, NAME), String(width));
      // The widths kept per object type before there was one width: no longer read
      for (const type of INSPECTOR_TYPES) window.localStorage.removeItem(`inspector-width:${type}`);
      memory.delete(userId);
    } catch {
      // Storage is blocked or full: the width in memory serves until the page reloads
      memory.set(userId, width);
    }
  }
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: calls back on a write here or in another tab. */
export function subscribeInspectorWidth(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
