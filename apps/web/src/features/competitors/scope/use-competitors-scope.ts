'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import {
  ADDRESS_KEYS,
  parseScope,
  type Branded,
  type CompetitorKey,
  type CompetitorsScope,
  type CompetitorTab,
  type TopicMetric,
} from './scope-model';
import { useDateRangeParams, type DateRangeParamsState } from '@/components/app/date-range/use-date-range-params';
import type { EngineCode } from '@/lib/api/types';
import { cmpParam } from '@/lib/compare/compare-model';
import { useZoneDay } from '@/lib/dom/use-zone-day';

/** The longest window the reads accept, in project days. */
export const MAX_DAYS = 92;

/** The first and last day of the window, in the project's zone. */
export interface DateWindow {
  from: string;
  to: string;
}

/** The parts of the scope a person changes; a key left out stays as it is, and a default value removes its key. */
export interface ScopePatch {
  /** A tab is a place to go back to: it makes a history entry and clears the table's sort, columns and search. */
  tab?: CompetitorTab;
  compare?: boolean;
  country?: string | null;
  /** `null` or an empty list is every engine that is on. */
  engines?: readonly EngineCode[] | null;
  /** The engine of the single engine surfaces, written as chosen. */
  eng?: EngineCode | null;
  metric?: TopicMetric;
  topic?: string | null;
  branded?: Branded;
  lost?: string | null;
}

const PARSERS: Record<CompetitorKey, typeof parseAsString> = Object.fromEntries(
  ADDRESS_KEYS.map((key) => [key, parseAsString]),
) as Record<CompetitorKey, typeof parseAsString>;

export interface CompetitorsScopeState {
  scope: CompetitorsScope;
  /** The date range's keys, for the picker and the notice of a link whose range was refused. */
  picked: DateRangeParamsState;
  range: DateWindow;
  /** The day it is now in the project's zone. */
  today: string;
  setScope: (patch: ScopePatch) => void;
}

/**
 * The page's scope from the address: the date range through `useDateRangeParams` (`win`, or `from` and `to`, at most
 * 92 days) and the keys of `scope-model.ts` beside it. `enabledEngines` are the engines that are on: an engine of a
 * link that is off is left out. Nothing is written on load, and a change is written with `replace`, except the tab.
 */
export function useCompetitorsScope(timeZone: string, enabledEngines: readonly EngineCode[]): CompetitorsScopeState {
  const [search, setState] = useQueryStates(PARSERS, { history: 'replace' });
  const scope = useMemo(() => parseScope(search, enabledEngines), [search, enabledEngines]);
  // `today` is a day of the project's zone: the one place the clock is read
  const today = useZoneDay(timeZone);
  const picked = useDateRangeParams({ today, maxDays: MAX_DAYS });
  const range = useMemo((): DateWindow => ({ from: picked.range.from, to: picked.range.to }), [picked.range]);

  const setScope = useCallback(
    (patch: ScopePatch): void => {
      const keys: Partial<Record<CompetitorKey, string | null>> = {};
      if (patch.tab !== undefined) {
        keys.tab = patch.tab === 'comparison' ? null : patch.tab;
        // The table state belongs to the tab it was set on
        keys.cols = null;
        keys.q = null;
        keys.sort = null;
      }
      if (patch.compare !== undefined) keys.cmp = cmpParam(patch.compare);
      if (patch.country !== undefined) keys.country = patch.country;
      if (patch.engines !== undefined) {
        keys.engine = patch.engines === null || patch.engines.length === 0 ? null : patch.engines.join(',');
      }
      if (patch.eng !== undefined) keys.eng = patch.eng;
      if (patch.metric !== undefined) keys.metric = patch.metric === 'mention' ? null : patch.metric;
      if (patch.topic !== undefined) keys.topic = patch.topic;
      if (patch.branded !== undefined) keys.branded = patch.branded === 'excluded' ? null : patch.branded;
      if (patch.lost !== undefined) keys.lost = patch.lost;
      if (Object.keys(keys).length > 0) void setState(keys, { history: patch.tab === undefined ? 'replace' : 'push' });
    },
    [setState],
  );

  return { scope, picked, range, today, setScope };
}
