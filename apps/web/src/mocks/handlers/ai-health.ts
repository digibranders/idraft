import { HttpResponse, type HttpHandler } from 'msw';

import { liveTrackedOf } from './keyword-rules';
import {
  costEvents,
  operationsProjectCaller,
  operationsWorkspaceCaller,
  type OperationsWorkspaceCaller,
} from './operations-rules';
import {
  bodyError,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  nullErrors,
  offsetPageOf,
  offsetPaging,
  queryError,
  uuidError,
} from './rules';
import {
  PLANNED_PER_ENGINE,
  addBudget,
  aiCoverage,
  budgetView,
  changeBudget,
  collectionDays,
  currentBudgets,
  dailyEngines,
  duplicateBudget,
  forecastRow,
  removeBudget,
  unitCostRow,
  type DailyScope,
} from '../ai-health-model';
import { BUDGET_GROUPS, type StoredBudget } from '../operations-fixtures';
import { promptsOf } from '../prompts-state';
import { ENGINE_CODES } from '../prompt-fixtures';
import { invalid, mock, noContent, problem } from '../respond';
import { shiftIsoDate, validateDateWindow } from '../serp-views';
import { projectList } from '../workspace-state';
import type { EngineCode, ValidationItem } from '@/lib/api/types';
import { formatIsoDate } from '@/lib/format';

/**
 * WP-30: what a run collected (`ai-coverage`, C3), the collection day by day (`ai/collection/daily`, N5), the
 * budgets a member edits, and the forecast and the unit costs of the Costs page (docs/ai-visibility/contracts). The
 * figures come from ../ai-health-model.ts; the budgets live in its memory, so `budgets/status` (./costs.ts) reads
 * what is created, changed and deleted here.
 */

const W = '/api/v1/workspaces/{workspace_id}';
const P = `${W}/projects/{project_id}`;
/** The plan's quotas the limits read shows: AI answers a UTC month, and manual runs a UTC day (the prompt quota is the planned 150). */
const AI_ANSWERS_PER_MONTH = 2000;
const MANUAL_RUNS_PER_DAY = 20;
const DEFAULT_DAYS = 28;
const MAX_DAYS = 92;
const MAX_ENGINES = 3;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A month of the years the ledger holds, 2000 to 2100 (as ./costs.ts). */
const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
/** A limit as the column holds it: whole dollars and at most two places. */
const LIMIT = /^\d+(\.\d{1,2})?$/;
const LIMIT_MAX = 99_999_999_999.99;
const BUDGET_MEMBERS = ['project_id', 'workload', 'limit_usd', 'soft_limit_pct', 'action_on_hard'] as const;
const PATCH_MEMBERS = ['limit_usd', 'soft_limit_pct', 'action_on_hard'] as const;
const ACTIONS = ['pause', 'alert_only'] as const;

const isEngine = (value: string): value is EngineCode => ENGINE_CODES.some((code) => code === value);

const pathUuid = (value: unknown, name: string): ValidationItem[] =>
  uuidError(value, name).map((item): ValidationItem => ({ ...item, location: 'path' }));

const queryUuid = (value: string | null, name: string): ValidationItem[] =>
  value === null ? [] : uuidError(value, name).map((item) => queryError(name, item.code, item.message));

const required = (body: Readonly<Record<string, unknown>>, name: string): ValidationItem[] =>
  body[name] === undefined ? [bodyError(name, 'missing', 'Field required')] : [];

/** A comma list or repeated parameters of the query, each one of `allowed`; the errors go to `errors`. */
function listOf(url: URL, name: string, allowed: readonly string[], max: number, errors: ValidationItem[]): string[] {
  const values = url.searchParams
    .getAll(name)
    .flatMap((value) => value.split(','))
    .filter((value) => value !== '');
  if (values.length > max) errors.push(queryError(name, 'too_long', `List should have at most ${String(max)} items.`));
  values.forEach((value, place) => {
    if (!allowed.includes(value)) {
      errors.push(queryError(`${name}.${String(place)}`, 'enum', `Allowed: ${allowed.join(', ')}.`));
    }
  });
  return values.filter((value) => allowed.includes(value));
}

