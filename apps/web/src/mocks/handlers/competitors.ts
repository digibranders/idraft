import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { answersWithCitations, scopeOf, termSubtree, type CitedAnswer } from './citations-model';
import { queryError } from './rules';
import {
  competitorRows,
  entityConfigOf,
  isSeriesMetric,
  metaOf,
  overviewRows,
  seriesOf,
  type Basis,
  type EntityConfig,
} from '../competitors-model';
import { isActiveRole } from '../entities-state';
import { ENGINE_CODES } from '../prompt-fixtures';
import { promptsOf } from '../prompts-state';
import { invalid, mock, requestIdOf } from '../respond';
import { shiftIsoDate } from '../serp-views';
import type { EngineCode, Problem, PromptsSummary, Schemas, SummaryEntity, ValidationItem } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';
import { REQUEST_ID_HEADER } from '@/lib/request-id';

/**
 * WP-39 (WP-35 reads it): the competitors reads, `GET ai/competitors` (c5), `GET overview/competitors` (c5) and the
 * entity series of `GET ai/metrics/{metric}/series` (c8). As in the API, each route reads the prompts summary once and
 * relabels its cells (the model is ../competitors-model.ts), so every figure equals the Topics and Prompts number.
 * The summary is read in process: an internal `fetch` of `GET ai/prompts-summary` for the same scope with the
 * request's cookies, which MSW answers with the summary handler (prompt-answers.ts), in the node server and in the
 * browser worker alike.
 *
 * The series route answers only `ai.share_of_voice` and `ai.mention_rate` with `entity_ids`; for any other request
 * it returns nothing, so the next handler (a later package's) answers.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const MAX_ENTITY_IDS = 20;
const MAX_ENGINES = 3;
const MAX_LOST_LIMIT = 10;
const MAX_SOURCES_LIMIT = 5;
const DEFAULT_LOST_LIMIT = 5;
const DEFAULT_SOURCES_LIMIT = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The seeded projects' entity set "changed" this many days before the project's today (c8 C-21): a boundary the AI
 * tab can draw. The entity fixtures share one day, so without it no boundary would exist before a competitor is added.
 */
const SEEDED_CHANGE_DAYS = 21;

/** The scope the summary takes, passed on to it as they came. */
const SCOPE_PARAMS = [
  'from',
  'to',
  'filter[engine_code_in]',
  'include_branded',
  'branded_only',
  'filter[country_iso]',
  'filter[term]',
] as const;
const COMPARE_PARAMS = ['compare', 'compare_from', 'compare_to'] as const;
const COMPETITORS_QUERY = [...SCOPE_PARAMS, ...COMPARE_PARAMS, 'entity_ids', 'include', 'lost_limit', 'sources_limit'];
const OVERVIEW_QUERY = [...SCOPE_PARAMS, ...COMPARE_PARAMS];
const SERIES_QUERY = [...SCOPE_PARAMS, 'entity_ids', 'granularity'];

/** A comma list or repeated parameters of the query, without the empty parts. */
const listOf = (url: URL, name: string): string[] =>
  url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');

const isEngine = (value: string): value is EngineCode => ENGINE_CODES.some((code) => code === value);

/** The engine filter, as c5 has it: at most 3, each one of the three (stricter than the summary, c8 C-23). */
function engineErrors(url: URL): ValidationItem[] {
  const name = 'filter[engine_code_in]';
  const values = listOf(url, name);
  return [
    ...(values.length > MAX_ENGINES
      ? [queryError(name, 'too_long', `List should have at most ${String(MAX_ENGINES)} items.`)]
      : []),
    ...values.flatMap((value, place) =>
      isEngine(value) ? [] : [queryError(`${name}.${String(place)}`, 'enum', `Allowed: ${ENGINE_CODES.join(', ')}.`)],
    ),
  ];
}

/** `entity_ids`: at most 20 UUIDs; `null` for none or an empty list (no narrowing). */
function entityIdsOf(url: URL, errors: ValidationItem[]): ReadonlySet<string> | null {
  const values = listOf(url, 'entity_ids');
  if (values.length > MAX_ENTITY_IDS) {
    errors.push(queryError('entity_ids', 'too_long', `List should have at most ${String(MAX_ENTITY_IDS)} items.`));
  }
  values.forEach((value, place) => {
    if (!UUID.test(value)) {
      errors.push(queryError(`entity_ids.${String(place)}`, 'uuid_parsing', 'Input should be a valid UUID'));
    }
  });
  return values.length === 0 ? null : new Set(values.map((value) => value.toLowerCase()));
}

/** A whole number from 1 to `max`, `fallback` when left out. */
function limitOf(url: URL, name: string, max: number, fallback: number, errors: ValidationItem[]): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value)) {
    errors.push(
      queryError(name, 'int_parsing', 'Input should be a valid integer, unable to parse string as an integer'),
    );
  } else if (value < 1) {
    errors.push(queryError(name, 'greater_than_equal', 'Input should be greater than or equal to 1'));
  } else if (value > max) {
    errors.push(queryError(name, 'less_than_equal', `Input should be less than or equal to ${String(max)}`));
  } else {
    return value;
  }
  return fallback;
}

