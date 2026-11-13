'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  askedEngines,
  brandedAskable,
  comparisonWindow,
  overviewEnginesQuery,
  overviewFanoutQuery,
  overviewSchedulesQuery,
  overviewSourcesQuery,
  overviewSummaryQuery,
  type ProjectRef,
  type ReadScope,
  type SourcesOptions,
  type SummaryOptions,
} from './overview-queries';
import { mapRead, useRead, type Gate, type Read } from './read-state';
import type { EngineCode, ProjectEngine, PromptsSummary, Schemas } from '@/lib/api/types';

/**
 * The reads of the AI visibility Overview (WP-33 plan section 3.3). The shell and every card read through these
 * hooks and never call the API themselves, so when the WP-32 aggregate routes are built only the hooks and
 * `buildAggregates` change. Each takes what it reads: the project, the scope, and the engines the project has on
 * (from `useOverviewEngines`). A page mounts its cards once the engines are known, so a read that is `idle` here
 * means no engine is on or the scope asks none.
 */

/** What a read of the scope takes: where, which scope, and which engines are on. */
export interface OverviewReadInput extends ReadScope {
  project: ProjectRef;
}

/**
 * Options every read takes besides its own. A card passes the `subscribed` prop of its `CardProps`:
 * `useOverviewSummary({ subscribed })`. While it is `false` (the grid is in customize mode, or the card is out of
 * view) the read asks nothing, whatever the scope does; it shows the data it already has for the scope and is `idle`
 * when it has none, never `loading` and never `error`. When it turns `true` again the read asks once, or serves
 * the cache while it is fresh. Left out or `undefined` it is `true`, so a caller that passes nothing is unchanged.
 */
export interface ReadOptions {
  subscribed?: boolean | undefined;
}

export type SummaryReadOptions = SummaryOptions & ReadOptions;
export type SourcesReadOptions = SourcesOptions & ReadOptions;

/** `idle` when the read has nothing to ask; otherwise `run`, or `paused` while it is not subscribed. */
const gateOf = (runs: boolean, subscribed: boolean): Gate => (!runs ? 'idle' : subscribed ? 'run' : 'paused');

export type OverviewSourcesMeta = Schemas['SourcesMeta'];
export type OverviewFanoutMeta = Schemas['FanoutMeta'];

/** The AI workload's schedules in one fact each: when the next run is, and whether every schedule is paused. */
export interface OverviewSchedule {
  /** The earliest next run of the active schedules, or `null` when none is active. */
  nextRunAt: string | null;
  /** The project has AI schedules and every one is paused; a project with none is not paused, it has not started. */
  paused: boolean;
}

export type OverviewEngines = Read<readonly ProjectEngine[]> & {
  /** The engines that are on, in the order the API lists them. */
  enabled: readonly EngineCode[];
};

const enginesOf = (page: { data: ProjectEngine[] }): readonly ProjectEngine[] => page.data;
const summaryOf = (page: Schemas['PromptsSummaryResponse']): PromptsSummary => page.data;
const sourcesMetaOf = (page: Schemas['SourceDomainPage']): OverviewSourcesMeta => page.meta;
const fanoutMetaOf = (page: Schemas['FanoutQueryPage']): OverviewFanoutMeta => page.meta;

function scheduleOf(page: Schemas['SchedulePage']): OverviewSchedule {
  const active = page.data.filter((schedule) => schedule.is_active);
  const nextRunAt = active.reduce<string | null>(
    (first, schedule) =>
      first === null || Date.parse(schedule.next_run_at) < Date.parse(first) ? schedule.next_run_at : first,
    null,
  );
  return { nextRunAt, paused: page.data.length > 0 && active.length === 0 };
}

const enabledOf = (engines: readonly ProjectEngine[]): readonly EngineCode[] =>
  engines.filter((engine) => engine.is_enabled).map((engine) => engine.engine.engine_code);

/** `GET engines`: the same request and key as `useLayoutCapabilities`, so the engines are one request. */
export function useOverviewEngines(project: ProjectRef): OverviewEngines {
  const read = useRead(useQuery(overviewEnginesQuery(project)));
  return useMemo(() => {
    const engines = mapRead(read, enginesOf);
    return { ...engines, enabled: engines.data === undefined ? [] : enabledOf(engines.data) };
  }, [read]);
}

function useSummary(
  input: OverviewReadInput,
  period: 'current' | 'previous',
  { subscribed = true, ...options }: SummaryReadOptions,
): Read<PromptsSummary> {
  const { project, scope, enabledEngines } = input;
  const runs = askedEngines(input).length > 0 && (period === 'current' || comparisonWindow(scope) !== null);
  const gate = gateOf(runs, subscribed);
  const query = useQuery({
    ...overviewSummaryQuery(project, { scope, enabledEngines }, { ...options, period }),
    enabled: gate === 'run',
    // A scope change keeps the last figures on screen until the new ones arrive
    placeholderData: keepPreviousData,
  });
  const read = useRead(query, gate);
  return useMemo(() => mapRead(read, summaryOf), [read]);
}

/**
 * The summary of the scope's window, one read; not asked while no engine in the scope is on, nor while
 * `options.subscribed` is `false` (a card passes the `subscribed` of its `CardProps`).
 */
