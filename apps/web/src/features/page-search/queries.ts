'use client';

import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { BreakdownDimension, PeriodParams, SearchScope, TrackPagesAnswer } from './types';
import { api, unwrap } from '@/lib/api/client';
import { projectKey, type QueryKey } from '@/lib/api/keys';
import type { ApiProblem } from '@/lib/api/problem';
import { apiQuery } from '@/lib/api/query';

/**
 * The reads and writes of the page search detail and Monitoring (the backend OpenAPI, spec section 7). Every key
 * starts with the project, so `pageSearchKeys` reaches them after a write.
 *
 * The two live reads (`pageSearchQuery`, `breakdownQuery`) keep the app's retry rule (`lib/api/retry.ts`): a
 * `429 gsc_busy` is asked again once when it says to wait 10 seconds or less, and its `retry_after_seconds` is
 * what the panel shows with Retry otherwise.
 */

// Literal strings, so each path below keeps its literal type for the typed client
const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const TRACKED = `${P}/fp/tracked-pages` as const;
const TRACKED_IDS = `${P}/fp/tracked-pages/ids` as const;
const REMOVE = `${P}/fp/tracked-pages/remove` as const;
const SUGGESTIONS = `${P}/fp/tracked-pages/suggestions` as const;
const PAGE = `${P}/fp/page-search/{url_id}` as const;
const BREAKDOWN = `${P}/fp/page-search/{url_id}/breakdown` as const;

/** The most pages a project tracks, until the first answer says it. */
const DEFAULT_LIMIT = 200;
/** A final period does not change, so a page read is kept for five minutes. */
const FINAL_STALE_MS = 5 * 60_000;

const pathOf = (scope: SearchScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export const trackedPagesQuery = (scope: SearchScope, period: PeriodParams) =>
  apiQuery(TRACKED, { params: { path: pathOf(scope), query: period } });

export const trackedIdsQuery = (scope: SearchScope) => apiQuery(TRACKED_IDS, { params: { path: pathOf(scope) } });

export const suggestionsQuery = (scope: SearchScope) => apiQuery(SUGGESTIONS, { params: { path: pathOf(scope) } });

export const pageSearchQuery = (scope: SearchScope, urlId: string, period: PeriodParams) => ({
  ...apiQuery(PAGE, { params: { path: { ...pathOf(scope), url_id: urlId }, query: period } }),
  staleTime: FINAL_STALE_MS,
});

export const breakdownQuery = (
  scope: SearchScope,
  urlId: string,
  dimension: BreakdownDimension,
  period: PeriodParams,
) => ({
  ...apiQuery(BREAKDOWN, {
    params: { path: { ...pathOf(scope), url_id: urlId }, query: { ...period, dimension } },
  }),
  staleTime: FINAL_STALE_MS,
});

/** The key prefixes of every read above, for the invalidation after a write. */
export function pageSearchKeys(scope: SearchScope): QueryKey[] {
  const project = projectKey(scope.workspaceId, scope.projectId);
  return [
    [...project, 'fp', 'tracked-pages'],
    [...project, 'fp', 'page-search'],
  ];
}

/** Tracked ids as a set, for a Tracked column (All pages uses it). */
export function useTrackedIds(scope: SearchScope): { ids: ReadonlySet<string>; limit: number; ready: boolean } {
  const { data } = useQuery(trackedIdsQuery(scope));
  const ids = useMemo<ReadonlySet<string>>(() => new Set(data?.data), [data]);
  return { ids, limit: data?.meta.limit ?? DEFAULT_LIMIT, ready: data !== undefined };
}

export interface TrackPagesInput {
  urls?: string[];
  urlIds?: string[];
  /** Check every input without writing. */
  dryRun?: boolean;
}

/** Track pages by address or by url id; `dryRun` checks without writing. Refetches every read of the feature on success. */
export function useTrackPages(scope: SearchScope): UseMutationResult<TrackPagesAnswer, ApiProblem, TrackPagesInput> {
  const queryClient = useQueryClient();
  return useMutation<TrackPagesAnswer, ApiProblem, TrackPagesInput>({
    mutationFn: ({ urls, urlIds, dryRun = false }) =>
      unwrap(
        api.POST(TRACKED, {
          params: { path: pathOf(scope) },
          body: {
            dry_run: dryRun,
            ...(urls === undefined ? {} : { urls }),
            ...(urlIds === undefined ? {} : { url_ids: urlIds }),
          },
        }),
      ),
    // A dry run wrote nothing, so no read changed
    onSuccess: async (_answer, { dryRun }) => {
      if (dryRun === true) return;
      await Promise.all(pageSearchKeys(scope).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

/** Stop tracking pages (the numbers stored for them stay). Refetches every read of the feature on success. */
export function useUntrackPages(scope: SearchScope): UseMutationResult<{ removed: number }, ApiProblem, string[]> {
  const queryClient = useQueryClient();
  return useMutation<{ removed: number }, ApiProblem, string[]>({
    mutationFn: async (urlIds) =>
      (await unwrap(api.POST(REMOVE, { params: { path: pathOf(scope) }, body: { url_ids: urlIds } }))).data,
    onSuccess: async () => {
      await Promise.all(pageSearchKeys(scope).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
