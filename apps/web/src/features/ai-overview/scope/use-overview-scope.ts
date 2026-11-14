'use client';

import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo } from 'react';

import { useDateRangeParams } from '@/components/app/date-range/use-date-range-params';
import type { RangeProblem } from '@/components/app/date-range/range-model';
import { cmpParam, parseCompare } from '@/lib/compare/compare-model';
import { useZoneDay } from '@/lib/dom/use-zone-day';
import { ENGINES } from '@/lib/layouts/catalog';

import {
  parseBranded,
  parseCountry,
  parseEngines,
  parseTopic,
  previousWindow,
  type OverviewScope,
  type ScopePatch,
} from './scope-model';

/** The longest window the summary and the sources reads accept, in project days. */
export const MAX_DAYS = 92;

/** The engine codes the API accepts (the layout catalog's list): a link naming another reads as every engine. */
const KNOWN_ENGINES: readonly string[] = ENGINES.map((engine) => engine.code);

/** The keys of the scope besides the date range's own (`win`, `from`, `to`). */
const SCOPE_KEYS = {
  cmp: parseAsString,
  country: parseAsString,
  engine: parseAsString,
  topic: parseAsString,
  branded: parseAsString,
};

export interface UseOverviewScopeOptions {
  project: {
    /** The project's IANA time zone: the days of the window are its days. */
    timeZone: string;
  };
  /** The engine codes a link may name; the API's engines unless a test or a later task narrows them. */
  knownEngines?: readonly string[] | undefined;
}

export interface OverviewScopeState {
  scope: OverviewScope;
  /** Why the link's range was not used, for the page's notice; `null` when it was. */
  dropped: RangeProblem | null;
  /** The day it is now in the project's zone, the end of the default window. */
  today: string;
  /** Writes the keys of `patch` with history replace; a value that is the default removes its key. */
  setScope: (patch: ScopePatch) => void;
}

/**
 * The Overview's scope kept in the URL: the date range through `useDateRangeParams` (`win`, or `from` and
 * `to`, at most 92 days) and `cmp`, `country`, `engine`, `topic` and `branded` beside it. Every value is read
 * through the parsers of `scope-model.ts`, so a link with a value that does not read shows the default; the
 * address keeps that link until the person changes it. Changes are made with `replace`, and the default of
 * each key (comparison on, no country, every engine, no topic, branded excluded) writes nothing.
 */
export function useOverviewScope({
  project,
  knownEngines = KNOWN_ENGINES,
}: UseOverviewScopeOptions): OverviewScopeState {
  const today = useZoneDay(project.timeZone);
  const picked = useDateRangeParams({ today, maxDays: MAX_DAYS });
  const [raw, setRaw] = useQueryStates(SCOPE_KEYS, { history: 'replace' });
  const { onValueChange } = picked;

  const scope = useMemo(
    (): OverviewScope => ({
      range: picked.range,
      rangeValue: picked.value,
      compare: parseCompare(raw.cmp),
      previous: previousWindow(picked.range.from, picked.range.to),
      country: parseCountry(raw.country),
      engines: parseEngines(raw.engine, knownEngines),
      topic: parseTopic(raw.topic),
      branded: parseBranded(raw.branded),
    }),
    [picked.range, picked.value, raw, knownEngines],
  );

  const setScope = useCallback(
    (patch: ScopePatch): void => {
      if (patch.range !== undefined) onValueChange(patch.range);
      const keys: Partial<Record<keyof typeof SCOPE_KEYS, string | null>> = {};
      if (patch.compare !== undefined) keys.cmp = cmpParam(patch.compare);
      if (patch.country !== undefined) keys.country = patch.country;
      if (patch.engines !== undefined) {
        keys.engine = patch.engines === null || patch.engines.length === 0 ? null : patch.engines.join(',');
      }
      if (patch.topic !== undefined) keys.topic = patch.topic;
      if (patch.branded !== undefined) keys.branded = patch.branded === 'excluded' ? null : patch.branded;
      if (Object.keys(keys).length > 0) void setRaw(keys);
    },
    [onValueChange, setRaw],
  );

  return { scope, dropped: picked.dropped, today, setScope };
}
