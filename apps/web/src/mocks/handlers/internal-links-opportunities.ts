import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller } from './access';
import { csv, isUrlId, urlIdError } from './internal-links';
import { enumQuery, isIssue, readRun, requireLinks } from './internal-links-run';
import { bodyError, extraMembers, isOneOf, isRecord, notAnObject, offsetPaging, queryError } from './rules';
import {
  acceptSuggestions,
  decideOpportunities,
  dismissSuggestions,
  opportunities,
  opportunitiesCsv,
  plannedFixesCsv,
  routesTo,
  tierSuggestions,
} from '../internal-links-opportunities-world';
import { runViewOf } from '../internal-links-world';
import { invalid, mock, problem } from '../respond';
import type { Problem, ValidationItem } from '@/lib/api/types';
import type { OpportunityPair, OpportunityStatus, SuggestionSelection } from '@/lib/internal-links/types';

/**
 * The opportunity, tier suggestion and path routes of the backend (`opportunity_routes.py`, `suggestion_routes.py`,
 * `path_routes.py`). Reads need `data:read`, decisions and the suggestion writes `projects:write`. The lists,
 * decisions and paths answer `410 links_dropped` for a crawl without its links; the suggestions read the latest
 * crawl only.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const STATUSES: readonly OpportunityStatus[] = ['open', 'accepted', 'dismissed'];
const FORMATS = ['json', 'csv'] as const;
const EXPORTS = ['planned'] as const;
const TIER = /^([1-8]|none)$/;
const Q_MAX = 200;
const ITEMS_MAX = 500;

/** The latest finished crawl of the project, or the `404 no_crawl` to answer. */
function latestRun(request: Request, projectId: string): NonNullable<ReturnType<typeof runViewOf>> | Response {
  return runViewOf(projectId, null) ?? problem(request, 'no_crawl');
}

/** The filters of the opportunity list, or their errors. */
function listFilters(url: URL): { tier: string | null; q: string | null } | ValidationItem[] {
  const tier = url.searchParams.get('filter[target_tier]');
  const q = url.searchParams.get('q');
  const errors: ValidationItem[] = [];
  if (tier !== null && !TIER.test(tier)) {
    errors.push(
      queryError('filter[target_tier]', 'string_pattern_mismatch', 'Use a tier position from 1 to 8, or none.'),
    );
  }
  if (q !== null && (q.length < 1 || q.length > Q_MAX)) {
    errors.push(queryError('q', 'string_too_long', `Use 1 to ${String(Q_MAX)} characters.`));
  }
  return errors.length > 0 ? errors : { tier, q };
}

/** The pairs of a decision body, or their errors. */
function pairsOf(items: unknown): { pairs: OpportunityPair[]; errors: ValidationItem[] } {
  if (items === undefined) return { pairs: [], errors: [bodyError('items', 'missing', 'Field required')] };
  if (!Array.isArray(items))
    return { pairs: [], errors: [bodyError('items', 'list_type', 'Input should be a valid list')] };
  if (items.length < 1 || items.length > ITEMS_MAX) {
    const code = items.length < 1 ? 'too_short' : 'too_long';
    return { pairs: [], errors: [bodyError('items', code, `Give 1 to ${String(ITEMS_MAX)} pairs.`)] };
  }
  const errors: ValidationItem[] = [];
  const pairs: OpportunityPair[] = [];
  items.forEach((item: unknown, index) => {
    if (!isRecord(item)) {
      errors.push(notAnObject(`items.${String(index)}`));
      return;
    }
    const { source_url_id: source, target_url_id: target } = item;
    errors.push(...extraMembers(item, ['source_url_id', 'target_url_id'], `items.${String(index)}`));
    for (const [name, value] of [
      ['source_url_id', source],
      ['target_url_id', target],
    ] as const) {
      if (typeof value !== 'string' || !isUrlId(value)) {
        errors.push({ ...urlIdError('body', `items.${String(index)}.${name}`) });
      }
    }
    if (typeof source === 'string' && typeof target === 'string')
      pairs.push({ source_url_id: source, target_url_id: target });
  });
  return { pairs, errors };
}

/** A suggestion body (`url_ids` or `all`, not both and not neither), or its errors. */
function selectionOf(body: unknown): SuggestionSelection | ValidationItem[] {
  if (!isRecord(body)) return [notAnObject()];
  const errors = extraMembers(body, ['url_ids', 'all']);
  const ids = body.url_ids ?? null;
  const all = body.all ?? null;
  if (ids !== null) {
    if (!Array.isArray(ids)) errors.push(bodyError('url_ids', 'list_type', 'Input should be a valid list'));
    else if (ids.length < 1 || ids.length > ITEMS_MAX) {
      errors.push(
        bodyError('url_ids', ids.length < 1 ? 'too_short' : 'too_long', `Give 1 to ${String(ITEMS_MAX)} ids.`),
      );
    } else {
      ids.forEach((id: unknown, index) => {
        if (typeof id !== 'string' || !isUrlId(id)) errors.push({ ...urlIdError('body', `url_ids.${String(index)}`) });
      });
    }
  }
  if (all !== null && all !== true) errors.push(bodyError('all', 'literal_error', 'Input should be true'));
  if (errors.length === 0 && (ids === null) === (all === null)) {
    errors.push(bodyError('', 'value_error', 'Value error, give `url_ids` or `all`, not both and not neither'));
  }
  if (errors.length > 0) return errors;
  return all === true
    ? { all: true }
    : { url_ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [] };
}

