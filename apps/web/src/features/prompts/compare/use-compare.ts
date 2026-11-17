'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { useCallback } from 'react';

import { CMP_YEAR as COMPARE_YEAR, compareKindOf, type CompareKind } from '@/lib/compare/compare-model';

/** The values of `cmp` that turn the comparison on: the period before, or the same dates a year earlier. */
const COMPARE_PREVIOUS = 'previous';

/** What the comparison is with, as the words say it: the select's choices, the tips and the empty states. */
export type CompareMode = 'previous' | 'year';

export interface CompareState {
  /** The comparison is on: only `cmp=previous` or `cmp=year` asks for it, a link without `cmp` has none. */
  compare: boolean;
  /** What it is with; `previous` while it is off, which nothing reads. */
  mode: CompareMode;
  /** The `compare` the API takes for `mode`. */
  kind: CompareKind;
  /** Writes `cmp=previous` for on and removes the key for off, with history replace: a default writes nothing. */
  setCompare: (next: boolean) => void;
  /** Writes `cmp=year` or `cmp=previous`, which turns the comparison on. */
  setMode: (next: CompareMode) => void;
}

/**
 * The comparison period of the page, kept in the address as `cmp` (13 section 5). It is off until the person asks, so
 * the table opens on plain rates; it is scope like the location, so Clear filters leaves it. `cmp=previous` is the
 * period before, `cmp=year` the same dates a year earlier; `cmp=off` of older links reads as off too, as does any
 * other value.
 */
export function useCompare(): CompareState {
  const [value, setValue] = useQueryState('cmp', parseAsString.withOptions({ history: 'replace' }));
  const setCompare = useCallback((next: boolean): void => void setValue(next ? COMPARE_PREVIOUS : null), [setValue]);
  const setMode = useCallback(
    (next: CompareMode): void => void setValue(next === 'year' ? COMPARE_YEAR : COMPARE_PREVIOUS),
    [setValue],
  );
  const mode: CompareMode = value === COMPARE_YEAR ? 'year' : 'previous';
  return {
    compare: value === COMPARE_PREVIOUS || value === COMPARE_YEAR,
    mode,
    kind: compareKindOf(value),
    setCompare,
    setMode,
  };
}