/** `include` of `ai/competitors`: `lost_prompts` and `top_sources`; any other value is a `literal_error`. */
function includeOf(url: URL, errors: ValidationItem[]): { lost: boolean; sources: boolean } {
  const values = listOf(url, 'include');
  values.forEach((value, place) => {
    if (value !== 'lost_prompts' && value !== 'top_sources') {
      errors.push(
        queryError(`include.${String(place)}`, 'literal_error', "Input should be 'lost_prompts' or 'top_sources'"),
      );
    }
  });
  return { lost: values.includes('lost_prompts'), sources: values.includes('top_sources') };
}

// The summary, read in process

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isProblem = (value: unknown): value is Problem =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  typeof value.title === 'string' &&
  typeof value.type === 'string' &&
  typeof value.status === 'number' &&
  typeof value.instance === 'string' &&
  typeof value.request_id === 'string';

const isSummary = (value: unknown): value is PromptsSummary =>
  isRecord(value) &&
  Array.isArray(value.engine_codes) &&
  Array.isArray(value.entities) &&
  Array.isArray(value.entity_config_versions) &&
  isRecord(value.window);

/**
 * The summary for the scope of this request, with the blocks `include` names and no prompt or topic rows, or the
 * summary's own refusal (a scope it does not accept is refused as it refuses it).
 */
