'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { parseWidths, type ColumnWidths } from './board-widths';

const KEY = 'idraft:column-widths:';

/** Widths of this tab, for a browser that keeps nothing (a private window, blocked site data). */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(key: string): string | null {
  const remembered = memory.get(key);
  if (remembered !== undefined) return remembered === '' ? null : remembered;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, widths: ColumnWidths): void {
  const text = Object.keys(widths).length === 0 ? '' : JSON.stringify(widths);
  memory.set(key, text);
  try {
    if (text === '') window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, text);
  } catch {
    // A blocked or full store only loses the saved widths for the next visit
  }
  for (const listener of listeners) listener();
}

export interface ColumnWidthState {
  widths: ColumnWidths;
  /** A width in pixels, or `null` for the column's default. */
  setWidth: (id: string, width: number | null) => void;
  reset: () => void;
}

/** The widths a person set on one table, kept in this browser under the table's id. The server renders the defaults. */
export function useColumnWidths(tableId: string): ColumnWidthState {
  const key = KEY + tableId;
  const text = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const widths = useMemo(() => parseWidths(text), [text]);
  const setWidth = useCallback(
    (id: string, width: number | null) => {
      const rest = Object.entries(parseWidths(read(key))).filter(([name]) => name !== id);
      write(key, Object.fromEntries(width === null ? rest : [...rest, [id, width]]));
    },
    [key],
  );
  const reset = useCallback(() => write(key, {}), [key]);
  return { widths, setWidth, reset };
}