export function useOverviewSummary(input: OverviewReadInput, options: SummaryReadOptions = {}): Read<PromptsSummary> {
  return useSummary(input, 'current', options);
}

export interface OverviewPeriods {
  current: Read<PromptsSummary>;
  /** `null` when the comparison is off or unavailable: it is not read, and a figure of it is never zero. */
  previous: Read<PromptsSummary> | null;
  /**
   * The two windows are of the same scope: the current read is `ready` and so is the previous one, or there is no
   * previous read by design. A scope change keeps the last data of each read (`keepPreviousData`) and the two reads
   * settle separately, so for a moment one window can be the new one and the other the old one: a change between
   * them would be of two different scopes. Callers of `buildAggregates` pass `previous: null` while this is false.
   */
  paired: boolean;
  /**
   * No read of the page's summary is under way (none is `loading` or `refetching`). While it is false the data
   * shown is that of the last scope while the scope itself is the new one (the engine filter, the topic), so a
   * figure read against the new scope can say "No valid answers" for what is only still loading: show the loading
   * state, not an empty one. It is a fact of the reads, not of the aggregates, so it lives here.
   */
  settled: boolean;
}

const busy = (read: Read<PromptsSummary>): boolean => read.status === 'loading' || read.status === 'refetching';

/**
 * The summary of the window and, while the comparison is on and its window can be asked, of the window just
 * before it, with whether the two answer for the same scope (`paired`) and whether the reads are done (`settled`).
 * While `options.subscribed` is `false` neither window is asked: with data of this scope in the cache both keep it
 * (`paired` and `settled` hold), without it both are `idle` (`settled`, not `paired`), so nothing waits on them.
 */
export function useOverviewPeriods(input: OverviewReadInput, options: SummaryReadOptions = {}): OverviewPeriods {
  const current = useSummary(input, 'current', options);
  const previousRead = useSummary(input, 'previous', options);
  const compared = comparisonWindow(input.scope) !== null;
  return useMemo(() => {
    const previous = compared ? previousRead : null;
    return {
      current,
      previous,
      paired: current.status === 'ready' && (previous === null || previous.status === 'ready'),
      settled: !busy(current) && (previous === null || !busy(previous)),
    };
  }, [current, previousRead, compared]);
}

/** The meta of the sources read: the citation units by role (own over all), per engine, and the window before. */
export function useOverviewSources(
  input: OverviewReadInput,
  { subscribed = true, ...options }: SourcesReadOptions = {},
): Read<OverviewSourcesMeta> {
  const { project, scope, enabledEngines } = input;
  const gate = gateOf(askedEngines(input).length > 0 && brandedAskable(scope), subscribed);
  const query = useQuery({
    ...overviewSourcesQuery(project, { scope, enabledEngines }, options),
    enabled: gate === 'run',
    placeholderData: keepPreviousData,
  });
  const read = useRead(query, gate);
  return useMemo(() => mapRead(read, sourcesMetaOf), [read]);
}

/**
 * The meta of the fan-out read: the answers that issued a query over the answers, of the engines that show their
 * fan-out. Waits for the engines (the same request `useOverviewEngines` makes) to learn which those are.
 */
export function useOverviewFanout(
  input: OverviewReadInput,
  { subscribed = true }: ReadOptions = {},
): Read<OverviewFanoutMeta> {
  const { project, scope } = input;
  const engines = useQuery(overviewEnginesQuery(project));
  const showing = useMemo(
    () =>
      (engines.data?.data ?? [])
        .filter((engine) => engine.is_enabled && engine.engine.exposes_fanout)
        .map((engine) => engine.engine.engine_code)
        .filter((code) => input.enabledEngines.includes(code)),
    [engines.data, input.enabledEngines],
  );
  const read: ReadScope = { scope, enabledEngines: showing };
  const known = engines.data !== undefined;
  const runs = known && askedEngines(read).length > 0 && brandedAskable(scope);
  const query = useQuery({
    ...overviewFanoutQuery(project, read),
    enabled: runs && subscribed,
    placeholderData: keepPreviousData,
  });
  // Without the engines there is nothing to ask yet, unless they could not be read: then nothing can be asked
  const gate: Gate = runs
    ? gateOf(true, subscribed)
    : known || engines.isError || !brandedAskable(scope)
      ? 'idle'
      : 'waiting';
  const result = useRead(query, gate);
  return useMemo(() => mapRead(result, fanoutMetaOf), [result]);
}

/** When the AI workload runs next and whether it is paused, for the notice before the first answers. */
export function useOverviewSchedule(
  project: ProjectRef,
  { subscribed = true }: ReadOptions = {},
): Read<OverviewSchedule> {
  const query = useQuery({ ...overviewSchedulesQuery(project), enabled: subscribed });
  const read = useRead(query, gateOf(true, subscribed));
  // Made from the page, not from the read, so pausing and resuming give the same object while the page is the same
  const schedule = useMemo(() => (query.data === undefined ? undefined : scheduleOf(query.data)), [query.data]);
  return useMemo(() => ({ ...read, data: read.data === undefined ? undefined : schedule }), [read, schedule]);
}
