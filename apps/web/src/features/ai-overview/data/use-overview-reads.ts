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
  options: SummaryOptions,
): Read<PromptsSummary> {
  const { project, scope, enabledEngines } = input;
  const runs = askedEngines(input).length > 0 && (period === 'current' || comparisonWindow(scope) !== null);
  const gate: Gate = runs ? 'run' : 'idle';
  const query = useQuery({
    ...overviewSummaryQuery(project, { scope, enabledEngines }, { ...options, period }),
    enabled: runs,
    // A scope change keeps the last figures on screen until the new ones arrive
    placeholderData: keepPreviousData,
  });
  const read = useRead(query, gate);
  return useMemo(() => mapRead(read, summaryOf), [read]);
}

/** The summary of the scope's window, one read; not asked while no engine in the scope is on. */
export function useOverviewSummary(input: OverviewReadInput, options: SummaryOptions = {}): Read<PromptsSummary> {
  return useSummary(input, 'current', options);
}

/**
 * The summary of the window and, while the comparison is on and its window can be asked, of the window just
 * before it. `previous` is `null` when the comparison is off or unavailable: it is not read, and a figure of it is
 * never zero.
 */
export function useOverviewPeriods(
  input: OverviewReadInput,
  options: SummaryOptions = {},
): { current: Read<PromptsSummary>; previous: Read<PromptsSummary> | null } {
  const current = useSummary(input, 'current', options);
  const previous = useSummary(input, 'previous', options);
  const compared = comparisonWindow(input.scope) !== null;
  return useMemo(() => ({ current, previous: compared ? previous : null }), [current, previous, compared]);
}

/** The meta of the sources read: the citation units by role (own over all), per engine, and the window before. */
export function useOverviewSources(input: OverviewReadInput, options: SourcesOptions = {}): Read<OverviewSourcesMeta> {
  const { project, scope, enabledEngines } = input;
  const runs = askedEngines(input).length > 0 && brandedAskable(scope);
  const query = useQuery({
    ...overviewSourcesQuery(project, { scope, enabledEngines }, options),
    enabled: runs,
    placeholderData: keepPreviousData,
  });
  const read = useRead(query, runs ? 'run' : 'idle');
  return useMemo(() => mapRead(read, sourcesMetaOf), [read]);
}

/**
 * The meta of the fan-out read: the answers that issued a query over the answers, of the engines that show their
 * fan-out. Waits for the engines (the same request `useOverviewEngines` makes) to learn which those are.
 */
export function useOverviewFanout(input: OverviewReadInput): Read<OverviewFanoutMeta> {
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
  const query = useQuery({ ...overviewFanoutQuery(project, read), enabled: runs, placeholderData: keepPreviousData });
  // Without the engines there is nothing to ask yet, unless they could not be read: then nothing can be asked
  const gate: Gate = runs ? 'run' : known || engines.isError || !brandedAskable(scope) ? 'idle' : 'waiting';
  const result = useRead(query, gate);
  return useMemo(() => mapRead(result, fanoutMetaOf), [result]);
}

/** When the AI workload runs next and whether it is paused, for the notice before the first answers. */
export function useOverviewSchedule(project: ProjectRef): Read<OverviewSchedule> {
  const read = useRead(useQuery(overviewSchedulesQuery(project)));
  return useMemo(() => mapRead(read, scheduleOf), [read]);
}