async function readSummary(
  request: Request,
  url: URL,
  include: string,
  withCompare: boolean,
): Promise<PromptsSummary | HttpResponse<Problem>> {
  const nested = new URL(
    url.pathname.replace(
      /\/(ai\/competitors|overview\/competitors|ai\/metrics\/[^/]+\/series)$/,
      '/ai/prompts-summary',
    ),
    url.origin,
  );
  for (const name of withCompare ? [...SCOPE_PARAMS, ...COMPARE_PARAMS] : SCOPE_PARAMS) {
    for (const value of url.searchParams.getAll(name)) nested.searchParams.append(name, value);
  }
  nested.searchParams.set('include', include);
  nested.searchParams.set('rows', 'none');
  const cookie = request.headers.get('cookie');
  const response = await fetch(nested, {
    headers: { ...(cookie === null ? {} : { cookie }), [REQUEST_ID_HEADER]: requestIdOf(request) },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    if (!isProblem(body)) throw new Error(`The summary read answered ${String(response.status)} without a problem`);
    return HttpResponse.json(
      { ...body, instance: new URL(request.url).pathname },
      {
        status: response.status,
        headers: { 'content-type': 'application/problem+json', [REQUEST_ID_HEADER]: body.request_id },
      },
    );
  }
  if (!isRecord(body) || !isSummary(body.data)) throw new Error('The summary read answered with no summary');
  return body.data;
}

// The scope's world

const basisOf = (summary: PromptsSummary, url: URL): Basis => ({
  window: summary.window,
  filters: {
    include_branded: summary.include_branded,
    branded_only: summary.branded_only,
    country_iso: url.searchParams.get('filter[country_iso]'),
    term_id: url.searchParams.get('filter[term]'),
  },
});

/** The entity reference of each tracked entity: the live role and the colour of the project's role. */
function refsOf(caller: ProjectCaller, tracked: readonly SummaryEntity[]): Map<string, Schemas['EntityRef']> {
  return new Map(
    tracked.map((entity): [string, Schemas['EntityRef']] => {
      const stored = caller.world.entities.find((candidate) => candidate.entity_id === entity.entity_id);
      const role = caller.world.roles.find(
        (candidate) =>
          candidate.project_id === caller.project.project_id &&
          candidate.entity_id === entity.entity_id &&
          isActiveRole(candidate),
      );
      return [
        entity.entity_id,
        {
          entity_id: entity.entity_id,
          canonical_name: entity.name,
          entity_type: stored?.entity_type ?? 'brand',
          role: entity.role,
          color_index: role?.color_index ?? null,
        },
      ];
    }),
  );
}

/** The answers of the summary's scope, valid or not: the prompts, window and engines the summary counted over. */
function answersOf(caller: ProjectCaller, summary: PromptsSummary, url: URL, now: number): CitedAnswer[] {
  const projectId = caller.project.project_id;
  const engines = summary.engine_codes.filter(isEngine);
  if (engines.length === 0) return [];
  const termFilter = url.searchParams.get('filter[term]');
  const stored = promptsOf(projectId).prompts;
  const scope = scopeOf({
    now,
    timezone: caller.project.timezone,
    from: summary.window.from,
    to: summary.window.to,
    engines,
    prompts: summary.branded_only ? stored.filter((prompt) => prompt.is_branded) : stored,
    promptId: null,
    termIds: termFilter === null ? null : termSubtree(caller.world.terms, termFilter),
    country: url.searchParams.get('filter[country_iso]'),
    roles: [],
    includeBranded: summary.include_branded,
    includeUnresolvedRedirects: false,
    includeEngineInternal: false,
  });
  return answersWithCitations(projectId, now).filter(
    (answer) =>
      answer.at >= scope.window.since &&
      answer.at < scope.window.until &&
      scope.engines.includes(answer.engine) &&
      scope.promptIds.has(answer.promptId),
  );
}

/**
 * The entity configuration the window holds. The fixtures were all derived under the first configuration, so this is
 * made here: version 1 from the project's first answer day, a version from the day each competitor was added in this
 * browser (the Add dialog), and the seeded boundary SEEDED_CHANGE_DAYS before today for a project that has a tracked
 * competitor, so the AI tab has one to draw.
 */
function configOf(caller: ProjectCaller, summary: PromptsSummary, now: number): EntityConfig {
  // The summary says no version when nothing was counted in the window
  if (summary.entity_config_versions.length === 0) return { versions: [], changes: null };
  const projectId = caller.project.project_id;
  const zone = caller.project.timezone;
  const oldest = answersWithCitations(projectId, now).at(-1);
  const added = caller.world.roles
    .filter(
      (role) =>
        role.project_id === projectId && isActiveRole(role) && role.role === 'competitor' && role.track_ai !== false,
    )
    .map((role) => formatIsoDate(role.added_at, zone));
  const today = formatIsoDate(new Date(now).toISOString(), zone);
  return entityConfigOf({
    window: summary.window,
    first: oldest === undefined ? null : formatIsoDate(new Date(oldest.at).toISOString(), zone),
    boundaries: added.length === 0 ? added : [...added, shiftIsoDate(today, -SEEDED_CHANGE_DAYS)],
  });
}

export const competitorHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/competitors`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: COMPETITORS_QUERY,
    });
    if (caller instanceof Response) return caller;
    const errors = engineErrors(caller.url);
    const entityIds = entityIdsOf(caller.url, errors);
    const include = includeOf(caller.url, errors);
    const lost = limitOf(caller.url, 'lost_limit', MAX_LOST_LIMIT, DEFAULT_LOST_LIMIT, errors);
    const sources = limitOf(caller.url, 'sources_limit', MAX_SOURCES_LIMIT, DEFAULT_SOURCES_LIMIT, errors);
    if (errors.length > 0) return invalid(request, errors);
    const summary = await readSummary(request, caller.url, 'total,entities', true);
    if (summary instanceof Response) return summary;
    const now = Date.now();
    const prompts = new Map(
      promptsOf(caller.project.project_id).prompts.map((prompt) => [
        prompt.prompt_id,
        { text: prompt.text, importance: prompt.importance },
      ]),
    );
    return HttpResponse.json({
      data: competitorRows({
        summary,
        basis: basisOf(summary, caller.url),
        refs: refsOf(caller, summary.entities),
        answers: answersOf(caller, summary, caller.url, now),
        prompts,
        entityIds,
        lost: include.lost ? lost : null,
        sources: include.sources ? sources : null,
      }),
      meta: metaOf(summary, configOf(caller, summary, now)),
    });
  }),

  mock('get', `${P}/overview/competitors`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: OVERVIEW_QUERY,
    });
    if (caller instanceof Response) return caller;
    const errors = engineErrors(caller.url);
    if (errors.length > 0) return invalid(request, errors);
    const summary = await readSummary(request, caller.url, 'total,entities', true);
    if (summary instanceof Response) return summary;
    return HttpResponse.json({
      data: { rows: overviewRows(summary, basisOf(summary, caller.url), refsOf(caller, summary.entities)) },
      meta: metaOf(summary, configOf(caller, summary, Date.now())),
    });
  }),

  mock('get', `${P}/ai/metrics/{metric}/series`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: SERIES_QUERY,
    });
    if (caller instanceof Response) return caller;
    const metric = String(params.metric);
    const errors = engineErrors(caller.url);
    const entityIds = entityIdsOf(caller.url, errors);
    if (!isSeriesMetric(metric)) {
      // `entity_ids` only fits the two keys this route serves; anything else is a later package's
      return entityIds === null
        ? undefined
        : invalid(request, [queryError('entity_ids', 'not_supported', `entity_ids is not supported for ${metric}.`)]);
    }
    if (entityIds === null) return undefined;
    const granularity = caller.url.searchParams.get('granularity');
    if (granularity === 'day' || granularity === 'month') {
      errors.push(queryError('granularity', 'not_built', `Not built yet: granularity ${granularity}.`));
    } else if (granularity !== null && granularity !== 'week') {
      errors.push(queryError('granularity', 'literal_error', "Input should be 'week'"));
    }
    if (errors.length > 0) return invalid(request, errors);
    const summary = await readSummary(request, caller.url, 'total,series,entities', false);
    if (summary instanceof Response) return summary;
    const now = Date.now();
    const today = formatIsoDate(new Date(now).toISOString(), caller.project.timezone);
    return HttpResponse.json({
      data: seriesOf(summary, basisOf(summary, caller.url), metric, entityIds, today),
      meta: metaOf(summary, configOf(caller, summary, now)),
    });
  }),
];
