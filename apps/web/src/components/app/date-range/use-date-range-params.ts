'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import {
  readRangeParams,
  resolveRange,
  writeRangeParams,
  type DateRangeValue,
  type RangeLimits,
  type RangeProblem,
  type ResolvedRange,
} from './range-model';

export interface UseDateRangeParamsOptions extends RangeLimits {
  /** A key a page used before `win` (Topics & Prompts: `window` with 7, 28, 90): read as `win` when `win` is absent. */
  legacyWindowKey?: string | undefined;
}

export interface DateRangeParamsState {
  value: DateRangeValue;
  range: ResolvedRange;
  /** Why the link's range was not used, for the page's notice; `null` when it was. */
  dropped: RangeProblem | null;
  /** Writes `win`, or `from` and `to`, with history replace, and removes the legacy key and the keys not used. */
  onValueChange: (value: DateRangeValue) => void;
}

/**
 * The date range of a page, kept in the URL (23-application-patterns.md section 15): `win=7d|28d|90d` or
 * `from` and `to` in project days; the default writes nothing. A link whose range is unreadable or refused
 * shows the default, and `dropped` says why. The address keeps that link until the person picks a range.
 */
export function useDateRangeParams({
  today,
  earliest,
  maxDays,
  legacyWindowKey,
}: UseDateRangeParamsOptions): DateRangeParamsState {
  const parsers = useMemo(
    (): Record<string, typeof parseAsString> => ({
      win: parseAsString,
      from: parseAsString,
      to: parseAsString,
      ...(legacyWindowKey === undefined ? {} : { [legacyWindowKey]: parseAsString }),
    }),
    [legacyWindowKey],
  );
  const [state, setState] = useQueryStates(parsers, { history: 'replace' });

  const win = state['win'] ?? null;
  const from = state['from'] ?? null;
  const to = state['to'] ?? null;
  const legacy = legacyWindowKey === undefined ? null : (state[legacyWindowKey] ?? null);

  const { value, dropped } = useMemo(
    () =>
      readRangeParams({ win: win ?? (legacy === null ? null : `${legacy}d`), from, to }, { today, earliest, maxDays }),
    [win, from, to, legacy, today, earliest, maxDays],
  );
  const range = useMemo(() => resolveRange(value, today), [value, today]);

  const onValueChange = useCallback(
    (next: DateRangeValue): void => {
      void setState({
        ...writeRangeParams(next),
        ...(legacyWindowKey === undefined ? {} : { [legacyWindowKey]: null }),
      });
    },
    [legacyWindowKey, setState],
  );

  return { value, range, dropped, onValueChange };
}
