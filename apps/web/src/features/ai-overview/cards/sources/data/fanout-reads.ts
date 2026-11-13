'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { sourceFilters, sourcesAskable, type SourcesAskable } from './source-filters';
import { askedEngines } from '../../../data/overview-queries';
import { useRead, type Gate, type Read } from '../../../data/read-state';
import { useOverview } from '../../../overview-context';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { EngineCode, ProjectEngine, Schemas } from '@/lib/api/types';

/**
 * The query rows of the fan-out card (WP-37 plan section 3). The Overview hook `useOverviewFanout` reads one row for
 * its `meta`; the rows of the card are read here, with the same scope rules, so the answers the card counts are the
 * answers the strip counts. Nothing here calls the API outside `apiQuery`, and two cards with equal options are one
 * request.
 */

const FANOUT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/fanout-queries' as const;

/** Queries issued by fewer answers than this are not listed; asked of the route, whose own default is the same. */
export const MIN_QUERY_ANSWERS = 2;

/** `no_fanout`: the engines asked are on, and none of them shows the queries it issues. */
export type FanoutAskable = SourcesAskable | 'no_fanout';

export interface FanoutRows {
  current: Read<Schemas['FanoutQueryPage']>;
  /** Why nothing is read, when nothing is: the card says so and does not wait. */
  askable: FanoutAskable;
  /** The engines asked that do not show their queries: not exposed, never zero. */
  without: readonly EngineCode[];
}

export interface FanoutOptions {
  /** The rows asked for. */
  limit: number;
}

const exposesFanout = (engines: readonly ProjectEngine[], code: EngineCode): boolean =>
  engines.some((entry) => entry.engine.engine_code === code && entry.engine.exposes_fanout);

/**
 * The request of the rows. The engine filter is left out when every enabled engine that shows its queries is asked
 * (leaving it out is what asking all of them means), and never names an engine that shows none: the route answers
 * `422 engine_has_no_fanout` to that.
 */
function fanoutRowsQuery(
  project: { workspaceId: string; projectId: string },
  filters: ReturnType<typeof sourceFilters>,
  limit: number,
): ApiQueryOptions<typeof FANOUT> {
  return apiQuery(FANOUT, {
    params: {
      path: { workspace_id: project.workspaceId, project_id: project.projectId },
      query: {
        from: filters.from,
        to: filters.to,
        include_branded: filters.includeBranded === true,
        limit,
        min_support: MIN_QUERY_ANSWERS,
        ...(filters.engines === undefined || filters.engines.length === 0
          ? {}
          : { 'filter[engine_code_in]': [...filters.engines] }),
        ...(filters.term === undefined ? {} : { 'filter[term]': filters.term }),
        ...(filters.country === undefined ? {} : { 'filter[country_iso]': filters.country }),
      },
    },
  });
}

/** The queries answers issued, most answers first, over the scope of the Overview. */
export function useFanoutRows({ limit }: FanoutOptions): FanoutRows {
  const { workspaceId, project, scope, enabledEngines, engines } = useOverview();
  // The Overview read hooks do not take `subscribed` yet (WP-33): pass `live` here when they do
  const known = engines.data !== undefined;
  const entries = useMemo(() => engines.data ?? [], [engines.data]);
  const asked = useMemo(() => askedEngines({ scope, enabledEngines }), [scope, enabledEngines]);
  const showing = useMemo(() => asked.filter((code) => exposesFanout(entries, code)), [asked, entries]);
  const without = useMemo(() => asked.filter((code) => !showing.includes(code)), [asked, showing]);
  const enabledShowing = useMemo(
    () => enabledEngines.filter((code) => exposesFanout(entries, code)),
    [enabledEngines, entries],
  );
  const base = sourcesAskable({ scope, enabledEngines });
  const askable: FanoutAskable = base !== 'ok' ? base : known && showing.length === 0 ? 'no_fanout' : 'ok';
  const runs = askable === 'ok' && known;
  const filters = useMemo(() => sourceFilters({ scope, enabledEngines: enabledShowing }, []), [scope, enabledShowing]);
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  const query = useQuery({
    ...fanoutRowsQuery(ref, { ...filters, engines: showing.length === enabledShowing.length ? [] : showing }, limit),
    enabled: runs,
    placeholderData: keepPreviousData,
  });
  // The engines say which of them show their queries: until they are known there is nothing to ask yet
  const gate: Gate = runs ? 'run' : askable === 'ok' ? 'waiting' : 'idle';
  const current = useRead(query, gate);
  return useMemo(() => ({ current, askable, without }), [current, askable, without]);
}
