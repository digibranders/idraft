'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { isDefaultScope, parseCann, writeCann, type CannState, type CannTab } from './cann-model';

/** The keys the page keeps in its address: the scope, the view and its filters, the search and the page pair. */
const KEYS = ['device', 'group', 'days', 'view', 'show', 'sw', 'switched', 'q', 'pair'] as const;
const PARSERS = Object.fromEntries(KEYS.map((key) => [key, parseAsString])) as Record<
  (typeof KEYS)[number],
  typeof parseAsString
>;

export interface CannStateResult {
  state: CannState;
  /** Writes a change with history replace; defaults are never written. */
  set: (patch: Partial<CannState>) => void;
  /** Device, Group and Period back to their defaults. */
  resetScope: () => void;
  isDefaultScope: boolean;
}

export function useCannState(tab: CannTab): CannStateResult {
  const [search, setSearch] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseCann(search, tab), [search, tab]);
  const set = useCallback(
    (patch: Partial<CannState>): void => {
      void setSearch(writeCann({ ...state, ...patch }, tab), { history: 'replace' });
    },
    [state, tab, setSearch],
  );
  const resetScope = useCallback((): void => set({ device: 'desktop', group: 'all', days: 30 }), [set]);
  return { state, set, resetScope, isDefaultScope: isDefaultScope(state) };
}