const refused = (request: Request, errors: ValidationItem[]): HttpResponse<Problem> => invalid(request, errors);

export const internalLinkOpportunityHandlers: HttpHandler[] = [
  mock('get', `${P}/internal-links/opportunities`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['run', 'status', 'filter[target_tier]', 'q', 'offset', 'limit', 'format', 'export'],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const rawStatus = url.searchParams.get('status');
    const status = rawStatus === null ? null : enumQuery(url, 'status', STATUSES, null);
    const format = enumQuery(url, 'format', FORMATS, 'json');
    const exportKind = url.searchParams.get('export') === null ? null : enumQuery(url, 'export', EXPORTS, null);
    const filters = listFilters(url);
    const paging = offsetPaging(url);
    if (isIssue(status) || isIssue(format) || isIssue(exportKind) || Array.isArray(filters) || Array.isArray(paging)) {
      return refused(request, [
        ...[status, format, exportKind].filter(isIssue),
        ...(Array.isArray(filters) ? filters : []),
        ...(Array.isArray(paging) ? paging : []),
      ]);
    }
    const view = readRun(request, url, caller.project.project_id);
    if (view instanceof Response) return view;
    const gone = requireLinks(request, view);
    if (gone !== null) return gone;
    // The planned fixes win over `format`, as the API reads them first
    if (exportKind === 'planned') return csv(plannedFixesCsv(), 'internal-links-planned-fixes');
    if (format === 'csv') return csv(opportunitiesCsv({ status, ...filters }), 'internal-links-opportunities');
    return HttpResponse.json(opportunities(view, { status, ...filters, ...paging }));
  }),

  mock('put', `${P}/internal-links/opportunities/decisions`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json().catch(() => undefined);
    if (!isRecord(body)) return refused(request, [notAnObject()]);
    const { pairs, errors: pairErrors } = pairsOf(body.items);
    const status = body.status;
    const errors = [
      ...extraMembers(body, ['items', 'status']),
      ...(isOneOf(status, STATUSES)
        ? []
        : [bodyError('status', status === undefined ? 'missing' : 'enum', `Allowed: ${STATUSES.join(', ')}.`)]),
      ...pairErrors,
    ];
    if (errors.length > 0 || !isOneOf(status, STATUSES)) return refused(request, errors);
    // Decisions are of the latest crawl's list
    const view = latestRun(request, caller.project.project_id);
    if (view instanceof Response) return view;
    const gone = requireLinks(request, view);
    if (gone !== null) return gone;
    return HttpResponse.json({ data: decideOpportunities(pairs, status) });
  }),

  mock('get', `${P}/internal-links/tier-suggestions`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const view = latestRun(request, caller.project.project_id);
    if (view instanceof Response) return view;
    return HttpResponse.json(tierSuggestions(view));
  }),

  mock('post', `${P}/internal-links/tier-suggestions/accept`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const selection = selectionOf(await request.json().catch(() => undefined));
    if (Array.isArray(selection)) return refused(request, selection);
    const view = latestRun(request, caller.project.project_id);
    if (view instanceof Response) return view;
    return HttpResponse.json({ data: acceptSuggestions(selection) });
  }),

  mock('post', `${P}/internal-links/tier-suggestions/dismiss`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const selection = selectionOf(await request.json().catch(() => undefined));
    if (Array.isArray(selection)) return refused(request, selection);
    const view = latestRun(request, caller.project.project_id);
    if (view instanceof Response) return view;
    return HttpResponse.json({ data: dismissSuggestions(selection) });
  }),

  mock('get', `${P}/internal-links/paths`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['url_id', 'run'],
    });
    if (caller instanceof Response) return caller;
    const urlId = caller.url.searchParams.get('url_id');
    if (urlId === null) return refused(request, [queryError('url_id', 'missing', 'Field required')]);
    if (!isUrlId(urlId)) return refused(request, [urlIdError('query', 'url_id')]);
    const view = readRun(request, caller.url, caller.project.project_id);
    if (view instanceof Response) return view;
    const gone = requireLinks(request, view);
    if (gone !== null) return gone;
    const routes = routesTo(urlId);
    return routes === null ? problem(request, 'not_found') : HttpResponse.json({ data: routes });
  }),
];
