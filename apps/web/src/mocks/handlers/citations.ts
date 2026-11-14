import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import {
  aggregateDomains,
  aggregatePages,
  answersWithCitations,
  changesOf,
  citationRowsOf,
  diversityOf,
  metaOf,
  ownPagesOf,
  ROLES,
  scopeOf,
  termSubtree,
  type CitedAnswer,
  type DomainRole,
  type SourceScope,
  type SourceSort,
} from './citations-model';
import {
  booleanQuery,
  cursorPage,
  offsetPageOf,
  offsetPaging,
  pageRequest,
  queryError,
  unknownQuery,
  uuidError,
} from './rules';
import { ENGINE_CODES } from '../prompt-fixtures';
import { promptsOf } from '../prompts-state';
import { invalid, mock, problem } from '../respond';
import { shiftIsoDate, validateDateWindow } from '../serp-views';
import type { Problem, ValidationItem } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * WP-21: the citation reads the Citations page and the prompt inspector's tab use: `ai/sources/domains`,
 * `ai/sources/pages`, `ai/citations`, `ai/sources/changes`, `ai/sources/diversity` and `ai/sources/prompts`
 * (contracts/sources-additions.md; backend `api/ai/source_routes.py`). The arithmetic is ./citations-model.ts;
 * this file checks the request as the API does, in its order (401, 404, 403, 422) and pages the answer.
 * `ai/sources/domains/{registrable_domain}` is WP-22's (./citation-details.ts).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const DEFAULT_DAYS = 28;
const MAX_DAYS = 92;
const MAX_ENGINES = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A market: two capital letters. */
const COUNTRY = /^[A-Z]{2}$/;
const SORTS: readonly SourceSort[] = ['-citation_units', '-observations', '-prompts'];
const KINDS: readonly ('new' | 'lost')[] = ['new', 'lost'];
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;

/** The query parameters of the shared scope, and the ones some routes add. */
export const SCOPE = [
  'from',
  'to',
  'filter[engine_code_in]',
  'filter[prompt_id]',
  'filter[term]',
  'include_branded',
  'filter[country_iso]',
];
const ROLE_FILTER = ['filter[domain_role_in]'];
export const FLAGS = ['include_unresolved_redirects', 'include_engine_internal'];
const OFFSET_PAGE = ['offset', 'limit'];
const CURSOR_PAGE = ['cursor', 'limit'];

type PathValue = string | readonly string[] | undefined;
type PathParams = Readonly<Partial<Record<'workspace_id' | 'project_id', PathValue>>>;

/** A comma list or repeated parameters, at most `max` of them, each one of `allowed`; the errors go to `errors`. */
function listOf<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
  max: number,
  errors: ValidationItem[],
): T[] {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  if (values.length > max) errors.push(queryError(name, 'too_long', `List should have at most ${String(max)} items.`));
  const known = (value: string): value is T => allowed.some((option) => option === value);
  values.forEach((value, place) => {
    if (!known(value)) errors.push(queryError(`${name}.${String(place)}`, 'enum', `Allowed: ${allowed.join(', ')}.`));
  });
  return values.filter(known);
}

/** A whole number within `min` and `max`, `null` when the parameter is left out or wrong (the error goes to `errors`). */
function integerQuery(url: URL, name: string, min: number, max: number, errors: ValidationItem[]): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value)) {
    errors.push(
      queryError(name, 'int_parsing', 'Input should be a valid integer, unable to parse string as an integer'),
    );
  } else if (value < min) {
    errors.push(queryError(name, 'greater_than_equal', `Input should be greater than or equal to ${String(min)}`));
  } else if (value > max) {
    errors.push(queryError(name, 'less_than_equal', `Input should be less than or equal to ${String(max)}`));
  } else {
    return value;
  }
  return null;
}

/** A `true` or `false` parameter, its default when left out; the error goes to `errors`. */
function flagQuery(url: URL, name: string, errors: ValidationItem[]): boolean {
  const value = booleanQuery(url, name, false);
  if (typeof value === 'boolean') return value;
  errors.push(value);
  return false;
}

/** A text parameter of 1 to 253 characters, `null` when it is left out. */
function domainQuery(url: URL, errors: ValidationItem[]): string | null {
  const raw = url.searchParams.get('filter[registrable_domain]');
  if (raw === null) return null;
  if (raw.length < 1 || raw.length > 253) {
    errors.push(queryError('filter[registrable_domain]', 'string_length', 'Use 1 to 253 characters.'));
  }
  return raw;
}

/** The cursor's scope: every query parameter but the page's own. */
function cursorScope(url: URL): string {
  const scope = new URLSearchParams([...url.searchParams].filter(([name]) => name !== 'cursor' && name !== 'limit'));
  scope.sort();
  return scope.toString();
}

/** What a route reads from a request that passed every check, with the route's own parameters. */
export interface Read<T> {
  scope: SourceScope;
  answers: readonly CitedAnswer[];
  url: URL;
  own: T;
}

