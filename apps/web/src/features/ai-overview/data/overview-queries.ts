import { isBeforeFirstDay } from '@/components/app/date-range/business-date';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';
import { brandedParams, type DateWindow, type OverviewScope } from '../scope/scope-model';

/**
 * The query factories of the AI visibility Overview (WP-33 plan section 3.3): the only place that knows the
 * parameter names of the reads it uses. The Prompts page has a summary factory of its own that a feature may not
 * import, so the same parameter names are written here; the hooks (./use-overview-reads.ts) are what cards use.
 *
 * Every key starts with the project and then `ai`, `engines` or `schedules`, as the Prompts page's do, so a
 * refresh of the prompts reaches these reads too, and two equal scopes share one entry.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const ENGINES = `${P}/engines` as const;
const SUMMARY = `${P}/ai/prompts-summary` as const;
const SOURCES = `${P}/ai/sources/domains` as const;
const FANOUT = `${P}/ai/fanout-queries` as const;
const SCHEDULES = `${P}/schedules` as const;

/** The AI schedules of a project are at most a few; a page of 10 holds them all. */
const SCHEDULES_PAGE = 10;

export interface ProjectRef {
  workspaceId: string;
  projectId: string;
}

/** What a read of the scope needs besides the scope: the engines the project has on. */
export interface ReadScope {
  scope: OverviewScope;
  enabledEngines: readonly EngineCode[];
}

const pathOf = (project: ProjectRef): { workspace_id: string; project_id: string } => ({
  workspace_id: project.workspaceId,
  project_id: project.projectId,
});

/**
 * The enabled engines inside the scope's choice, in the order of the project (the URL's order is not kept, so
 * equal choices are one read). `scope.engines` is `null` for every enabled engine and is not an `EngineCode`
 * list, so what is asked is taken from the enabled engines, which are typed.
 */
export function askedEngines({ scope, enabledEngines }: ReadScope): readonly EngineCode[] {
  const chosen = scope.engines;
  return chosen === null ? enabledEngines : enabledEngines.filter((code) => chosen.includes(code));
}

/** The engine filter of a read: none when every enabled engine is asked, which is what leaving it out means. */
function engineFilter(read: ReadScope): { 'filter[engine_code_in]'?: EngineCode[] } {
  const asked = askedEngines(read);
  return asked.length === read.enabledEngines.length ? {} : { 'filter[engine_code_in]': [...asked] };
}

function scopeFilters(scope: OverviewScope): { 'filter[country_iso]'?: string; 'filter[term]'?: string } {
  return {
    ...(scope.country === null ? {} : { 'filter[country_iso]': scope.country }),
    ...(scope.topic === null ? {} : { 'filter[term]': scope.topic }),
  };
}

/**
 * The previous window, when it is read and shown: the comparison is on and the window can be asked. `previous` is
 * computed even when the comparison is off, and for a window near the start of the calendar it reaches before the
 * year 2000, which the API and the date formatters refuse: that comparison is unavailable, never an error.
 */
export function comparisonWindow(scope: OverviewScope): DateWindow | null {
  return scope.compare && !isBeforeFirstDay(scope.previous.from) ? scope.previous : null;
}

/**
 * Whether the sources and fan-out reads can answer the branded choice. They have `include_branded` and no
 * `branded_only`, so "branded only" cannot be asked of them: those reads do not run for it, and the number says so.
 */
export const brandedAskable = (scope: OverviewScope): boolean => scope.branded !== 'only';

/** `GET {P}/engines`: the same request and key as `useLayoutCapabilities`, so the engines are read once. */
export const overviewEnginesQuery = (project: ProjectRef): ApiQueryOptions<typeof ENGINES> =>
  apiQuery(ENGINES, { params: { path: pathOf(project) } });

export interface SummaryOptions {
  /** The window of the scope (default) or the one just before it. */
  period?: 'current' | 'previous';
  /** Blocks to add: a point per week of the window, and a cell per tracked entity. */
  include?: readonly ('series' | 'entities')[];
  /** `topics` leaves the prompt rows out, `none` both row lists. Left out: every row. */
  rows?: 'topics' | 'none';
}

/** `GET {P}/ai/prompts-summary` for a window of the scope: Mentioned, Cited and the rest per prompt, topic and engine. */
export function overviewSummaryQuery(
  project: ProjectRef,
  read: ReadScope,
  { period = 'current', include = [], rows }: SummaryOptions = {},
): ApiQueryOptions<typeof SUMMARY> {
  const { scope } = read;
  const window = period === 'previous' ? scope.previous : scope.range;
  return apiQuery(SUMMARY, {
    params: {
      path: pathOf(project),
      query: {
        from: window.from,
        to: window.to,
        ...brandedParams(scope.branded),
        ...engineFilter(read),
        ...scopeFilters(scope),
        ...(include.length === 0 ? {} : { include: [...include].sort() }),
        ...(rows === undefined ? {} : { rows }),
      },
    },
  });
}

export interface SourcesOptions {
  /** Blocks of `meta` to add; the roles per engine by default, which the own citation share of each engine reads. */
  include?: readonly ('series' | 'by_role_by_engine')[];
}

/**
 * `GET {P}/ai/sources/domains` for one row, so that the answer is its `meta`: the citation units by role (own over
 * all), per engine, and the window before while the comparison is on.
 */
export function overviewSourcesQuery(
  project: ProjectRef,
  read: ReadScope,
  { include = ['by_role_by_engine'] }: SourcesOptions = {},
): ApiQueryOptions<typeof SOURCES> {
  const { scope } = read;
  return apiQuery(SOURCES, {
    params: {
      path: pathOf(project),
      query: {
        from: scope.range.from,
        to: scope.range.to,
        include_branded: scope.branded !== 'excluded',
        limit: 1,
        ...engineFilter(read),
        ...scopeFilters(scope),
        ...(comparisonWindow(scope) === null ? {} : { compare: 'previous_period' as const }),
        ...(include.length === 0 ? {} : { include: [...include].sort() }),
      },
    },
  });
}

/**
 * `GET {P}/ai/fanout-queries` for one row, so that the answer is its `meta`: the answers and those that issued a
 * query. `read.enabledEngines` are the engines that show their fan-out (naming another is `422
 * engine_has_no_fanout`): the hook passes those, not every engine the project has on.
 */
export function overviewFanoutQuery(project: ProjectRef, read: ReadScope): ApiQueryOptions<typeof FANOUT> {
  const { scope } = read;
  return apiQuery(FANOUT, {
    params: {
      path: pathOf(project),
      query: {
        from: scope.range.from,
        to: scope.range.to,
        include_branded: scope.branded !== 'excluded',
        limit: 1,
        ...engineFilter(read),
        ...scopeFilters(scope),
      },
    },
  });
}

/** `GET {P}/schedules` of the AI workload, paused ones too: whether the runs are paused is read from them. */
export const overviewSchedulesQuery = (project: ProjectRef): ApiQueryOptions<typeof SCHEDULES> =>
  apiQuery(SCHEDULES, {
    params: { path: pathOf(project), query: { 'filter[workload]': 'ai_prompt', limit: SCHEDULES_PAGE } },
  });
