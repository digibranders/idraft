'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect } from 'react';

import { formatInspectTarget, parseInspectTarget, type InspectorTarget } from '@/lib/inspector/placement';

/** The first tab of every inspector, left out of the URL. */
export const DEFAULT_INSPECTOR_TAB = 'overview';

const KEYS = { inspect: parseAsString, itab: parseAsString };

/**
 * Set when this page pushed the history entry the open inspector sits on: the query string of the entry
 * before it, without the inspector's own keys. Closing then goes back, so Back and Forward stay clean, but
 * only while the page still has that query string: the filters, the sort, the search and the view replace
 * the entry the inspector sits on, and going back would land on the old one and undo them. Then, like an
 * inspector that came with the URL (a shared link), it closes by replacing (16-drawers-dialogs-popovers.md
 * section 2.7). History is one per window, so this is too.
 */
let pushedFrom: string | null = null;

/** The URL's query string without the inspector's keys. */
function pageQuery(): string {
  const params = new URLSearchParams(window.location.search);
  for (const key of Object.keys(KEYS)) params.delete(key);
  return params.toString();
}

export interface UseInspectorResult {
  target: InspectorTarget | null;
  /** `overview` when the URL names none. */
  tab: string;
  /** Opens a record: pushes an entry when the inspector was closed, replaces it when one was open. */
  open: (target: InspectorTarget, options?: { tab?: string }) => void;
  close: () => void;
  setTab: (tab: string) => void;
  /** Where the open record is in the list's current order, for "12 of 986"; `null` when it is not in it. */
  position: (orderedIds: readonly string[]) => { index: number; count: number } | null;
  /** The next or previous record in the list's current order, keeping the tab. */
  step: (direction: 'next' | 'previous', orderedIds: readonly string[]) => void;
}

/** The open inspector, read from and written to `?inspect=<type>:<id>&itab=<tab>`. */
export function useInspector(): UseInspectorResult {
  const [state, setState] = useQueryStates(KEYS);
  const target = parseInspectTarget(state.inspect);
  const tab = state.itab ?? DEFAULT_INSPECTOR_TAB;
  // Once the inspector is closed, by Close or by the browser's Back, the entry it sat on is gone: a later
  // inspector that arrives with the URL must close by replacing, not by going back
  const closed = target === null;
  useEffect(() => {
    if (closed) pushedFrom = null;
  }, [closed]);
  const tabParam = (next: string | undefined): string | null =>
    next === undefined || next === DEFAULT_INSPECTOR_TAB ? null : next;

  const open: UseInspectorResult['open'] = (next, options) => {
    const opening = target === null;
    if (opening) pushedFrom = pageQuery();
    void setState(
      { inspect: formatInspectTarget(next), itab: tabParam(options?.tab ?? (opening ? undefined : tab)) },
      { history: opening ? 'push' : 'replace' },
    );
  };
  const close = (): void => {
    if (target === null) return;
    const from = pushedFrom;
    pushedFrom = null;
    if (from !== null && from === pageQuery()) {
      window.history.back();
      return;
    }
    void setState({ inspect: null, itab: null }, { history: 'replace' });
  };
  const setTab = (next: string): void => {
    void setState({ itab: tabParam(next) }, { history: 'replace' });
  };
  const position: UseInspectorResult['position'] = (orderedIds) => {
    if (target === null) return null;
    const index = orderedIds.indexOf(target.id);
    return index === -1 ? null : { index, count: orderedIds.length };
  };
  const step: UseInspectorResult['step'] = (direction, orderedIds) => {
    const at = position(orderedIds);
    if (target === null || at === null) return;
    const id = orderedIds[at.index + (direction === 'next' ? 1 : -1)];
    if (id === undefined) return;
    void setState({ inspect: formatInspectTarget({ type: target.type, id }) }, { history: 'replace' });
  };
  return { target, tab, open, close, setTab, position, step };
}
