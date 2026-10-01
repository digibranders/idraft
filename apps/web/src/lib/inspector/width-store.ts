import { INSPECTOR_WIDTH, type InspectorType } from './placement';

/**
 * The inspector width a person chose, per object type, in `localStorage` (16-drawers-dialogs-popovers.md
 * section 2.2). A convenience of one browser: storage may be missing, full or blocked, and then the
 * default width applies. Readers subscribe, so a write in this tab or another one reaches them.
 */
const keyOf = (type: InspectorType): string => `inspector-width:${type}`;
const listeners = new Set<() => void>();
// Where a width lives when storage refused it (blocked, or full): until the page reloads
const memory = new Map<InspectorType, number | null>();

export function readInspectorWidth(type: InspectorType): number | null {
  if (memory.has(type)) return memory.get(type) ?? null;
  try {
    const stored = window.localStorage.getItem(keyOf(type));
    if (stored === null) return null;
    const width = Number(stored);
    return Number.isInteger(width) && width >= INSPECTOR_WIDTH.min && width <= INSPECTOR_WIDTH.max ? width : null;
  } catch {
    return null;
  }
}

/** Stores a width, or forgets it with `null` (Reset width). */
export function writeInspectorWidth(type: InspectorType, width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(keyOf(type));
    else window.localStorage.setItem(keyOf(type), String(width));
    memory.delete(type);
  } catch {
    // Storage is blocked or full: the width in memory serves until the page reloads
    memory.set(type, width);
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
