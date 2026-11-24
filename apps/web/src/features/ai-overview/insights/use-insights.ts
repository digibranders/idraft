'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  citingCompetitorsCount,
  insightWindows,
  untrackedCount,
  type InsightCount,
  type InsightKey,
} from './insights-model';
import { mapRead, useRead, type Gate, type Read } from '../data/read-state';
import { useOverview } from '../overview-context';
import { apiQuery } from '@/lib/api/query';
import { gapsQuery } from '@/lib/citations/board-queries';
import { sourceChangesQuery, sourceDomainsQuery } from '@/lib/citations/source-queries';
import { projectEntitiesQuery } from '@/lib/entities/project-entities';
import { useZoneDay } from '@/lib/dom/use-zone-day';

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const KEYWORDS = `${P}/tracked-keywords` as const;
const PROMPTS = `${P}/prompts` as const;

/** The most rows one read asks for (the routes allow 200), which every count that reads rows is cut at. */
const PAGE = 200;
/** The Citations page opens with the first three tracked competitors (board-state D-7): the gap count is of those. */
const GAP_COMPETITORS = 3;
/** Runs the Citations page reads by default. */
const DEFAULT_RUNS = 4;
/** At least this many citation units for a "new" domain, as the route's own default. */
const NEW_MIN_SUPPORT = 2;

export type InsightReads = Readonly<Record<InsightKey, Read<InsightCount>>>;

const idle = <T>(): Read<T> => ({
  status: 'idle',
  data: undefined,
  errorId: null,
  stale: false,
  placeholder: false,
  refetch: () => undefined,
});

/**
 * The four lines of the Insights box, each its own read: one that fails or waits leaves the others alone. The box
 * counts the whole project (every enabled platform, every group, branded prompts as the pages count them), so the
 * Overview's scope does not change it. `idle` is a line that cannot be asked (no platform on, no tracked competitor).
 */
export function useInsights(): InsightReads {
  const { workspaceId, project, enabledEngines, engines: enginesRead } = useOverview();
  const today = useZoneDay(project.timeZone);
  const source = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const windows = useMemo(() => insightWindows(today), [today]);
  const engines = enabledEngines.slice(0, 3);
  const hasEngines = engines.length > 0;

  const entities = useQuery(projectEntitiesQuery(source));
  const competitorIds = useMemo(
    () =>
      (entities.data?.data ?? [])
        .filter((row) => row.removed_at === null && row.role === 'competitor')
        .map((row) => row.entity.entity_id),
    [entities.data],
  );
  // Until the platforms are known no line can be told to be idle: waiting keeps the box from saying "nothing to do"
  const engineGate: Gate = hasEngines ? 'run' : enginesRead.status === 'loading' ? 'waiting' : 'idle';
  const competitorGate: Gate =
    engineGate !== 'run'
      ? engineGate
      : entities.isPending
        ? 'waiting'
        : entities.isError
          ? 'run'
          : competitorIds.length === 0
            ? 'idle'
            : 'run';

  const keywords = useQuery({
    ...apiQuery(KEYWORDS, {
      params: {
        path: { workspace_id: workspaceId, project_id: project.id },
        query: { 'filter[aio_state]': ['present_not_cited', 'present_cited'], limit: PAGE },
      },
    }),
  });
  const prompts = useQuery({
    ...apiQuery(PROMPTS, {
      params: { path: { workspace_id: workspaceId, project_id: project.id }, query: { limit: PAGE } },
    }),
  });
  const gaps = useQuery({
    ...gapsQuery(source, { runs: DEFAULT_RUNS, engines, term: null }, competitorIds.slice(0, GAP_COMPETITORS)),
    enabled: hasEngines && competitorIds.length > 0,
  });
  const domains = useQuery({
    ...sourceDomainsQuery(
      source,
      { ...windows.recent, engines, roles: ['third_party'] },
      { include: ['cited_with'], limit: PAGE },
    ),
    enabled: hasEngines && competitorIds.length > 0,
  });
  const changes = useQuery({
    ...sourceChangesQuery(
      source,
      { ...windows.month, engines },
      { kind: 'new', minSupport: NEW_MIN_SUPPORT, limit: 1 },
    ),
    enabled: hasEngines,
  });

  const untrackedRead = useRead(
    {
      data:
        keywords.data !== undefined && prompts.data !== undefined
          ? { keywords: keywords.data, prompts: prompts.data }
          : undefined,
      error: keywords.error ?? prompts.error,
      isError: keywords.isError || prompts.isError,
      isFetching: keywords.isFetching || prompts.isFetching,
      refetch: () => Promise.all([keywords.refetch(), prompts.refetch()]),
    },
    'run',
  );
  const gapsRead = useRead(gaps, competitorGate);
  const domainsRead = useRead(domains, competitorGate);
  const changesRead = useRead(changes, engineGate);
  const idSet = useMemo(() => new Set(competitorIds), [competitorIds]);

  return useMemo(
    (): InsightReads => ({
      // A count that cannot be told (the prompts did not all load) is an idle line, not a zero
      untracked: ((): Read<InsightCount> => {
        const counted = mapRead(untrackedRead, ({ keywords: k, prompts: p }) =>
          untrackedCount(
            k.data.map((row) => row.keyword.text),
            p.data.map((row) => row.current_version.text),
            { moreKeywords: k.page.has_more, morePrompts: p.page.has_more },
          ),
        );
        return counted.data === null ? idle() : (counted as Read<InsightCount>);
      })(),
      gaps: mapRead(gapsRead, (data) => ({ count: data.meta.gaps, atLeast: false })),
      citingCompetitors: mapRead(domainsRead, (data) =>
        citingCompetitorsCount(data.data, idSet, data.page.total > data.data.length),
      ),
      // shortcut: `page.total` counts rows, one per domain and role, as `use-new-sources.ts` does
      newDomains: mapRead(changesRead, (data) => ({ count: data.page.total, atLeast: false })),
    }),
    [untrackedRead, gapsRead, domainsRead, changesRead, idSet],
  );
}
