import type { FanoutEngine, FanoutFilters } from './types';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { SourceScope } from '@/lib/citations/types';

/**
 * The reads of the fan-out queries (docs/ai-visibility/contracts/sources-additions.md). Each is `apiQuery` options,
 * used as `useQuery({ ...query, placeholderData: keepPreviousData })`. Every key starts with the project and `ai`,
 * so `refreshPrompts` and `aiKey` reach them, and a value left out of the request is left out of the key.
 */

const FANOUT = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/fanout-queries' as const;
const ENGINES = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/engines' as const;

/** The fewest answers a query is listed for, when nothing else is chosen (the route's own default). */
export const DEFAULT_MIN_SUPPORT = 2;
/** The whole numbers the route takes for `min_support`. */
export const MIN_SUPPORT_RANGE = { min: 1, max: 1000 } as const;
/** The most rows one page holds (`422` above it). */
export const PAGE_MAX = 200;
/** The rows read of the period before the window, to tell the queries that are new in it. */
export const PREVIOUS_LIMIT = PAGE_MAX;

/** A read named an engine that does not show the queries it issues: the route answers `422 engine_has_no_fanout`. */
export class EngineNotExposedError extends Error {
  readonly engine: FanoutEngine['engine_code'];

  constructor(engine: FanoutEngine['engine_code']) {
    super(`${engine} does not expose fan-out, so no read may name it`);
    this.name = 'EngineNotExposedError';
    this.engine = engine;
  }
}

export interface FanoutReadOptions {
  /** The fewest answers a query is listed for. */
  minSupport: number;
  /** The rows asked for, at most `PAGE_MAX`. */
  limit: number;
  /** Rows to skip; 0 is not sent. */
  offset?: number;
  /** Ask for the topic terms of each row (`include=topics`). */
  topics?: boolean;
}

/**
 * `GET {P}/ai/fanout-queries`: the queries one engine issued, most answers first. The engine is always named, and
 * only an engine that exposes fan-out can be: this throws `EngineNotExposedError` for any other, so a screen that
 * forgets to filter the engines fails in its first test instead of at the server.
 */
export function fanoutQuery(
  scope: SourceScope,
  filters: FanoutFilters,
  { minSupport, limit, offset, topics }: FanoutReadOptions,
): ApiQueryOptions<typeof FANOUT> {
  if (!filters.engine.exposes_fanout) throw new EngineNotExposedError(filters.engine.engine_code);
  return apiQuery(FANOUT, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: {
        from: filters.from,
        to: filters.to,
        'filter[engine_code_in]': [filters.engine.engine_code],
        min_support: minSupport,
        limit,
        ...(offset === undefined || offset === 0 ? {} : { offset }),
        ...(topics === true ? { include: ['topics' as const] } : {}),
        ...(filters.promptId === undefined ? {} : { 'filter[prompt_id]': filters.promptId }),
        ...(filters.term === undefined ? {} : { 'filter[term]': filters.term }),
        ...(filters.country === undefined ? {} : { 'filter[country_iso]': filters.country }),
        ...(filters.includeBranded === true ? { include_branded: true } : {}),
      },
    },
  });
}

/** `GET {P}/engines`: the project's engines with `exposes_fanout`. The same key the Citations screen reads, so it is one request. */
export const projectEnginesQuery = (scope: SourceScope): ApiQueryOptions<typeof ENGINES> =>
  apiQuery(ENGINES, { params: { path: { workspace_id: scope.workspaceId, project_id: scope.projectId } } });
