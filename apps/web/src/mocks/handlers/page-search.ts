import { HttpResponse, type HttpHandler } from 'msw';

import { projectCaller, type ProjectCaller } from './access';
import { bodyError, extraMembers, isOneOf, isRecord, notAnObject, queryError } from './rules';
import { integrationWorld, liveIntegrations } from '../integrations-state';
import {
  breakdownOf,
  cannibalizationOf,
  finalThrough,
  historyFrom,
  isLoading,
  markHistoryReady,
  MAX_DAYS,
  numbersOf,
  PAGES,
  pageById,
  pageByPath,
  periodOf,
  queriesOf,
  searchOf,
  tierIdOf,
  track,
  TRACKED_LIMIT,
  trackedOf,
  untrack,
  type CompareParam,
  type WorldPage,
} from '../page-search-world';
import { invalid, mock, problem } from '../respond';
import { shiftIsoDate } from '../serp-views';
import type { Problem, Schemas, ValidationItem } from '@/lib/api/types';

/**
 * The seven routes of `fp/tracked-pages` and `fp/page-search` (spec 2026-11-26, section 7.2), answered from
 * `../page-search-world.ts`. Search Console is connected for a project when the browser linked a property to it on
 * the integrations page (the mocks keep that in a cookie, as for GA4), so the screens can be walked from "not
 * connected" to their numbers. `?mock=busy` makes the breakdown answer `429 gsc_busy` and the detail answer with no
 * numbers and a wait, the two ways Google can be out of reach; `?mock=cannibalization` fills the reserved column.
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const PERIOD_QUERY = ['from', 'to', 'compare'];
const COMPARES = ['none', 'previous_period', 'previous_year'] as const;
const DIMENSIONS = ['query', 'country', 'device'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INPUTS = 500;
const MAX_REMOVALS = 200;
const SUGGESTIONS_LIMIT = 25;
const BUSY_SECONDS = 20;
const ROW_LIMITS = { query: 100, country: 50, device: 10 } as const;

type State = Schemas['TrackedPagesMeta']['state'];
type Windows = { window: Schemas['SearchWindow']; compare: Schemas['SearchWindow'] | null };

interface Connection {
  state: State;
  property: string | null;
}

function connectionOf(caller: ProjectCaller, cookies: Readonly<Record<string, string>>): Connection {
  const row = liveIntegrations(integrationWorld(cookies)).find(
    (one) => one.kind === 'gsc' && one.projectId === caller.project.project_id,
  );
  if (row === undefined) return { state: 'not_connected', property: null };
  const state = row.status === 'reauth_required' ? 'reauth_required' : row.status === 'error' ? 'no_access' : 'ok';
  return { state, property: row.property };
}

/** Whether the stored numbers are served: every state but the two where nothing is stored yet. */
const hasNumbers = (state: State): boolean => state !== 'not_connected' && state !== 'pending';

const hostOf = (caller: ProjectCaller): string => caller.project.primary_domain?.host ?? 'eventussecurity.com';
const urlOf = (caller: ProjectCaller, page: WorldPage): string => `https://${hostOf(caller)}${page.path}`;

