import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { DomainRole, EngineCode, SourceScope } from './types';

/**
 * The reads of the AI sources: domains, pages, the citation list, changes, diversity and the prompts that
 * cite no page of the project (19 section 3.7, docs/ai-visibility/contracts/sources-additions.md). Each is
 * `apiQuery` options, used as `useQuery({ ...query, placeholderData: keepPreviousData })`. Every key starts
 * with the project and `ai`, so `refreshPrompts` and `aiKey` reach them, and a value left out of the request
 * is left out of the key.
 */

const AI = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai';
const DOMAINS = `${AI}/sources/domains` as const;
const DOMAIN = `${AI}/sources/domains/{registrable_domain}` as const;
const PAGES = `${AI}/sources/pages` as const;
const CITATIONS = `${AI}/citations` as const;
const CHANGES = `${AI}/sources/changes` as const;
const DIVERSITY = `${AI}/sources/diversity` as const;
const PROMPTS = `${AI}/sources/prompts` as const;

/** What every source read shares. Roles narrow the rows of the routes that have them, never the totals. */
export interface SourceFilters {
  /** First and last day of the window, `YYYY-MM-DD` in the project's zone. */
  from: string;
  to: string;
  /** At most 3 engines; none means all. */
  engines?: readonly EngineCode[];
  /** One prompt's answers, whatever its state. */
  promptId?: string;
  /** The prompts given this term or one below it. */
  term?: string;
  roles?: readonly DomainRole[];
  includeBranded?: boolean;
  /** The prompts set in one market (two capitals); left out for every country. */
  country?: string;
  /** Count the citations flagged as an unresolved redirect, which every share and unit leaves out by default. */
  includeUnresolvedRedirects?: boolean;
  /** Count the citations flagged as engine-internal links, left out by default. */
  includeEngineInternal?: boolean;
}

/** The query values `SourceFilters` stand for. */
export interface ScopeParams {
  from: string;
  to: string;
  'filter[engine_code_in]'?: EngineCode[];
  'filter[prompt_id]'?: string;
  'filter[term]'?: string;
  'filter[domain_role_in]'?: DomainRole[];
  'filter[country_iso]'?: string;
  include_branded?: true;
}

/** The filters as query values; an empty list, a missing value and `includeBranded: false` are left out, as the URL leaves them out. */
export function filterParams(filters: SourceFilters): ScopeParams {
  const { engines = [], roles = [] } = filters;
  return {
    from: filters.from,
    to: filters.to,
    ...(engines.length === 0 ? {} : { 'filter[engine_code_in]': [...engines] }),
    ...(filters.promptId === undefined ? {} : { 'filter[prompt_id]': filters.promptId }),
    ...(filters.term === undefined ? {} : { 'filter[term]': filters.term }),
    ...(roles.length === 0 ? {} : { 'filter[domain_role_in]': [...roles] }),
    ...(filters.country === undefined ? {} : { 'filter[country_iso]': filters.country }),
    ...(filters.includeBranded === true ? { include_branded: true as const } : {}),
  };
}

/** The two flags as query values, left out when off. The citation list route takes neither (422), so it never spreads them. */
export function flagParams(filters: SourceFilters): {
  include_unresolved_redirects?: true;
  include_engine_internal?: true;
} {
  return {
    ...(filters.includeUnresolvedRedirects === true ? { include_unresolved_redirects: true as const } : {}),
    ...(filters.includeEngineInternal === true ? { include_engine_internal: true as const } : {}),
  };
}

const pathOf = (scope: SourceScope): { workspace_id: string; project_id: string } => ({
  workspace_id: scope.workspaceId,
  project_id: scope.projectId,
});

export type SourceSort = '-citation_units' | '-observations' | '-prompts';
const DEFAULT_SORT: SourceSort = '-citation_units';

/** The options of the two lists of rows (domains and pages). */
export interface SourceListOptions {
  limit?: number;
  offset?: number;
  sort?: SourceSort;
  /** The fewest citation units a row is listed for. Left out of the request when not set. */
  minSupport?: number;
  /** Ask for the `previous` block of each row and the previous window of `meta`. */
  compare?: boolean;
}

export type DomainInclude = 'series' | 'cited_with' | 'by_role_by_engine';

interface ListParams {
  limit?: number;
  offset?: number;
  sort?: SourceSort;
  min_support?: number;
  compare?: 'previous_period';
}

function listParams({ limit, offset, sort, minSupport, compare }: SourceListOptions): ListParams {
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined || offset === 0 ? {} : { offset }),
    ...(sort === undefined || sort === DEFAULT_SORT ? {} : { sort }),
    ...(minSupport === undefined ? {} : { min_support: minSupport }),
    ...(compare === true ? { compare: 'previous_period' as const } : {}),
  };
}

