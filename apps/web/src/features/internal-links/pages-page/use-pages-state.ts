'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { parsePagesSearch, type PagesKey, type PagesState } from '@/lib/pages/url-state';

const PARSERS = {
  run: parseAsString,
  scope: parseAsString,
  view: parseAsString,
  sort: parseAsString,
  q: parseAsString,
  depth: parseAsString,
  variants: parseAsString,
  inspect: parseAsString,
  itab: parseAsString,
} satisfies Record<PagesKey, typeof parseAsString>;

export type SetPagesSearch = (
  values: Partial<Record<PagesKey, string | null>>,
  options?: { history?: 'push' | 'replace' },
) => void;

/** The Pages screens' state from the address; nothing is written on load. */
export function usePagesState(): { state: PagesState; setSearch: SetPagesSearch } {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const state = useMemo(() => parsePagesSearch(search), [search]);
  const setSearch = useCallback<SetPagesSearch>(
    (values, { history = 'replace' } = {}) => {
      void setState(values, { history });
    },
    [setState],
  );
  return { state, setSearch };
}
