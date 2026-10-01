import { HttpResponse, type HttpHandler } from 'msw';

import { idListError, integerError, liveTrackedOf } from './keyword-rules';
import {
  blockingBudget,
  budgetScopeOf,
  MANUAL_RUN_LIMIT,
  manualRunsToday,
  operationsProjectCaller,
  operationsWorkspaceCaller,
  savedOperations,
  type OperationsProjectCaller,
} from './operations-rules';
import { can } from './access';
import {
  bodyError,
  cursorPage,
  extraMembers,
  isRecord,
  notAnObject,
  pageRequest,
  queryError,
  textError,
  uuidError,
} from './rules';
import { readingOf } from '../factories/keyword';
import { labsMicros, runDetailView, runPath, runState, runView } from '../factories/operations';
import { operationIdMinter, operationWorld, runTime, TRIGGERS, withRun, type StoredRun } from '../operations-state';
import { invalid, mock, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * Collection runs (19 section 3.11.4, backend plan D9): a project's runs and the workspace's, newest first in
 * cursor pages, a run's detail with its tasks by status, cancelling a run that has not ended, and the manual
 * keyword metrics refresh, at most 20 a day per project, planned by the worker and judged against the
 * budgets first.
 */

const W = '/api/v1/workspaces/{workspace_id}';
const P = `${W}/projects/{project_id}`;
const RUN_WORKLOADS = [
  'seo_rank',
  'ai_prompt',
  'ai_mode_keyword',
  'keyword_metrics',
  'discovery',
  'ai_benchmark',
  'gsc_sync',
  'bing_sync',
  'ga4_sync',
  'cloudflare_sync',
] as const;
const RUN_STATUSES = [
  'planned',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'budget_blocked',
] as const;
const TRIGGER_VALUES = [...TRIGGERS, 'backfill', 'retry'] as const;
const STALE_DAYS = 25;
const MAX_REFRESH_KEYWORDS = 1000;
/** How long a client waits before it asks about a run again (19 section 2.10). */
const RUN_RETRY_SECONDS = '10';

interface RunFilter {
  workloads: string[];
  statuses: string[];
  triggers: string[];
}

/** A list filter of the query, as a comma list or repeated parameters. */
function listOf(url: URL, name: string, allowed: readonly string[]): string[] | ValidationItem {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  return values.every((value) => allowed.includes(value))
    ? values
    : queryError(name, 'enum', `Allowed: ${allowed.join(', ')}.`);
}

function runFilter(url: URL): RunFilter | ValidationItem[] {
  const workloads = listOf(url, 'filter[workload_in]', RUN_WORKLOADS);
  const statuses = listOf(url, 'filter[status_in]', RUN_STATUSES);
  const triggers = listOf(url, 'filter[trigger_in]', TRIGGER_VALUES);
  const errors = [workloads, statuses, triggers].filter((value) => !Array.isArray(value));
  if (errors.length > 0 || !Array.isArray(workloads) || !Array.isArray(statuses) || !Array.isArray(triggers)) {
    return errors.filter((value): value is ValidationItem => !Array.isArray(value));
  }
  return { workloads, statuses, triggers };
}

const keeps = (filter: RunFilter, run: StoredRun, now: number): boolean =>
  (filter.workloads.length === 0 || filter.workloads.includes(run.workload)) &&
  (filter.triggers.length === 0 || filter.triggers.includes(run.trigger)) &&
  (filter.statuses.length === 0 || filter.statuses.includes(runState(run, now).status));

const newestFirst = (a: StoredRun, b: StoredRun): number =>
  b.created_at.localeCompare(a.created_at) || b.run_id.localeCompare(a.run_id);

/** The cursor's scope: every query parameter but the page's own. */
function scopeOf(url: URL): string {
  const scope = new URLSearchParams(
    [...url.searchParams.entries()].filter(([name]) => name !== 'cursor' && name !== 'limit'),
  );
  scope.sort();
  return scope.toString();
}

/** A UUID query parameter's error, if it is not one. */
const queryUuidError = (value: string | null, path: string): ValidationItem[] =>
  value === null ? [] : uuidError(value, path).map((item) => queryError(path, item.code, item.message));

const dateError = (value: string | null, path: string): ValidationItem[] =>
  value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    ? []
    : [queryError(path, 'date_from_datetime_parsing', 'Input should be a valid date')];

/** The run of the project with this id. */
const runOf = (caller: OperationsProjectCaller, id: string | readonly string[] | undefined): StoredRun | undefined =>
  caller.operations.runs.find((run) => run.run_id === id && run.project_id === caller.project.project_id);

/** The Labs readings a refresh asks for, one per keyword, location and language the project tracks. */
function refreshReadings(
  caller: OperationsProjectCaller,
  keywordIds: readonly string[] | null,
  staleDays: number,
  now: number,
): { keyword: string; place: string }[] {
  const wanted = keywordIds === null ? null : new Set(keywordIds);
  const seen = new Map<string, { keyword: string; place: string }>();
  for (const row of liveTrackedOf(caller.keywords, caller.project.project_id)) {
    if (!row.is_active || (wanted !== null && !wanted.has(row.keyword_id))) continue;
    const place = `${String(row.location_id)}:${row.language_code}`;
    const key = `${row.keyword_id}:${place}`;
    if (seen.has(key)) continue;
    if (wanted === null) {
      const found = readingOf(caller.keywords, row.keyword_id, row.location_id, row.language_code, now);
      // Metrics fetched within `stale_days` are fresh enough
      if (found !== null && now - Date.parse(found.fetchedAt) < staleDays * 24 * 60 * 60 * 1000) continue;
    }
    seen.set(key, { keyword: row.keyword_id, place });
  }
  return [...seen.values()];
}

export const runHandlers: HttpHandler[] = [
  mock('get', `${P}/runs`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: [
        'filter[schedule_id]',
        'filter[workload_in]',
        'filter[status_in]',
        'filter[trigger_in]',
        'cursor',
        'limit',
      ],
    });
    if (caller instanceof Response) return caller;
    const scheduleId = caller.url.searchParams.get('filter[schedule_id]');
    const filter = runFilter(caller.url);
    const paging = pageRequest(caller.url);
    const errors = [
      ...queryUuidError(scheduleId, 'filter[schedule_id]'),
      ...(Array.isArray(filter) ? filter : []),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(filter) || Array.isArray(paging)) return invalid(request, errors);
    const now = Date.now();
    const rows = caller.operations.runs
      .filter(
        (run) =>
          run.project_id === caller.project.project_id &&
          (scheduleId === null || run.schedule_id === scheduleId) &&
          keeps(filter, run, now),
      )
      .sort(newestFirst);
    const page = cursorPage(rows, paging, scopeOf(caller.url));
    if (page === null) return problem(request, 'invalid_cursor');
    const workspaceId = caller.access.workspace.workspace_id;
    return HttpResponse.json({
      data: page.data.map((run) => runView(workspaceId, caller.operations.schedules, run, now)),
      page: page.page,
      meta: {
        manual_runs_today: {
          limit: MANUAL_RUN_LIMIT,
          used: manualRunsToday(caller.operations, caller.project.project_id, now),
        },
      },
    });
  }),

  mock('get', `${W}/runs`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'data:read',
      query: [
        'filter[project_id]',
        'filter[workload_in]',
        'filter[status_in]',
        'filter[trigger_in]',
        'from',
        'to',
        'cursor',
        'limit',
      ],
    });
    if (caller instanceof Response) return caller;
    const projectId = caller.url.searchParams.get('filter[project_id]');
    const from = caller.url.searchParams.get('from');
    const to = caller.url.searchParams.get('to');
    const filter = runFilter(caller.url);
    const paging = pageRequest(caller.url);
    const errors = [
      ...queryUuidError(projectId, 'filter[project_id]'),
      ...dateError(from, 'from'),
      ...dateError(to, 'to'),
      ...(Array.isArray(filter) ? filter : []),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(filter) || Array.isArray(paging)) return invalid(request, errors);
    const now = Date.now();
    // A member limited to some projects sees those projects' runs
    const visible = new Set(caller.projects.map((project) => project.project_id));
    const rows = caller.operations.runs
      .filter(
        (run) =>
          visible.has(run.project_id) &&
          (projectId === null || run.project_id === projectId) &&
          (from === null || run.created_at.slice(0, 10) >= from) &&
          (to === null || run.created_at.slice(0, 10) <= to) &&
          keeps(filter, run, now),
      )
      .sort(newestFirst);
    const page = cursorPage(rows, paging, scopeOf(caller.url));
    if (page === null) return problem(request, 'invalid_cursor');
    const workspaceId = caller.access.workspace.workspace_id;
    return HttpResponse.json({
      data: page.data.map((run) => runView(workspaceId, caller.operations.schedules, run, now)),
      page: page.page,
      meta: { manual_runs_today: null },
    });
  }),

  mock('get', `${P}/runs/{run_id}`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const run = runOf(caller, params.run_id);
    if (run === undefined) return problem(request, 'not_found');
    const now = Date.now();
    const view = runDetailView(caller.access.workspace.workspace_id, caller.operations.schedules, run, now);
    const open = view.status === 'planned' || view.status === 'running';
    return HttpResponse.json({ data: view }, open ? { headers: { 'retry-after': RUN_RETRY_SECONDS } } : {});
  }),

  mock('post', `${P}/runs/{run_id}/cancel`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const run = runOf(caller, params.run_id);
    if (run === undefined) return problem(request, 'not_found');
    // A member may cancel the manual runs they started; any other run takes `schedules:write`
    const own = run.trigger === 'manual' && run.created_by === caller.session.user.user_id;
    if (!can(caller.access, own ? 'runs:trigger' : 'schedules:write')) return problem(request, 'forbidden');
    const text = await request.text();
    const body: unknown = text === '' ? {} : JSON.parse(text);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['reason']),
      ...(body.reason === undefined || body.reason === null ? [] : textError(body.reason, 'reason', { max: 500 })),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const now = Date.now();
    const { status } = runState(run, now);
    if (status !== 'planned' && status !== 'running') {
      return problem(request, 'invalid_state_transition', { detail: `The run has ended (${status}).` });
    }
    const cancelled: StoredRun = {
      ...run,
      cancelled_at: runTime(now),
      cancel_reason: typeof body.reason === 'string' ? body.reason : null,
    };
    const changes = withRun(caller.operationChanges, cancelled);
    const cookie = savedOperations(request, changes);
    if (typeof cookie !== 'string') return cookie;
    return HttpResponse.json(
      { data: runView(caller.access.workspace.workspace_id, caller.operations.schedules, cancelled, now) },
      { headers: { 'set-cookie': cookie } },
    );
  }),

  mock('post', `${P}/keyword-metrics/refresh`, async ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'runs:trigger',
    });
    if (caller instanceof Response) return caller;
    const text = await request.text();
    const body: unknown = text === '' ? {} : JSON.parse(text);
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const shape = [
      ...extraMembers(body, ['keyword_ids', 'stale_days']),
      ...(body.keyword_ids === null ? [] : idListError(body.keyword_ids, 'keyword_ids', MAX_REFRESH_KEYWORDS)),
      ...integerError(body.stale_days, 'stale_days', { min: 0, max: 365, nullable: true }),
    ];
    if (shape.length > 0) return invalid(request, shape);
    const keywordIds = Array.isArray(body.keyword_ids)
      ? body.keyword_ids.filter((id): id is string => typeof id === 'string')
      : null;
    const tracked = new Set(liveTrackedOf(caller.keywords, caller.project.project_id).map((row) => row.keyword_id));
    if (keywordIds !== null && keywordIds.some((id) => !tracked.has(id))) {
      return invalid(request, [
        bodyError('keyword_ids', 'keyword_unknown', 'A keyword is not one this project tracks.'),
      ]);
    }
    const now = Date.now();
    const used = manualRunsToday(caller.operations, caller.project.project_id, now);
    if (used >= MANUAL_RUN_LIMIT) {
      const midnight = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) + 24 * 60 * 60 * 1000;
      const seconds = Math.ceil((midnight - now) / 1000);
      return problem(request, 'manual_run_limit', {
        detail: `This project has started ${String(MANUAL_RUN_LIMIT)} manual runs today. The count starts again at midnight UTC.`,
        limit: MANUAL_RUN_LIMIT,
        used,
        retry_after_seconds: seconds,
        headers: { 'retry-after': String(seconds) },
      });
    }
    const staleDays = typeof body.stale_days === 'number' ? body.stale_days : STALE_DAYS;
    const readings = refreshReadings(caller, keywordIds, staleDays, now);
    const calls = new Set(readings.map((reading) => reading.place)).size;
    const minter = operationIdMinter(caller.operationChanges);
    const draft: StoredRun = {
      run_id: minter.next('run'),
      project_id: caller.project.project_id,
      schedule_id: null,
      workload: 'keyword_metrics',
      trigger: 'manual',
      created_at: runTime(now),
      created_by: caller.session.user.user_id,
      tasks_total: readings.length,
      tasks_failed: 0,
      calls,
      keyword_count: keywordIds === null ? null : keywordIds.length,
      stale_days: keywordIds === null ? staleDays : null,
      ending: 'completed',
      status_reason: null,
      blocked_by_budget_id: null,
      cancelled_at: null,
      cancel_reason: null,
    };
    // Pre-flight (doc 27 section 10.3): a hard budget that pauses runs and would be passed blocks the run
    const blocking = blockingBudget(
      caller.operations,
      budgetScopeOf(caller),
      draft,
      labsMicros(calls, readings.length),
      now,
    );
    const run: StoredRun =
      blocking === null
        ? draft
        : {
            ...draft,
            ending: 'budget_blocked',
            blocked_by_budget_id: blocking.budget_id,
            status_reason: 'A budget for keyword research is used up for this month.',
          };
    const changes = minter.commit(withRun(caller.operationChanges, run));
    const cookie = savedOperations(request, changes);
    if (typeof cookie !== 'string') return cookie;
    const workspaceId = caller.access.workspace.workspace_id;
    return HttpResponse.json(
      { data: runView(workspaceId, operationWorld(changes).schedules, run, now) },
      {
        status: 202,
        headers: { 'set-cookie': cookie, location: runPath(workspaceId, run), 'retry-after': RUN_RETRY_SECONDS },
      },
    );
  }),
];