/** `GET {P}/ai/sources/domains`: cited domains with their units, share, engines and the blocks asked for in `include`. */
export const sourceDomainsQuery = (
  scope: SourceScope,
  filters: SourceFilters,
  { include = [], ...list }: SourceListOptions & { include?: readonly DomainInclude[] } = {},
): ApiQueryOptions<typeof DOMAINS> =>
  apiQuery(DOMAINS, {
    params: {
      path: pathOf(scope),
      query: {
        ...filterParams(filters),
        ...flagParams(filters),
        ...listParams(list),
        ...(include.length === 0 ? {} : { include: [...include] }),
      },
    },
  });

/**
 * `GET {P}/ai/sources/domains/{registrable_domain}`: one cited domain with its rows, its weekly units per engine,
 * its pages, prompts and the entities named with it. The name is read in lower case, as the API reads it. The
 * route takes the shared scope and the two flags, no role filter, sort or page.
 */
export const sourceDomainDetailQuery = (
  scope: SourceScope,
  registrableDomain: string,
  filters: SourceFilters,
): ApiQueryOptions<typeof DOMAIN> =>
  apiQuery(DOMAIN, {
    params: {
      path: { ...pathOf(scope), registrable_domain: registrableDomain.toLowerCase() },
      query: { ...filterParams({ ...filters, roles: [] }), ...flagParams(filters) },
    },
  });

/**
 * `GET {P}/ai/sources/pages`: cited pages, the pages of one domain with `registrableDomain`. The pages route has
 * no `cited_with` block (it answers 422 for it), so `include` takes `series` alone.
 */
export const sourcePagesQuery = (
  scope: SourceScope,
  filters: SourceFilters,
  {
    include = [],
    registrableDomain,
    ...list
  }: SourceListOptions & { include?: readonly 'series'[]; registrableDomain?: string } = {},
): ApiQueryOptions<typeof PAGES> =>
  apiQuery(PAGES, {
    params: {
      path: pathOf(scope),
      query: {
        ...filterParams(filters),
        ...flagParams(filters),
        ...listParams(list),
        ...(include.length === 0 ? {} : { include: [...include] }),
        ...(registrableDomain === undefined ? {} : { 'filter[registrable_domain]': registrableDomain }),
      },
    },
  });

/** `GET {P}/ai/sources/diversity`: per engine the distinct and the effective sources. It has no role filter. */
export const sourceDiversityQuery = (scope: SourceScope, filters: SourceFilters): ApiQueryOptions<typeof DIVERSITY> =>
  apiQuery(DIVERSITY, {
    params: { path: pathOf(scope), query: { ...filterParams({ ...filters, roles: [] }), ...flagParams(filters) } },
  });

/** `GET {P}/ai/sources/changes`: the domains that are new or lost against the window before. */
export const sourceChangesQuery = (
  scope: SourceScope,
  filters: SourceFilters,
  { kind, minSupport, limit, offset }: { kind: 'new' | 'lost'; minSupport?: number; limit?: number; offset?: number },
): ApiQueryOptions<typeof CHANGES> =>
  apiQuery(CHANGES, {
    params: {
      path: pathOf(scope),
      query: {
        ...filterParams(filters),
        ...flagParams(filters),
        kind,
        ...(minSupport === undefined ? {} : { min_support: minSupport }),
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined || offset === 0 ? {} : { offset }),
      },
    },
  });

/**
 * `GET {P}/ai/citations`: the first page of the citation list, newest answer first. It keeps the flagged citations
 * the aggregates leave out, so it takes no flag: the route answers 422 for both.
 */
export const citationListQuery = (
  scope: SourceScope,
  filters: SourceFilters,
  { limit }: { limit?: number } = {},
): ApiQueryOptions<typeof CITATIONS> =>
  apiQuery(CITATIONS, {
    params: { path: pathOf(scope), query: { ...filterParams(filters), ...(limit === undefined ? {} : { limit }) } },
  });

/** `GET {P}/ai/sources/prompts`: each prompt and engine pair with the own pages it cites; `ownCited: false` keeps the pairs that cite none. It has no role filter. */
export const sourcePromptsQuery = (
  scope: SourceScope,
  filters: SourceFilters,
  { ownCited, limit }: { ownCited?: boolean; limit?: number } = {},
): ApiQueryOptions<typeof PROMPTS> =>
  apiQuery(PROMPTS, {
    params: {
      path: pathOf(scope),
      query: {
        ...filterParams({ ...filters, roles: [] }),
        ...flagParams(filters),
        ...(ownCited === undefined ? {} : { 'filter[own_cited]': ownCited }),
        ...(limit === undefined ? {} : { limit }),
      },
    },
  });
