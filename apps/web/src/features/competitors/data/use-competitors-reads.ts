'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  competitorsQuery,
  entitiesQuery,
  lostPromptsQuery,
  readScopeOf,
  sourcesQuery,
  sovSeriesQuery,
  topicRowsQuery,
  type ProjectRef,
} from './competitors-queries';
import { useRead, type Gate, type Read } from './read-state';
import type { CompetitorsScope } from '../scope/scope-model';
import type { ApiResponse } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';

/**
 * The reads of the Competitors page (WP-39 plan section 3.3), each asked only where a surface needs it: the sections
 * mount nothing, so the gates here are what keeps a tab's reads off the others. A scope change keeps the last data
 * (`keepPreviousData`) and the read says `refetching`. Reads that depend on the engines wait for them: with none
 * known an empty list would mean every engine, so nothing is asked.
 */

type Project = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export type CompetitorsRead = Read<ApiResponse<'get', `${Project}/ai/competitors`>>;
export type TopicRowsRead = Read<ApiResponse<'get', `${Project}/ai/prompts-summary`>>;
export type SeriesRead = Read<ApiResponse<'get', `${Project}/ai/metrics/{metric}/series`>>;
export type EntitiesRead = Read<ApiResponse<'get', `${Project}/entities`>>;

/** The competitor the inspector shows and the tab it is on, or `null` while it is closed. */
export interface InspectedCompetitor {
  id: string | null;
  tab: 'overview' | 'sources';
}

export interface CompetitorsReadsInput {
  project: ProjectRef;
  scope: CompetitorsScope;
  range: { from: string; to: string };
  /** The engines that are on. */
  enabledEngines: readonly EngineCode[];
  /** The engines have been read and at least one is on. */
  enginesReady: boolean;
  inspect: InspectedCompetitor | null;
}

export interface CompetitorsReads {
  /** R1: the tracked set with its values per engine, compared with the previous period unless `cmp=off`. */
  competitors: CompetitorsRead;
  /** R2: the prompts lost to each competitor on the engine `eng`. */
  lost: CompetitorsRead;
  /** R3: the topic rows of the engine `eng` with a cell per tracked entity, and the total's freshness. */
  topics: TopicRowsRead;
  /** R4: the weekly share of voice of every tracked entity on each engine in scope. */
  series: SeriesRead;
  /** R5: the project's entities with their added dates. */
  entities: EntitiesRead;
  /** R6: the inspected competitor's top sources, with the own entities' for the comparison. */
  sources: CompetitorsRead;
}

const NO_IDS: readonly string[] = [];

export function useCompetitorsReads({
  project,
  scope,
  range,
  enabledEngines,
  enginesReady,
  inspect,
}: CompetitorsReadsInput): CompetitorsReads {
  const read = useMemo(() => readScopeOf(scope, range, enabledEngines), [scope, range, enabledEngines]);
  const { tab, eng } = scope;
  const inspectedId = inspect?.id ?? null;
  const inspecting = inspectedId !== null;
  const waiting = !enginesReady;

  // R1 serves the Comparison and AI tabs and the inspector: one key, so one request
  const needsSet = tab === 'comparison' || tab === 'ai' || inspecting;
  const competitorsGate: Gate = waiting ? 'waiting' : needsSet ? 'run' : 'idle';
  const competitorsQ = useQuery({
    ...competitorsQuery(project, read),
    enabled: competitorsGate === 'run',
    placeholderData: keepPreviousData,
  });
  const competitors = useRead(competitorsQ, competitorsGate);

  // The one engine surfaces need an engine in scope
  const singleGate: Gate = waiting ? 'waiting' : tab === 'comparison' && eng !== null ? 'run' : 'idle';
  const lostQ = useQuery({
    ...lostPromptsQuery(project, read, eng ?? 'chatgpt_web'),
    enabled: singleGate === 'run',
    placeholderData: keepPreviousData,
  });
  const lost = useRead(lostQ, singleGate);
  const topicsQ = useQuery({
    ...topicRowsQuery(project, read, eng ?? 'chatgpt_web'),
    enabled: singleGate === 'run',
    placeholderData: keepPreviousData,
  });
  const topics = useRead(topicsQ, singleGate);

  // What a read of named entities waits for: the tracked set, which R1 reads
  const setFailed = competitors.status === 'error';
  const setWait = (needed: boolean): Gate => {
    if (!needed) return 'idle';
    if (waiting) return 'waiting';
    if (competitors.data !== undefined) return 'run';
    return setFailed ? 'idle' : 'waiting';
  };
  const entityIds = useMemo(
    () => (competitors.data === undefined ? NO_IDS : competitors.data.data.map((row) => row.entity.entity_id)),
    [competitors.data],
  );
  const seriesGate = setWait(tab === 'ai');
  const seriesQ = useQuery({
    ...sovSeriesQuery(project, read, entityIds),
    enabled: seriesGate === 'run',
    placeholderData: keepPreviousData,
  });
  const series = useRead(seriesQ, seriesGate);

  const ownIds = useMemo(
    () =>
      competitors.data === undefined
        ? NO_IDS
        : competitors.data.data.filter((row) => row.entity.role === 'own').map((row) => row.entity.entity_id),
    [competitors.data],
  );
  const sourceIds = useMemo(() => (inspectedId === null ? NO_IDS : [inspectedId, ...ownIds]), [inspectedId, ownIds]);
  const sourcesGate = setWait(inspect?.tab === 'sources' && inspecting);
  const sourcesQ = useQuery({
    ...sourcesQuery(project, read, sourceIds),
    enabled: sourcesGate === 'run',
    placeholderData: keepPreviousData,
  });
  const sources = useRead(sourcesQ, sourcesGate);

  // The dates of the entities do not depend on the engines
  const entitiesGate: Gate = tab === 'ai' || inspecting ? 'run' : 'idle';
  const entitiesQ = useQuery({ ...entitiesQuery(project), enabled: entitiesGate === 'run' });
  const entities = useRead(entitiesQ, entitiesGate);

  return { competitors, lost, topics, series, entities, sources };
}
