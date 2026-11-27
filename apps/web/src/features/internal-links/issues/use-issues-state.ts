'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import type { IssueCheck } from '@/lib/issues/types';
import { parseIssuesSearch, type IssuesState } from '@/lib/issues/url-state';

/** The keys of the Issues address (spec 7.1). The page inspector's own keys belong to the open check (task 3). */
export type IssuesKey = 'tab' | 'check' | 'severity' | 'by' | 'q' | 'passed' | 'sort';

const PARSERS = {
  tab: parseAsString,
  check: parseAsString,
  severity: parseAsString,
  by: parseAsString,
  q: parseAsString,
  passed: parseAsString,
  sort: parseAsString,
} satisfies Record<IssuesKey, typeof parseAsString>;

export type SetIssuesSearch = (
  values: Partial<Record<IssuesKey, string | null>>,
  options?: { history?: 'push' | 'replace' },
) => void;

/**
 * The page's state from the address; nothing is written on load. A change of tab or check makes a history entry
 * (the caller passes `push`); filters replace. `checks` is the list read so far: a check of the other tab switches
 * the tab to its own once the list is there.
 */
export function useIssuesState(checks: readonly IssueCheck[]): { state: IssuesState; setSearch: SetIssuesSearch } {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parseIssuesSearch(search, checks), [search, checks]);
  const setSearch = useCallback<SetIssuesSearch>(
    (values, { history = 'replace' } = {}) => {
      void setState(values, { history });
    },
    [setState],
  );
  return { state, setSearch };
}
