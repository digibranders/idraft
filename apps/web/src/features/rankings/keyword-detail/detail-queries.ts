import { infiniteQueryOptions } from '@tanstack/react-query';

import { apiWindow, type DetailWindow } from './detail-window';
import {
  effectiveCompetitorIds,
  keywordPath,
  rankHistoryQuery,
  type CompetitorOverride,
  type KeywordScope,
  type ProjectEntity,
} from '../keyword-inspector/inspector-queries';
import { api, unwrap } from '@/lib/api/client';
import { queryKey } from '@/lib/api/keys';
import { apiQuery, type ApiQueryOptions, type ApiResponse } from '@/lib/api/query';

const AIO_HISTORY =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/aio-history';

/**
 * What the keyword page reads beyond the keyword itself. The routes sit under the keyword's key, so a
 * finished Check now refreshes them with the list (`refreshKeywords`).
 */

/** The API takes at most 11 entities in one history: the own site and ten competitors. */
export const MAX_HISTORY_COMPETITORS = 10;

export interface ChartCompetitors {
  /** Every competitor the keyword has, by name: what the page can offer. */
  all: ProjectEntity[];
  /** The ones the history is asked for: the first ten by name. */
  asked: string[];
}

/** The keyword's effective competitors by name, and the ten the history is asked for. */
export function chartCompetitors(
  entities: readonly ProjectEntity[],
  overrides: readonly CompetitorOverride[],
): ChartCompetitors {
  const ids = effectiveCompetitorIds(entities, overrides);
  const all = entities
    .filter((entity) => ids.has(entity.entity.entity_id))
    .sort((a, b) => a.entity.canonical_name.localeCompare(b.entity.canonical_name));
  return { all, asked: all.slice(0, MAX_HISTORY_COMPETITORS).map((entity) => entity.entity.entity_id) };
}

/**
 * The history one window of the page draws: one request per window, with every competitor asked for and
 * the absolute rank and the events always included, so toggling a layer or choosing which competitors
 * to draw never reads again.
 */
export const pageRankHistoryQuery = (
  scope: KeywordScope,
  win: DetailWindow,
  competitorIds: readonly string[],
): ReturnType<typeof rankHistoryQuery> =>
  rankHistoryQuery(scope, {
    window: apiWindow(win),
    entityIds: ['own', ...competitorIds],
    include: ['absolute', 'events'],
  });

/**
 * The AI Overview checks of the keyword between two local days, both included (`windowDates`). The strip
 * counts them and the AI Overview history lists them: both ask with the same days, so it is one request.
 */
export const aioHistoryQuery = (
  scope: KeywordScope,
  days: { from: string; to: string },
): ApiQueryOptions<typeof AIO_HISTORY> =>
  apiQuery(AIO_HISTORY, { params: { path: keywordPath(scope), query: { from: days.from, to: days.to } } });

const SERP_CURRENT =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/serp-current';
const SERP_SNAPSHOTS =
  '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/{tracked_keyword_id}/serp-snapshots';
const SERP_SNAPSHOT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/serp-snapshots/{serp_snapshot_id}';

export type SnapshotPage = ApiResponse<'get', typeof SERP_SNAPSHOTS>;
export type SnapshotDetail = ApiResponse<'get', typeof SERP_SNAPSHOT>['data'];

/** Snapshots read per request: the picker offers the newest 50, and more on request. */
export const SNAPSHOT_PAGE_SIZE = 50;

/** The top 20 of the keyword's last check, with the own and competitor entities marked. */
export const serpCurrentQuery = (scope: KeywordScope): ApiQueryOptions<typeof SERP_CURRENT> =>
  apiQuery(SERP_CURRENT, { params: { path: keywordPath(scope) } });

/** The cursor of the first page: none. */
const FIRST_PAGE: string | null = null;

/**
 * The keyword's SERP snapshots, newest first, a page at a time. The key sits under the keyword's, so a
 * finished Check now reads the list again with the rest of the page.
 */
export const snapshotsQuery = (scope: KeywordScope) =>
  infiniteQueryOptions({
    queryKey: [...queryKey(SERP_SNAPSHOTS, keywordPath(scope), { limit: SNAPSHOT_PAGE_SIZE }), 'pages'],
    queryFn: ({ pageParam, signal }): Promise<SnapshotPage> =>
      unwrap(
        api.GET(SERP_SNAPSHOTS, {
          params: {
            path: keywordPath(scope),
            query: { limit: SNAPSHOT_PAGE_SIZE, ...(pageParam === null ? {} : { cursor: pageParam }) },
          },
          signal,
        }),
      ),
    initialPageParam: FIRST_PAGE,
    getNextPageParam: (last: SnapshotPage): string | null => (last.page.has_more ? last.page.next_cursor : null),
  });

/**
 * One snapshot with its titles. `observedAt` is the API's hint for the month the snapshot lives in: always
 * given when the snapshot's row is known. The API types the id in the path as a number; `obs` only ever
 * holds ids a number keeps exactly (`detail-url-state.ts`), and so do the ids of the list.
 */
export const snapshotQuery = (
  scope: KeywordScope,
  snapshotId: string,
  observedAt: string | null,
): ApiQueryOptions<typeof SERP_SNAPSHOT> =>
  apiQuery(SERP_SNAPSHOT, {
    params: {
      path: {
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        serp_snapshot_id: Number(snapshotId),
      },
      query: { include: ['titles'], ...(observedAt === null ? {} : { observed_at: observedAt }) },
    },
  });
