import { HttpResponse, type HttpHandler } from 'msw';

import {
  budgetReadings,
  budgetScopeOf,
  costEvents,
  operationsWorkspaceCaller,
  type CostEvent,
} from './operations-rules';
import { offsetPageOf, offsetPaging, queryError, uuidError } from './rules';
import { usdOfMicros } from '../factories/operations';
import { MOCK_PRICES } from '../operations-fixtures';
import { invalid, mock, problem } from '../respond';
import type { ValidationItem } from '@/lib/api/types';

/**
 * What the workspace spends (19 section 3.11, backend plan D14): costs grouped from the daily rollup over a
 * period, budget states for a month, and the price book the estimates use. A member limited to some projects
 * sees those projects' costs and budgets only. Money is a decimal string to the micro-dollar.
 */

const W = '/api/v1/workspaces/{workspace_id}';
const GROUP_BY = ['project', 'workload', 'provider', 'endpoint', 'engine', 'day', 'channel'] as const;
type GroupKey = (typeof GROUP_BY)[number];
/** The cost workloads of doc 04 section 11.4.1: the task workloads and the costs no task carries. */
const COST_WORKLOADS = [
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
  'ai_overview',
  'extraction_llm',
  'keyword_research',
  'first_party',
] as const;
/** `filter[workload_in]` takes at most this many workloads. */
const MAX_WORKLOADS = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A month of the years the ledger holds, 2000 to 2100 (backend `_MONTH_PATTERN`). */
const MONTH = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;
/** The years a day may be in: no cost is older, and none is from the far future. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;
/** A period holds at most this many days, both ends included: a leap year's whole period. */
const PERIOD_DAYS_MAX = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

const isDate = (value: string): boolean => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

function dateParam(url: URL, name: string, required: boolean): string | null | ValidationItem {
  const value = url.searchParams.get(name);
  if (value === null) return required ? queryError(name, 'missing', 'Field required') : null;
  if (!isDate(value)) return queryError(name, 'date_from_datetime_parsing', 'Input should be a valid date');
  const year = Number(value.slice(0, 4));
  return year < YEAR_MIN || year > YEAR_MAX
    ? queryError(name, 'value_error', `a day from ${String(YEAR_MIN)} to ${String(YEAR_MAX)}`)
    : value;
}

/**
 * The share of a limit that is spent, a percent to one decimal. A limit of nothing is used up from the
 * start, as the planner judges it (backend `_pct`).
 */
export const pctUsed = (spentMicros: number, limitUsd: number): number =>
  limitUsd <= 0 ? 100 : Math.round((spentMicros / 1_000_000 / limitUsd) * 1000) / 10;

const keyOf = (event: CostEvent, key: GroupKey): string => {
  switch (key) {
    case 'project':
      return event.project_id;
    case 'workload':
      return event.workload;
    case 'provider':
      return event.provider;
    case 'endpoint':
      return event.endpoint;
    case 'engine':
      return event.engine;
    case 'day':
      return event.day;
    case 'channel':
      return event.channel;
  }
};

/** Today in UTC, as the API's default dates are. */
const today = (): string => new Date().toISOString().slice(0, 10);