/**
 * The checks every route shares, in the API's order: `401`, `404` for a workspace or project the caller cannot see,
 * `403` without `data:read`, then `422`: a parameter the route does not have, a bad value (from here and from
 * `own`, the route's own parameters), `window_too_large`. The caller's allowed names are given to `projectCaller` as
 * the ones the request has, so that its own `422` for an unknown name does not come before the `404` and `403`.
 */
export function readOf<T>(
  request: Request,
  cookies: Readonly<Record<string, string>>,
  params: PathParams,
  allowed: readonly string[],
  { roles, flags }: { roles: boolean; flags: boolean },
  own: (url: URL, errors: ValidationItem[]) => T,
): Read<T> | HttpResponse<Problem> {
  const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
    permission: 'data:read',
    query: [...new Set(new URL(request.url).searchParams.keys())],
  });
  if (caller instanceof Response) return caller;
  const { url } = caller;
  const errors = unknownQuery(url, allowed);
  const now = Date.now();
  const zone = caller.project.timezone;
  const toParam = url.searchParams.get('to');
  const anchor =
    toParam !== null && ISO_DATE.test(toParam) ? toParam : formatIsoDate(new Date(now).toISOString(), zone);
  const window = validateDateWindow(
    url.searchParams.get('from') ?? shiftIsoDate(anchor, 1 - DEFAULT_DAYS),
    toParam,
    now,
    zone,
    MAX_DAYS,
  );
  if ('error' in window) errors.push(window.error);
  const engines = listOf(url, 'filter[engine_code_in]', ENGINE_CODES, MAX_ENGINES, errors);
  const promptId = url.searchParams.get('filter[prompt_id]');
  const termId = url.searchParams.get('filter[term]');
  const country = url.searchParams.get('filter[country_iso]');
  if (promptId !== null) {
    errors.push(
      ...uuidError(promptId, 'filter[prompt_id]').map((item) => queryError(item.path, item.code, item.message)),
    );
  }
  if (termId !== null) {
    errors.push(...uuidError(termId, 'filter[term]').map((item) => queryError(item.path, item.code, item.message)));
  }
  if (country !== null && !COUNTRY.test(country)) {
    errors.push(
      queryError('filter[country_iso]', 'string_pattern_mismatch', "String should match pattern '^[A-Z]{2}$'"),
    );
  }
  const includeBranded = flagQuery(url, 'include_branded', errors);
  const roleList: DomainRole[] = roles ? listOf(url, 'filter[domain_role_in]', ROLES, ROLES.length, errors) : [];
  const includeUnresolvedRedirects = flags && flagQuery(url, 'include_unresolved_redirects', errors);
  const includeEngineInternal = flags && flagQuery(url, 'include_engine_internal', errors);
  const parsed = own(url, errors);
  if (errors.length > 0 || 'error' in window || 'problem' in window) {
    return 'problem' in window && errors.length === 0
      ? problem(request, 'window_too_large', {
          detail: `A request covers at most ${String(MAX_DAYS)} days.`,
          limit_days: MAX_DAYS,
        })
      : invalid(request, errors);
  }
  const projectId = caller.project.project_id;
  return {
    scope: scopeOf({
      now,
      timezone: zone,
      from: window.range.firstDate,
      to: window.range.lastDate,
      engines,
      prompts: promptsOf(projectId).prompts,
      promptId,
      termIds: termId === null ? null : termSubtree(caller.world.terms, termId),
      country,
      roles: roleList,
      includeBranded,
      includeUnresolvedRedirects,
      includeEngineInternal,
    }),
    answers: answersWithCitations(projectId, now),
    url,
    own: parsed,
  };
}

/** `sort`, `compare`, `include`, `min_support` and the offset page of the domain and page lists. */
function listParams(
  url: URL,
  errors: ValidationItem[],
  includes: readonly ('series' | 'cited_with' | 'by_role_by_engine')[],
): {
  sort: SourceSort;
  compare: boolean;
  include: readonly string[];
  minSupport: number | null;
  paging: { offset: number; limit: number };
} {
  const [sort = '-citation_units'] = listOf(url, 'sort', SORTS, 1, errors);
  const [compare] = listOf(url, 'compare', ['none', 'previous_period'], 1, errors);
  const paging = offsetPaging(url);
  if (Array.isArray(paging)) errors.push(...paging);
  return {
    sort,
    compare: compare === 'previous_period',
    include: listOf(url, 'include', includes, includes.length, errors),
    minSupport: integerQuery(url, 'min_support', 1, 1000, errors),
    paging: Array.isArray(paging) ? { offset: 0, limit: 50 } : paging,
  };
}

/** `limit` and `cursor` of a keyset list. */
function cursorParams(url: URL, errors: ValidationItem[]): { limit: number; cursor: string | null } {
  const paging = pageRequest(url);
  if (Array.isArray(paging)) errors.push(...paging);
  return Array.isArray(paging) ? { limit: 50, cursor: null } : paging;
}

