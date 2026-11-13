'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { useCallback } from 'react';

import { cmpParam, parseCompare } from '@/lib/compare/compare-model';

export interface CompareState {
  /** The comparison with the period before is on: no `cmp` key (the default, D-03), or any value but `off`. */
  compare: boolean;
  /** Writes `cmp=off` for off and removes the key for on, with history replace: a default writes nothing. */
  setCompare: (next: boolean) => void;
}

/** The comparison period of the page, kept in the address as `cmp` (13 section 5). It is scope: Clear filters leaves it. */
export function useCompare(): CompareState {
  const [value, setValue] = useQueryState('cmp', parseAsString.withOptions({ history: 'replace' }));
  const setCompare = useCallback((next: boolean): void => void setValue(cmpParam(next)), [setValue]);
  return { compare: parseCompare(value), setCompare };
}