export const costHandlers: HttpHandler[] = [
  mock('get', `${W}/costs`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['from', 'to', 'group_by', 'filter[project_id]', 'filter[workload_in]', 'filter[provider_code]'],
    });
    if (caller instanceof Response) return caller;
    const url = caller.url;
    const from = dateParam(url, 'from', true);
    const to = dateParam(url, 'to', true);
    const groupBy = url.searchParams
      .getAll('group_by')
      .flatMap((value) => value.split(','))
      .filter((value) => value !== '');
    const projectId = url.searchParams.get('filter[project_id]');
    const workloads = url.searchParams
      .getAll('filter[workload_in]')
      .flatMap((value) => value.split(','))
      .filter((value) => value !== '');
    const provider = url.searchParams.get('filter[provider_code]');
    const errors: ValidationItem[] = [
      ...(typeof from === 'string' || from === null ? [] : [from]),
      ...(typeof to === 'string' || to === null ? [] : [to]),
      ...(groupBy.length > GROUP_BY.length
        ? [queryError('group_by', 'too_long', `At most ${String(GROUP_BY.length)} keys.`)]
        : groupBy.every((key) => GROUP_BY.some((allowed) => allowed === key))
          ? []
          : [queryError('group_by', 'enum', `Allowed: ${GROUP_BY.join(', ')}.`)]),
      ...(workloads.length > MAX_WORKLOADS
        ? [queryError('filter[workload_in]', 'too_long', `At most ${String(MAX_WORKLOADS)} workloads.`)]
        : workloads.every((workload) => COST_WORKLOADS.some((allowed) => allowed === workload))
          ? []
          : [queryError('filter[workload_in]', 'enum', `Allowed: ${COST_WORKLOADS.join(', ')}.`)]),
      ...(projectId === null
        ? []
        : uuidError(projectId, 'filter[project_id]').map((item) =>
            queryError('filter[project_id]', item.code, item.message),
          )),
      ...(provider !== null && provider.length > 64
        ? [queryError('filter[provider_code]', 'string_too_long', 'At most 64 characters.')]
        : []),
    ];
    if (errors.length > 0 || typeof from !== 'string' || typeof to !== 'string') return invalid(request, errors);
    // The period itself is checked once every parameter has read (the backend does it in the route)
    if (to < from) return invalid(request, [queryError('to', 'range_invalid', '`to` is on or after `from`.')]);
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS >= PERIOD_DAYS_MAX) {
      return invalid(request, [
        queryError('to', 'range_too_long', `A period of at most ${String(PERIOD_DAYS_MAX)} days.`),
      ]);
    }
    const keys = GROUP_BY.filter((key) => groupBy.includes(key));
    const visible = new Set(caller.projects.map((project) => project.project_id));
    // A project the caller cannot see, or that does not exist, is not found
    if (projectId !== null && !visible.has(projectId)) return problem(request, 'not_found');
    const events = costEvents(caller.operations, Date.now()).filter(
      (event) =>
        visible.has(event.project_id) &&
        event.day >= from &&
        event.day <= to &&
        (projectId === null || event.project_id === projectId) &&
        (workloads.length === 0 || workloads.includes(event.workload)) &&
        (provider === null || event.provider === provider),
    );
    const rows = new Map<
      string,
      { keys: Record<string, string>; micros: number; requests: number; subjects: number }
    >();
    for (const event of events) {
      const values = Object.fromEntries(keys.map((key) => [key, keyOf(event, key)]));
      const id = JSON.stringify(values);
      const row = rows.get(id) ?? { keys: values, micros: 0, requests: 0, subjects: 0 };
      row.micros += event.micros;
      row.requests += event.requests;
      row.subjects += event.subjects;
      rows.set(id, row);
    }
    const total = events.reduce((sum, event) => sum + event.micros, 0);
    const data = [...rows.values()]
      .sort((a, b) => b.micros - a.micros || JSON.stringify(a.keys).localeCompare(JSON.stringify(b.keys)))
      .map((row) => ({
        keys: row.keys,
        cost_usd: usdOfMicros(row.micros),
        request_count: row.requests,
        subjects: row.subjects,
      }));
    return HttpResponse.json({
      data,
      meta: {
        total_cost_usd: usdOfMicros(total),
        // Every Labs call reports its cost (D6)
        cost_sources: {
          provider_reported: usdOfMicros(total),
          computed_from_tokens: usdOfMicros(0),
          price_book_estimate: usdOfMicros(0),
        },
      },
    });
  }),

  mock('get', `${W}/budgets/status`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['month'],
    });
    if (caller instanceof Response) return caller;
    const month = caller.url.searchParams.get('month') ?? today().slice(0, 7);
    if (!MONTH.test(month)) {
      return invalid(request, [queryError('month', 'string_pattern_mismatch', 'A month as YYYY-MM.')]);
    }
    const limited = caller.access.membership.project_ids !== null;
    const projects = limited ? new Set(caller.projects.map((project) => project.project_id)) : null;
    const data = budgetReadings(caller.operations, budgetScopeOf(caller), month, Date.now(), projects).map(
      (reading) => {
        const limit = Number(reading.budget.limit_usd);
        return {
          budget: {
            budget_id: reading.budget.budget_id,
            project_id: reading.budget.project_id,
            workload: reading.budget.workload,
            period: 'month' as const,
            limit_usd: reading.budget.limit_usd,
            soft_limit_pct: reading.budget.soft_limit_pct,
            action_on_hard: reading.budget.action_on_hard,
            created_at: reading.budget.created_at,
          },
          spent_usd: usdOfMicros(reading.spentMicros),
          committed_estimate_usd: usdOfMicros(reading.committedMicros),
          // Percent of the limit spent, to one decimal
          pct_used: pctUsed(reading.spentMicros, limit),
          state: reading.state,
          blocked_runs: reading.blockedRuns,
        };
      },
    );
    return HttpResponse.json({ data });
  }),

  mock('get', `${W}/price-book`, ({ request, cookies, params }) => {
    const caller = operationsWorkspaceCaller(request, cookies, params.workspace_id, {
      permission: 'costs:read',
      query: ['filter[provider_code]', 'filter[endpoint]', 'valid_at', 'offset', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const provider = caller.url.searchParams.get('filter[provider_code]');
    const endpoint = caller.url.searchParams.get('filter[endpoint]');
    const validAt = dateParam(caller.url, 'valid_at', false);
    const paging = offsetPaging(caller.url);
    const errors: ValidationItem[] = [
      ...(typeof validAt === 'string' || validAt === null ? [] : [validAt]),
      ...(Array.isArray(paging) ? paging : []),
    ];
    if (errors.length > 0 || Array.isArray(paging) || (validAt !== null && typeof validAt !== 'string')) {
      return invalid(request, errors);
    }
    const at = validAt ?? today();
    const rows = MOCK_PRICES.filter(
      (price) =>
        (provider === null || price.provider_code === provider) &&
        (endpoint === null || price.endpoint === endpoint) &&
        price.valid_from <= at &&
        (price.valid_to === null || at < price.valid_to),
    ).map((price) => ({
      price_id: price.price_id,
      provider_code: price.provider_code,
      endpoint: price.endpoint,
      price_unit: price.price_unit,
      unit_price_usd: usdOfMicros(price.unit_price_micros),
      conditions: price.conditions,
      valid_from: price.valid_from,
      valid_to: price.valid_to,
      source_url: price.source_url,
      verified_at: price.verified_at,
    }));
    return HttpResponse.json(offsetPageOf(rows, paging));
  }),
];