export const citationHandlers: HttpHandler[] = [
  mock('get', `${P}/ai/sources/domains`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [...SCOPE, ...ROLE_FILTER, ...FLAGS, ...OFFSET_PAGE, 'sort', 'compare', 'include', 'min_support'],
      { roles: true, flags: true },
      (url, errors) => listParams(url, errors, ['series', 'cited_with', 'by_role_by_engine']),
    );
    if (read instanceof Response) return read;
    const { scope, answers, own } = read;
    const rows = aggregateDomains(answers, scope, {
      sort: own.sort,
      minSupport: own.minSupport,
      series: own.include.includes('series'),
      citedWith: own.include.includes('cited_with'),
      compare: own.compare,
    });
    return HttpResponse.json({
      ...offsetPageOf(rows, own.paging),
      meta: metaOf(answers, scope, {
        series: own.include.includes('series'),
        byRoleByEngine: own.include.includes('by_role_by_engine'),
        compare: own.compare,
      }),
    });
  }),

  mock('get', `${P}/ai/sources/pages`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [
        ...SCOPE,
        ...ROLE_FILTER,
        ...FLAGS,
        ...OFFSET_PAGE,
        'filter[registrable_domain]',
        'sort',
        'compare',
        'include',
        'min_support',
      ],
      { roles: true, flags: true },
      (url, errors) => ({ ...listParams(url, errors, ['series']), domain: domainQuery(url, errors) }),
    );
    if (read instanceof Response) return read;
    const { scope, answers, own } = read;
    const rows = aggregatePages(answers, scope, {
      sort: own.sort,
      minSupport: own.minSupport,
      series: own.include.includes('series'),
      compare: own.compare,
      registrableDomain: own.domain,
    });
    return HttpResponse.json({
      ...offsetPageOf(rows, own.paging),
      meta: metaOf(answers, scope, { series: own.include.includes('series'), compare: own.compare }),
    });
  }),

  mock('get', `${P}/ai/citations`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [...SCOPE, ...ROLE_FILTER, ...CURSOR_PAGE, 'filter[registrable_domain]', 'filter[url_id]'],
      { roles: true, flags: false },
      (url, errors) => ({
        paging: cursorParams(url, errors),
        domain: domainQuery(url, errors),
        urlId: integerQuery(url, 'filter[url_id]', 1, MAX_INTEGER, errors),
      }),
    );
    if (read instanceof Response) return read;
    const { scope, answers, own, url } = read;
    const rows = citationRowsOf(answers, scope, { registrableDomain: own.domain, urlId: own.urlId });
    const page = cursorPage(rows, own.paging, cursorScope(url));
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('get', `${P}/ai/sources/changes`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [...SCOPE, ...ROLE_FILTER, ...FLAGS, ...OFFSET_PAGE, 'kind', 'min_support'],
      { roles: true, flags: true },
      (url, errors) => {
        const [kind = 'new'] = listOf(url, 'kind', KINDS, 1, errors);
        const paging = offsetPaging(url);
        if (Array.isArray(paging)) errors.push(...paging);
        return {
          kind,
          minSupport: integerQuery(url, 'min_support', 1, 1000, errors) ?? 2,
          paging: Array.isArray(paging) ? { offset: 0, limit: 50 } : paging,
        };
      },
    );
    if (read instanceof Response) return read;
    const { scope, answers, own } = read;
    const changes = changesOf(own.kind, answers, scope, own.minSupport);
    return HttpResponse.json({
      ...offsetPageOf(changes.rows, own.paging),
      meta: {
        window: changes.window,
        compare_window: changes.compareWindow,
        include_branded: scope.includeBranded,
        engine_codes: [...scope.engines],
        kind: own.kind,
        min_support: own.minSupport,
      },
    });
  }),

  mock('get', `${P}/ai/sources/diversity`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [...SCOPE, ...FLAGS, 'include'],
      { roles: false, flags: true },
      (url, errors) => listOf(url, 'include', ['series', 'ads'], 2, errors),
    );
    if (read instanceof Response) return read;
    // shortcut: `include=ads` is accepted and adds nothing, the mock world has no ads; build it when a screen reads it
    return HttpResponse.json(diversityOf(read.answers, read.scope, { series: read.own.includes('series') }));
  }),

  mock('get', `${P}/ai/sources/prompts`, ({ request, cookies, params }) => {
    const read = readOf(
      request,
      cookies,
      params,
      [...SCOPE, ...FLAGS, ...CURSOR_PAGE, 'filter[own_cited]'],
      { roles: false, flags: true },
      (url, errors) => ({
        paging: cursorParams(url, errors),
        ownCited: url.searchParams.has('filter[own_cited]') ? flagQuery(url, 'filter[own_cited]', errors) : null,
      }),
    );
    if (read instanceof Response) return read;
    const { scope, answers, own, url } = read;
    const page = cursorPage(ownPagesOf(answers, scope, own.ownCited), own.paging, cursorScope(url));
    return page === null
      ? problem(request, 'invalid_cursor')
      : HttpResponse.json({
          ...page,
          meta: {
            window: { from: scope.window.first, to: scope.window.last, timezone: scope.window.timezone },
            include_branded: scope.includeBranded,
            engine_codes: [...scope.engines],
          },
        });
  }),
];
