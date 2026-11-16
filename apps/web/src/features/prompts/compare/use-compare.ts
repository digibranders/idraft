'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { useCallback } from 'react';

/** The value of `cmp` that turns the comparison on. */
const COMPARE_ON = 'previous';

export interface CompareState {
  /** The comparison with the period before is on: only `cmp=previous` asks for it, a link without `cmp` has none. */
  compare: boolean;
  /** Writes `cmp=previous` for on and removes the key for off, with history replace: a default writes nothing. */
  setCompare: (next: boolean) => void;
}

/**
 * The comparison period of the page, kept in the address as `cmp` (13 section 5). It is off until the person asks, so
 * the table opens on plain rates; it is scope like the location, so Clear filters leaves it. `cmp=off` of older links
 * reads as off too, as does any value but `previous`.
 */
export function useCompare(): CompareState {
  const [value, setValue] = useQueryState('cmp', parseAsString.withOptions({ history: 'replace' }));
  const setCompare = useCallback((next: boolean): void => void setValue(next ? COMPARE_ON : null), [setValue]);
  return { compare: value === COMPARE_ON, setCompare };
}
