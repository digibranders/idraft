'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { useCallback } from 'react';

import { DEFAULT_MIN_SUPPORT, MIN_SUPPORT_RANGE } from './fanout-queries';

/**
 * What a fan-out surface keeps in the address: the fewest answers a query is listed for (`fmin`) and which view
 * of the project wide tab is shown (`fview`). Each is read with its own key, so neither is a saved view key and
 * "Clear filters" never touches them (plan D6). A default is left out of the address.
 */

const MIN_KEY = 'fmin';
const VIEW_KEY = 'fview';
/** `useQueryState` replaces the entry: a change of the minimum is not a place to go back to. */
const PARSER = parseAsString.withOptions({ history: 'replace' });

/** The minimum an address holds: a whole number held between the route's bounds, else the default. */
export function parseMinSupport(text: string | null | undefined): number {
  if (text === null || text === undefined || !/^-?\d+$/.test(text.trim())) return DEFAULT_MIN_SUPPORT;
  return Math.min(MIN_SUPPORT_RANGE.max, Math.max(MIN_SUPPORT_RANGE.min, Number(text.trim())));
}

/** The minimum and how to change it. `null` (or the default) is the default, which the address does not hold. */
export function useFanoutMinSupport(): [number, (minSupport: number | null) => void] {
  const [text, setText] = useQueryState(MIN_KEY, PARSER);
  const setMinSupport = useCallback(
    (minSupport: number | null): void => {
      void setText(minSupport === null || minSupport === DEFAULT_MIN_SUPPORT ? null : String(minSupport));
    },
    [setText],
  );
  return [parseMinSupport(text), setMinSupport];
}

/** The views of the project wide tab: the queries, or the queries grouped by the topics of their prompts. */
export type FanoutView = 'queries' | 'topics';

/** The view and how to change it. `queries` is the default and is not written. */
export function useFanoutView(): [FanoutView, (view: FanoutView) => void] {
  const [text, setText] = useQueryState(VIEW_KEY, PARSER);
  const setView = useCallback(
    (view: FanoutView): void => {
      void setText(view === 'topics' ? 'topics' : null);
    },
    [setText],
  );
  return [text === 'topics' ? 'topics' : 'queries', setView];
}
