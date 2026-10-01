'use client';

import { parseAsString, useQueryStates } from 'nuqs';

import { formatInspectTarget, parseInspectTarget, type InspectorTarget } from '@/lib/inspector/placement';

/** The first tab of every inspector, left out of the URL. */
export const DEFAULT_INSPECTOR_TAB = 'overview';

const KEYS = { inspect: parseAsString, itab: parseAsString };

/**
 * Whether this page pushed the history entry the open inspector sits on. Closing then goes back, so Back
 * and Forward stay clean; an inspector that came with the URL (a shared link) closes by replacing instead
 * (16-drawers-dialogs-popovers.md section 2.7). History is one per window, so the flag is too.
 */
let pushedByPage = false;

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
  const tabParam = (next: string | undefined): string | null =>
    next === undefined || next === DEFAULT_INSPECTOR_TAB ? null : next;

  const open: UseInspectorResult['open'] = (next, options) => {
    const opening = target === null;
    if (opening) pushedByPage = true;
    void setState(
      { inspect: formatInspectTarget(next), itab: tabParam(options?.tab ?? (opening ? undefined : tab)) },
      { history: opening ? 'push' : 'replace' },
    );
  };
  const close = (): void => {
    if (target === null) return;
    if (pushedByPage) {
      pushedByPage = false;
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