/** A limit in dollars: a decimal string of at most two places up to the column's largest. */
function limitError(value: unknown): ValidationItem[] {
  if (typeof value !== 'string') return [bodyError('limit_usd', 'string_type', 'Input should be a valid string')];
  if (!LIMIT.test(value)) {
    return [bodyError('limit_usd', 'string_pattern_mismatch', 'A decimal number with at most two places.')];
  }
  return Number(value) > LIMIT_MAX
    ? [bodyError('limit_usd', 'less_than_equal', `Input should be less than or equal to ${String(LIMIT_MAX)}`)]
    : [];
}

/** The limit with its two places, as the column stores it: `10` is `10.00`. */
const limitOf = (value: string): string => {
  const [whole = '0', fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
};

/** The soft limit and the action of a body, checked when they are given. */
const settingErrors = (body: Readonly<Record<string, unknown>>): ValidationItem[] => [
  ...(body.soft_limit_pct === undefined || body.soft_limit_pct === null
    ? []
    : integerErrors(body.soft_limit_pct, 'soft_limit_pct')),
  ...(body.action_on_hard === undefined || body.action_on_hard === null
    ? []
    : enumError(body.action_on_hard, 'action_on_hard', ACTIONS)),
];

function integerErrors(value: unknown, path: string): ValidationItem[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [bodyError(path, 'int_type', 'Input should be a valid integer')];
  }
  if (value < 1) return [bodyError(path, 'greater_than_equal', 'Input should be greater than or equal to 1')];
  if (value > 100) return [bodyError(path, 'less_than_equal', 'Input should be less than or equal to 100')];
  return [];
}