function askedPeriod(
  request: Request,
  url: URL,
  final: string,
): { windows: Windows; compare: CompareParam } | HttpResponse<Problem> {
  const errors: ValidationItem[] = [];
  const asked = url.searchParams.get('compare');
  let compare: CompareParam = 'previous_period';
  if (asked !== null) {
    if (isOneOf(asked, COMPARES)) compare = asked;
    else errors.push(queryError('compare', 'enum', `Allowed: ${COMPARES.join(', ')}.`));
  }
  const days: Record<'from' | 'to', string | null> = {
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  };
  for (const name of ['from', 'to'] as const) {
    const value = days[name];
    if (value !== null && !(ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      errors.push(queryError(name, 'date_parsing', 'Input should be a valid date'));
    }
  }
  if (errors.length > 0) return invalid(request, errors);
  const result = periodOf(days.from, days.to, compare, final);
  if ('problem' in result) {
    return result.problem === 'window_too_large'
      ? problem(request, 'window_too_large', {
          detail: `A request covers at most ${String(MAX_DAYS)} days.`,
          limit_days: MAX_DAYS,
        })
      : invalid(request, [queryError('from', 'value_error', 'The period starts after it ends.')]);
  }
  return { windows: result, compare };
}

const isResponse = (value: unknown): value is HttpResponse<Problem> => value instanceof Response;

/** The members of `meta` every read has: the state, the property and the periods (null where nothing is stored). */
function periodMeta(connection: Connection, final: string, windows: Windows) {
  const stored = hasNumbers(connection.state);
  return {
    state: connection.state,
    property: connection.property,
    final_through: stored ? final : null,
    window: stored ? windows.window : null,
    compare_window: stored ? windows.compare : null,
  };
}

function suggestionsOf(caller: ProjectCaller, final: string): Schemas['SuggestionRow'][] {
  const tracked = trackedOf(caller.project.project_id);
  return PAGES.filter((page) => !tracked.has(page.urlId))
    .map((page) => {
      const last28 = numbersOf(page.urlId, shiftIsoDate(final, -27), final);
      return {
        url_id: page.urlId,
        url: urlOf(caller, page),
        path: page.path,
        title: page.title,
        clicks_28d: last28.clicks,
        impressions_28d: last28.impressions,
      };
    })
    .sort((a, b) => b.clicks_28d - a.clicks_28d)
    .slice(0, SUGGESTIONS_LIMIT);
}

/** The strings of an array member of the body, or the field errors. */
function textsOf(body: Readonly<Record<string, unknown>>, name: string, max: number): string[] | ValidationItem[] {
  const value = body[name];
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [bodyError(name, 'list_type', 'Input should be a valid list')];
  if (value.length > max) return [bodyError(name, 'too_long', `List should have at most ${String(max)} items`)];
  const texts: string[] = [];
  const errors: ValidationItem[] = [];
  value.forEach((item: unknown, index) => {
    if (typeof item === 'string') texts.push(item);
    else errors.push(bodyError(`${name}.${String(index)}`, 'string_type', 'Input should be a valid string'));
  });
  return errors.length > 0 ? errors : texts;
}

const isErrors = (value: string[] | ValidationItem[]): value is ValidationItem[] =>
  value.some((one) => typeof one !== 'string');

/** The page an address or path names, or the reason it names none. */
function pageOfAddress(input: string, host: string): WorldPage | 'invalid_url' | 'wrong_host' | 'not_crawled' {
  if (/\s/.test(input) || !(input.startsWith('/') || /^https?:\/\//i.test(input))) return 'invalid_url';
  let parsed: URL;
  try {
    parsed = new URL(input, `https://${host}`);
  } catch {
    return 'invalid_url';
  }
  if (parsed.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) return 'wrong_host';
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, '') : parsed.pathname;
  return pageByPath(path) ?? 'not_crawled';
}

export const pageSearchHandlers: HttpHandler[] = [
  mock('get', `${P}/fp/tracked-pages`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [...PERIOD_QUERY, 'mock'],
    });
    if (caller instanceof Response) return caller;
    const now = Date.now();
    const final = finalThrough(now);
    const asked = askedPeriod(request, caller.url, final);
    if (isResponse(asked)) return asked;
    const { windows, compare } = asked;
    const connection = connectionOf(caller, cookies);
    const projectId = caller.project.project_id;
    const filled = caller.url.searchParams.get('mock') === 'cannibalization';
    const tracked = trackedOf(projectId);
    const rows = PAGES.filter((page) => tracked.has(page.urlId))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .map((page): Schemas['TrackedPageRow'] => {
        const stored = hasNumbers(connection.state);
        const ready = stored && !isLoading(projectId, page.urlId);
        const search = ready ? searchOf(page.urlId, windows, historyFrom(final)) : null;
        return {
          url_id: page.urlId,
          url: urlOf(caller, page),
          path: page.path,
          title: page.title,
          tier_id: tierIdOf(page),
          added_at: tracked.get(page.urlId) ?? '',
          history: isLoading(projectId, page.urlId) ? 'loading' : 'ready',
          current: search?.current ?? null,
          previous: search?.previous ?? null,
          health: search?.health ?? null,
          queries: stored ? queriesOf(page.urlId, windows.window.from, windows.window.to, compare) : null,
          cannibalization: cannibalizationOf(page.urlId, filled),
          trend: search === null ? null : search.series.map((point) => point.clicks),
        };
      });
    const body: Schemas['TrackedPagesResponse'] = {
      data: rows,
      meta: { ...periodMeta(connection, final, windows), limit: TRACKED_LIMIT, tracked: tracked.size },
    };
    return HttpResponse.json(body);
  }),

  mock('get', `${P}/fp/tracked-pages/ids`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const ids = [...trackedOf(caller.project.project_id).keys()].filter((id) => pageById(id) !== undefined);
    return HttpResponse.json({ data: ids, meta: { limit: TRACKED_LIMIT } });
  }),

  mock('get', `${P}/fp/tracked-pages/suggestions`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, { permission: 'data:read' });
    if (caller instanceof Response) return caller;
    const { state } = connectionOf(caller, cookies);
    const data = hasNumbers(state) ? suggestionsOf(caller, finalThrough(Date.now())) : [];
    return HttpResponse.json({ data, meta: { state } });
  }),

  mock('post', `${P}/fp/tracked-pages`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const urls = textsOf(body, 'urls', MAX_INPUTS);
    const urlIds = textsOf(body, 'url_ids', MAX_INPUTS);
    const errors = [
      ...extraMembers(body, ['urls', 'url_ids', 'dry_run']),
      ...(isErrors(urls) ? urls : []),
      ...(isErrors(urlIds) ? urlIds : []),
      ...(body.dry_run === undefined || typeof body.dry_run === 'boolean'
        ? []
        : [bodyError('dry_run', 'bool_type', 'Input should be a valid boolean')]),
    ];
    if (errors.length > 0 || isErrors(urls) || isErrors(urlIds)) return invalid(request, errors);
    const dryRun = body.dry_run === true;
    const projectId = caller.project.project_id;
    const tracked = trackedOf(projectId);
    const { state } = connectionOf(caller, cookies);
    const final = finalThrough(Date.now());
    const taken = new Set<string>();
    const answer = (input: string, page: WorldPage | undefined, outcome: Schemas['TrackOutcome']['outcome']) => ({
      input,
      outcome,
      url_id: page?.urlId ?? null,
      path: page?.path ?? null,
      clicks_28d:
        page === undefined || !hasNumbers(state) ? null : numbersOf(page.urlId, shiftIsoDate(final, -27), final).clicks,
    });
    // The limit counts what this request already took: the inputs are taken in order
    const decide = (input: string, found: WorldPage | 'invalid_url' | 'wrong_host' | 'not_crawled') => {
      if (typeof found === 'string') return answer(input, undefined, found);
      if (tracked.has(found.urlId) || taken.has(found.urlId)) return answer(input, found, 'already_tracked');
      if (tracked.size + taken.size >= TRACKED_LIMIT) return answer(input, found, 'over_limit');
      taken.add(found.urlId);
      return answer(input, found, dryRun ? 'ok' : 'added');
    };
    const data = [
      ...urls.map((input) => decide(input, pageOfAddress(input, hostOf(caller)))),
      ...urlIds.map((input) => decide(input, pageById(input) ?? 'not_crawled')),
    ];
    if (!dryRun) {
      const at = new Date(Date.now());
      for (const urlId of taken) track(projectId, urlId, at);
    }
    const added = dryRun ? 0 : taken.size;
    return HttpResponse.json({ data, meta: { limit: TRACKED_LIMIT, tracked: tracked.size, added } });
  }),

  mock('post', `${P}/fp/tracked-pages/remove`, async ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'projects:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const urlIds = textsOf(body, 'url_ids', MAX_REMOVALS);
    const errors = [
      ...extraMembers(body, ['url_ids']),
      ...(body.url_ids === undefined ? [bodyError('url_ids', 'missing', 'Field required')] : []),
      ...(isErrors(urlIds) ? urlIds : []),
    ];
    if (errors.length > 0 || isErrors(urlIds)) return invalid(request, errors);
    return HttpResponse.json({ data: { removed: untrack(caller.project.project_id, urlIds) } });
  }),

  mock('get', `${P}/fp/page-search/{url_id}`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [...PERIOD_QUERY, 'mock'],
    });
    if (caller instanceof Response) return caller;
    const page = typeof params.url_id === 'string' ? pageById(params.url_id) : undefined;
    if (page === undefined) return problem(request, 'not_found');
    const final = finalThrough(Date.now());
    const asked = askedPeriod(request, caller.url, final);
    if (isResponse(asked)) return asked;
    const connection = connectionOf(caller, cookies);
    const projectId = caller.project.project_id;
    // Google cannot be reached for the history now: no numbers, and when to ask again
    const busy = caller.url.searchParams.get('mock') === 'busy';
    const stored = hasNumbers(connection.state) && !busy;
    // The first detail opened for a page whose history is not stored fetches it (spec D2)
    if (stored) markHistoryReady(projectId, page.urlId);
    const search = stored ? searchOf(page.urlId, asked.windows, historyFrom(final)) : null;
    const body: Schemas['PageSearchResponse'] = {
      data: {
        url_id: page.urlId,
        url: urlOf(caller, page),
        path: page.path,
        title: page.title,
        tier_id: tierIdOf(page),
        tracked: trackedOf(projectId).has(page.urlId),
        current: search?.current ?? null,
        previous: search?.previous ?? null,
        health: search?.health ?? null,
        series: search?.series ?? [],
        previous_series: search?.previousSeries ?? [],
      },
      meta: {
        ...periodMeta(connection, final, asked.windows),
        history_from: stored ? historyFrom(final) : null,
        retry_after: busy ? BUSY_SECONDS : null,
      },
    };
    return HttpResponse.json(body);
  }),

  mock('get', `${P}/fp/page-search/{url_id}/breakdown`, ({ request, cookies, params }) => {
    const caller = projectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['dimension', ...PERIOD_QUERY, 'mock'],
    });
    if (caller instanceof Response) return caller;
    const page = typeof params.url_id === 'string' ? pageById(params.url_id) : undefined;
    if (page === undefined) return problem(request, 'not_found');
    const dimension = caller.url.searchParams.get('dimension');
    if (!isOneOf(dimension, DIMENSIONS)) {
      return invalid(request, [
        dimension === null
          ? queryError('dimension', 'missing', 'Field required')
          : queryError('dimension', 'enum', `Allowed: ${DIMENSIONS.join(', ')}.`),
      ]);
    }
    const final = finalThrough(Date.now());
    const asked = askedPeriod(request, caller.url, final);
    if (isResponse(asked)) return asked;
    const connection = connectionOf(caller, cookies);
    if (caller.url.searchParams.get('mock') === 'busy' && connection.state === 'ok') {
      return problem(request, 'gsc_busy', {
        detail: 'Search Console is busy. Try again in a moment.',
        retry_after_seconds: BUSY_SECONDS,
        headers: { 'retry-after': String(BUSY_SECONDS) },
      });
    }
    const stored = hasNumbers(connection.state);
    const { rows, coverage } = stored
      ? breakdownOf(page.urlId, dimension, asked.windows)
      : { rows: [], coverage: null };
    const body: Schemas['PageBreakdownResponse'] = {
      data: rows,
      meta: {
        ...periodMeta(connection, final, asked.windows),
        dimension,
        row_limit: ROW_LIMITS[dimension],
        truncated: false,
        coverage,
        fetched_at: stored ? new Date(Date.now()).toISOString() : null,
      },
    };
    return HttpResponse.json(body);
  }),
];
