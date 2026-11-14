import type { Branded, CompetitorsScope } from '../scope/scope-model';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';
import { compareParams } from '@/lib/compare/compare-model';
import { entitiesQuery as projectEntitiesQuery } from '@/lib/citations/entities-query';

/**
 * The query factories of the Competitors page (WP-39 plan section 3.3): the only place that knows the parameter
 * names of the reads it uses. Every key starts with the project and then `ai`, `engines` or `entities`, so a refresh
 * of the project's reads reaches them, and two equal scopes share one entry (the engines are sorted).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const COMPETITORS = `${P}/ai/competitors` as const;
const SUMMARY = `${P}/ai/prompts-summary` as const;
const SERIES = `${P}/ai/metrics/{metric}/series` as const;

/** The rows of `lost_prompts` asked per competitor and engine: the most the API gives. */
export const LOST_LIMIT = 10;
/** The domains of `top_sources` asked per entity: the most the API gives. */
export const SOURCES_LIMIT = 5;
/** The most entities one read names. */
export const MAX_ENTITY_IDS = 20;

export interface ProjectRef {
  workspaceId: string;
  projectId: string;
}

/** What a read needs of the page's scope: the window, the filters, and which engines are on and in scope. */
export interface ReadScope {
  range: { from: string; to: string };
  /** The engines in scope (`CompetitorsScope.engineScope`). */
  engineScope: readonly EngineCode[];
  /** The engines that are on. */
  enabledEngines: readonly EngineCode[];
  country: string | null;
  topic: string | null;
  branded: Branded;
  compare: boolean;
}

/** The scope the address holds, with the window and the engines that are on, as the reads take it. */
export const readScopeOf = (
  scope: CompetitorsScope,
  range: ReadScope['range'],
  enabledEngines: readonly EngineCode[],
): ReadScope => ({
  range,
  engineScope: scope.engineScope,
  enabledEngines,
  country: scope.country,
  topic: scope.topic,
  branded: scope.branded,
  compare: scope.compare,
});

const pathOf = (project: ProjectRef): { workspace_id: string; project_id: string } => ({
  workspace_id: project.workspaceId,
  project_id: project.projectId,
});

const sorted = <T extends string>(values: readonly T[]): T[] => [...values].sort();

/** The summary's branded parameters for a choice. `branded_only` counts branded prompts alone. */
function brandedParams(branded: Branded): { include_branded: boolean; branded_only?: true } {
  if (branded === 'only') return { include_branded: true, branded_only: true };
  return { include_branded: branded === 'included' };
}

/**
 * The engine filter of a read: the one engine of a single engine surface, always named (even when it is the only one
 * that is on); otherwise the engines in scope, and none when every engine that is on is asked, which is what leaving
 * it out means.
 */
function engineFilter(read: ReadScope, only?: EngineCode): { 'filter[engine_code_in]'?: EngineCode[] } {
  if (only !== undefined) return { 'filter[engine_code_in]': [only] };
  const asked = sorted(read.engineScope);
  return asked.length === read.enabledEngines.length ? {} : { 'filter[engine_code_in]': asked };
}

/** The filters every analytic read shares: the window, branded, the engines, the country and the topic. */
function sharedQuery(
  read: ReadScope,
  only?: EngineCode,
): {
  from: string;
  to: string;
  include_branded: boolean;
  branded_only?: true;
  'filter[engine_code_in]'?: EngineCode[];
  'filter[country_iso]'?: string;
  'filter[term]'?: string;
} {
  return {
    from: read.range.from,
    to: read.range.to,
    ...brandedParams(read.branded),
    ...engineFilter(read, only),
    ...(read.country === null ? {} : { 'filter[country_iso]': read.country }),
    ...(read.topic === null ? {} : { 'filter[term]': read.topic }),
  };
}

/** `GET {P}/engines`: the same request and key as the other pages', so the engines are read once. */
export const enginesQuery = (project: ProjectRef): ApiQueryOptions<typeof ENGINES> =>
  apiQuery(ENGINES, { params: { path: pathOf(project) } });

/** `GET {P}/entities`: the same request as the Entities page's (dates added, domains), so one cache entry. */
export const entitiesQuery = (project: ProjectRef): ReturnType<typeof projectEntitiesQuery> =>
  projectEntitiesQuery(project);

/**
 * R1, `GET {P}/ai/competitors`: the tracked set with its values per engine, and the previous period's while the
 * comparison is on. No `include` and no `entity_ids`: the channel summary, the top competitor, the chips and the AI
 * tab's entity list all read it.
 */
export const competitorsQuery = (project: ProjectRef, read: ReadScope): ApiQueryOptions<typeof COMPETITORS> =>
  apiQuery(COMPETITORS, {
    params: { path: pathOf(project), query: { ...sharedQuery(read), ...compareParams(read.compare) } },
  });

/**
 * R2, `GET {P}/ai/competitors` for the prompts we lose to each competitor on the one engine `eng`: `include=lost_prompts`
 * costs a statement, so only the section that shows them asks. Never compared.
 */
export const lostPromptsQuery = (
  project: ProjectRef,
  read: ReadScope,
  engine: EngineCode,
): ApiQueryOptions<typeof COMPETITORS> =>
  apiQuery(COMPETITORS, {
    params: {
      path: pathOf(project),
      query: { ...sharedQuery(read, engine), include: ['lost_prompts'], lost_limit: LOST_LIMIT },
    },
  });

/**
 * R3, `GET {P}/ai/prompts-summary` as topic rows with each tracked entity's cell, for the one engine `eng`: the by
 * topic table, the leader of each topic and the freshness of the header. The prompt rows are left out (`rows=topics`).
 */
export const topicRowsQuery = (
  project: ProjectRef,
  read: ReadScope,
  engine: EngineCode,
): ApiQueryOptions<typeof SUMMARY> =>
  apiQuery(SUMMARY, {
    params: {
      path: pathOf(project),
      query: { ...sharedQuery(read, engine), rows: 'topics', include: ['entities', 'total'] },
    },
  });

/**
 * R4, `GET {P}/ai/metrics/ai.share_of_voice/series`: one weekly series per listed entity and engine, for the AI
 * tab's charts. At most 20 entity ids, sorted so equal sets share a key.
 */
export const sovSeriesQuery = (
  project: ProjectRef,
  read: ReadScope,
  entityIds: readonly string[],
): ApiQueryOptions<typeof SERIES> =>
  apiQuery(SERIES, {
    params: {
      path: { ...pathOf(project), metric: 'ai.share_of_voice' },
      query: { ...sharedQuery(read), entity_ids: sorted(entityIds).slice(0, MAX_ENTITY_IDS) },
    },
  });

/** R6, `GET {P}/ai/competitors` with `include=top_sources` for the entities named: the inspector's Sources tab. */
export const sourcesQuery = (
  project: ProjectRef,
  read: ReadScope,
  entityIds: readonly string[],
): ApiQueryOptions<typeof COMPETITORS> =>
  apiQuery(COMPETITORS, {
    params: {
      path: pathOf(project),
      query: {
        ...sharedQuery(read),
        entity_ids: sorted(entityIds).slice(0, MAX_ENTITY_IDS),
        include: ['top_sources'],
        sources_limit: SOURCES_LIMIT,
      },
    },
  });