/** The JSON of a request body, or the `422` of a body that is not JSON. */
async function bodyOf(request: Request): Promise<unknown> {
  const text = await request.text();
  try {
    return text === '' ? {} : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** The budgets of the workspace the caller sees, oldest first: a member limited to some projects sees theirs only. */
function visibleBudgets(caller: OperationsWorkspaceCaller): StoredBudget[] {
  const visible = new Set(caller.projects.map((project) => project.project_id));
  const limited = caller.access.membership.project_ids !== null;
  return currentBudgets()
    .filter(
      (budget) =>
        budget.workspace_id === caller.access.workspace.workspace_id &&
        (!limited || (budget.project_id !== null && visible.has(budget.project_id))),
    )
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.budget_id.localeCompare(b.budget_id));
}

/** The month and the projects of a forecast or a unit cost read, or the response to answer. */
function costScope(
  request: Request,
  caller: OperationsWorkspaceCaller,
): { month: string; projectIds: string[] } | ReturnType<typeof invalid> | ReturnType<typeof problem> {
  const { url } = caller;
  const month = url.searchParams.get('month') ?? new Date(Date.now()).toISOString().slice(0, 7);
  const projectId = url.searchParams.get('filter[project_id]');
  const errors = [
    ...(MONTH.test(month) ? [] : [queryError('month', 'string_pattern_mismatch', 'A month as YYYY-MM.')]),
    ...queryUuid(projectId, 'filter[project_id]'),
  ];
  if (errors.length > 0) return invalid(request, errors);
  const visible = caller.projects.map((project) => project.project_id);
  // A project the caller cannot see, or that does not exist, is not found
  if (projectId !== null && !visible.includes(projectId)) return problem(request, 'not_found');
  return { month, projectIds: projectId === null ? visible : [projectId] };
}

const activePrompts = (projectId: string): number =>
  promptsOf(projectId).prompts.filter((prompt) => prompt.is_active).length;
const enabledEngines = (projectId: string): EngineCode[] =>
  promptsOf(projectId)
    .engines.filter((engine) => engine.is_enabled)
    .map((engine) => engine.engine_code);

export const aiHealthHandlers: HttpHandler[] = [
  mock('get', `${P}/runs/{run_id}/ai-coverage`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const errors = pathUuid(params.run_id, 'run_id');
    if (errors.length > 0) return invalid(request, errors);
    const run = caller.operations.runs.find(
      (candidate) => candidate.run_id === params.run_id && candidate.project_id === caller.project.project_id,
    );
    if (run === undefined) return problem(request, 'not_found');
    if (run.workload !== 'ai_prompt') {
      return problem(request, 'not_an_ai_run', { detail: `The run collects ${run.workload}, not AI answers.` });
    }
    return HttpResponse.json({ data: aiCoverage(caller.operations.runs, run, Date.now()) });
  }),

  mock('get', `${P}/ai/collection/daily`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['from', 'to', 'filter[engine_code_in]'],
    });
    if (caller instanceof Response) return caller;
    const { url } = caller;
    const now = Date.now();
    const zone = caller.project.timezone;
    const errors: ValidationItem[] = [];
    const filter = listOf(url, 'filter[engine_code_in]', ENGINE_CODES, MAX_ENGINES, errors).filter(isEngine);
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
    if (errors.length > 0 || 'error' in window) return invalid(request, errors);
    if ('problem' in window) {
      return problem(request, 'window_too_large', {
        detail: `A request covers at most ${String(MAX_DAYS)} days.`,
        limit_days: window.limit_days,
      });
    }
    const scope: DailyScope = {
      runs: caller.operations.runs,
      projectId: caller.project.project_id,
      timezone: zone,
      now,
      firstDate: window.range.firstDate,
      lastDate: window.range.lastDate,
    };
    const engines = dailyEngines(
      scope,
      enabledEngines(scope.projectId),
      url.searchParams.has('filter[engine_code_in]') ? filter : null,
    );
    return HttpResponse.json({
      data: collectionDays(scope, engines),
      meta: { window: { from: scope.firstDate, to: scope.lastDate, timezone: zone }, engine_codes: engines },
    });
  }),

  mock('get', `${P}/ai/limits`, ({ request, cookies, params }) => {
    const caller = operationsProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const month = new Date(Date.now()).toISOString().slice(0, 7);
    // The quotas are the workspace's: the prompts of every project the caller sees, and this UTC month's answers
    const answers = caller.operations.runs
      .filter((run) => run.workload === 'ai_prompt' && run.cancelled_at === null && run.created_at.startsWith(month))
      .reduce((sum, run) => sum + run.tasks_total, 0);
    return HttpResponse.json({
      data: {
        prompts: {
          limit: PLANNED_PER_ENGINE,
          used: caller.projects.reduce((sum, project) => sum + activePrompts(project.project_id), 0),
        },
        ai_observations_month: { limit: AI_ANSWERS_PER_MONTH, used: answers },
        manual_runs_today: { limit: MANUAL_RUNS_PER_DAY, used: 0 },
      },
    });
  }),

  mock('get', `${W}/budgets`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['offset', 'limit', 'filter[project_id]'],
    });
    if (caller instanceof Response) return caller;
    const projectId = caller.url.searchParams.get('filter[project_id]');
    const paging = offsetPaging(caller.url);
    const errors = [...queryUuid(projectId, 'filter[project_id]'), ...(Array.isArray(paging) ? paging : [])];
    if (errors.length > 0 || Array.isArray(paging)) return invalid(request, errors);
    if (projectId !== null && !caller.projects.some((project) => project.project_id === projectId)) {
      return problem(request, 'not_found');
    }
    const rows = visibleBudgets(caller).filter((budget) => projectId === null || budget.project_id === projectId);
    const page = offsetPageOf(rows, paging);
    return HttpResponse.json({ data: page.data.map(budgetView), page: page.page });
  }),

  mock('post', `${W}/budgets`, async ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, { permission: 'budgets:manage' });
    if (caller instanceof Response) return caller;
    const body = await bodyOf(request);
    if (!isRecord(body)) {
      return invalid(request, [
        body === undefined ? bodyError('', 'json_invalid', 'JSON decode error') : notAnObject(),
      ]);
    }
    const errors = [
      ...extraMembers(body, BUDGET_MEMBERS),
      ...uuidError(body.project_id, 'project_id', { nullable: true }),
      ...required(body, 'workload'),
      ...enumError(body.workload, 'workload', BUDGET_GROUPS),
      ...required(body, 'limit_usd'),
      ...(body.limit_usd === undefined ? [] : limitError(body.limit_usd)),
      ...settingErrors(body),
    ];
    if (errors.length > 0 || !isOneOf(body.workload, BUDGET_GROUPS) || typeof body.limit_usd !== 'string') {
      return invalid(request, errors);
    }
    const workspaceId = caller.access.workspace.workspace_id;
    const projectId = typeof body.project_id === 'string' ? body.project_id : null;
    if (projectId !== null && !projectList(caller.changes, workspaceId).some((row) => row.project_id === projectId)) {
      return invalid(request, [bodyError('project_id', 'project_unknown', 'The project is not in this workspace.')]);
    }
    // A member limited to some projects budgets those projects only: the workspace and the rest are not theirs
    const limited = caller.access.membership.project_ids !== null;
    if (limited && (projectId === null || !caller.projects.some((row) => row.project_id === projectId))) {
      return problem(request, 'not_found');
    }
    if (duplicateBudget(workspaceId, projectId, body.workload)) {
      return problem(request, 'duplicate', {
        detail: 'A budget for this scope and group already exists for the month.',
      });
    }
    const budget = addBudget(
      {
        workspace_id: workspaceId,
        project_id: projectId,
        workload: body.workload,
        limit_usd: limitOf(body.limit_usd),
        soft_limit_pct: typeof body.soft_limit_pct === 'number' ? body.soft_limit_pct : 80,
        action_on_hard: isOneOf(body.action_on_hard, ACTIONS) ? body.action_on_hard : 'pause',
      },
      Date.now(),
    );
    return HttpResponse.json(
      { data: budgetView(budget) },
      { status: 201, headers: { location: `${new URL(request.url).pathname}/${budget.budget_id}` } },
    );
  }),

  mock('patch', `${W}/budgets/{budget_id}`, async ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, { permission: 'budgets:manage' });
    if (caller instanceof Response) return caller;
    const body = await bodyOf(request);
    if (!isRecord(body)) {
      return invalid(request, [
        body === undefined ? bodyError('', 'json_invalid', 'JSON decode error') : notAnObject(),
      ]);
    }
    const errors = [
      ...pathUuid(params.budget_id, 'budget_id'),
      ...extraMembers(body, PATCH_MEMBERS),
      ...(Object.keys(body).length === 0
        ? [bodyError('', 'value_error', 'Give at least one of limit_usd, soft_limit_pct and action_on_hard.')]
        : []),
      ...nullErrors(body, PATCH_MEMBERS),
      ...(body.limit_usd === undefined || body.limit_usd === null ? [] : limitError(body.limit_usd)),
      ...settingErrors(body),
    ];
    if (errors.length > 0) return invalid(request, errors);
    const found = visibleBudgets(caller).find((budget) => budget.budget_id === params.budget_id);
    if (found === undefined) return problem(request, 'not_found');
    const changed = changeBudget(found.budget_id, {
      ...(typeof body.limit_usd === 'string' ? { limit_usd: limitOf(body.limit_usd) } : {}),
      ...(typeof body.soft_limit_pct === 'number' ? { soft_limit_pct: body.soft_limit_pct } : {}),
      ...(isOneOf(body.action_on_hard, ACTIONS) ? { action_on_hard: body.action_on_hard } : {}),
    });
    return changed === undefined ? problem(request, 'not_found') : HttpResponse.json({ data: budgetView(changed) });
  }),

  mock('delete', `${W}/budgets/{budget_id}`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, { permission: 'budgets:manage' });
    if (caller instanceof Response) return caller;
    const errors = pathUuid(params.budget_id, 'budget_id');
    if (errors.length > 0) return invalid(request, errors);
    const found = visibleBudgets(caller).find((budget) => budget.budget_id === params.budget_id);
    if (found === undefined) return problem(request, 'not_found');
    removeBudget(found.budget_id);
    return noContent();
  }),

  mock('get', `${W}/costs/forecast`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['month', 'filter[project_id]'],
    });
    if (caller instanceof Response) return caller;
    const scope = costScope(request, caller);
    if (scope instanceof Response) return scope;
    const data = scope.projectIds.flatMap((projectId) => {
      const row = forecastRow(caller.operations.schedules, projectId, scope.month, {
        activePrompts: activePrompts(projectId),
        engines: enabledEngines(projectId).length,
      });
      return row === undefined ? [] : [row];
    });
    return HttpResponse.json({ data });
  }),

  mock('get', `${W}/costs/unit-costs`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['month', 'filter[project_id]'],
    });
    if (caller instanceof Response) return caller;
    const scope = costScope(request, caller);
    if (scope instanceof Response) return scope;
    const now = Date.now();
    const events = costEvents(caller.operations, now).filter(
      (event) => event.workload === 'seo_rank' && event.day.startsWith(scope.month),
    );
    const data = scope.projectIds.map((projectId) => {
      const spent = events.filter((event) => event.project_id === projectId);
      return unitCostRow({
        projectId,
        month: scope.month,
        runs: caller.operations.runs,
        now,
        activePrompts: activePrompts(projectId),
        trackedKeywords: liveTrackedOf(caller.keywords, projectId).filter((row) => row.is_active).length,
        seoRank: {
          micros: spent.reduce((sum, event) => sum + event.micros, 0),
          requests: spent.reduce((sum, event) => sum + event.requests, 0),
        },
      });
    });
    return HttpResponse.json({ data });
  }),
];
