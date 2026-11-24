import { HttpResponse, type HttpHandler } from 'msw';

import { keywordProjectCaller } from './keyword-rules';
import {
  bodyError,
  cursorPage,
  enumError,
  extraMembers,
  isOneOf,
  isRecord,
  notAnObject,
  offsetPageOf,
  offsetPaging,
  pageRequest,
  textError,
} from './rules';
import { invalid, mock, noContent, problem } from '../respond';
import type { AlertEvent, AlertRule, AlertRuleType, RuleType, Severity, ValidationItem } from '@/lib/api/types';

/**
 * A project's alert rules and alerts (19 section 3.12, backend `api/alerts`): rules with a scope and the
 * params of their type, alerts with the evidence of what changed, acknowledged by id. The state lives in
 * memory, per project, and starts from the fixtures again on a reload (`resetAlertMocks` does it in tests).
 */

const P = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';
const RULE_TYPES: readonly RuleType[] = ['ai_mention_gained', 'ai_mention_lost', 'ai_competitor_appeared', 'rank_drop'];
const DEFAULT_SEVERITY: Record<RuleType, Severity> = {
  ai_mention_gained: 'info',
  ai_mention_lost: 'warning',
  ai_competitor_appeared: 'warning',
  rank_drop: 'warning',
};
const POSITIONS_MIN = 1;
const POSITIONS_MAX = 50;
const MAX_SCOPE_ITEMS = 50;
const MAX_ACKNOWLEDGE = 500;
const SEED_TIME = '2026-11-24T06:12:00.000Z';

interface AlertWorld {
  rules: AlertRule[];
  events: AlertEvent[];
}

const worlds = new Map<string, AlertWorld>();

/** Forgets every change, so the next read starts from the fixtures. */
export function resetAlertMocks(): void {
  worlds.clear();
}

const RULE_LOST = '6f1c0000-0000-4000-8000-000000000001';
const RULE_COMPETITOR = '6f1c0000-0000-4000-8000-000000000002';
const RULE_RANK = '6f1c0000-0000-4000-8000-000000000003';

function seed(): AlertWorld {
  const rule = (
    id: string,
    name: string,
    type: RuleType,
    params: Record<string, unknown>,
    active: boolean,
  ): AlertRule => ({
    id,
    name,
    rule_type: type,
    scope: { group_ids: [], engine_codes: [] },
    params,
    channels: ['in_app'],
    digest_mode: 'immediate',
    is_active: active,
    created_at: '2026-11-20T09:00:00.000Z',
    updated_at: '2026-11-20T09:00:00.000Z',
  });
  const event = (
    id: string,
    ruleId: string,
    type: RuleType,
    severity: Severity,
    label: string,
    evidence: Record<string, unknown>,
    acknowledged: boolean,
  ): AlertEvent => ({
    id,
    rule_id: ruleId,
    subject_type: type === 'rank_drop' ? 'keyword' : 'prompt',
    subject_id: `subject-${id}`,
    subject_label: label,
    event_kind: type,
    severity,
    evidence,
    occurred_at: SEED_TIME,
    acknowledged_by: acknowledged ? 'mock-user' : null,
    acknowledged_at: acknowledged ? SEED_TIME : null,
  });
  return {
    rules: [
      rule(RULE_LOST, 'Brand lost in an answer', 'ai_mention_lost', {}, true),
      rule(RULE_COMPETITOR, 'New competitor in event security', 'ai_competitor_appeared', {}, true),
      rule(RULE_RANK, 'Big keyword drops', 'rank_drop', { positions: 5 }, true),
    ],
    events: [
      event(
        '3',
        RULE_RANK,
        'rank_drop',
        'critical',
        'event security guards',
        { rank_event_id: '123', from_rank: 4, to_rank: 11, positions_lost: 7, positions: 5 },
        false,
      ),
      event(
        '2',
        RULE_COMPETITOR,
        'ai_competitor_appeared',
        'warning',
        'who provides festival security staff',
        {
          engine_code: 'gemini_web',
          run_id: 'run-2',
          before: { mentioning: 0, valid: 5 },
          after: { mentioning: 2, valid: 5 },
          competitor: { id: 'c-1', name: 'Halden Security' },
        },
        false,
      ),
      event(
        '1',
        RULE_LOST,
        'ai_mention_lost',
        'warning',
        'best event security companies in Chicago',
        {
          engine_code: 'chatgpt_web',
          run_id: 'run-1',
          before: { mentioning: 3, valid: 5 },
          after: { mentioning: 0, valid: 5 },
        },
        true,
      ),
    ],
  };
}

const worldOf = (projectId: string): AlertWorld => {
  const known = worlds.get(projectId);
  if (known !== undefined) return known;
  const fresh = seed();
  worlds.set(projectId, fresh);
  return fresh;
};

const typeRows = (): AlertRuleType[] =>
  RULE_TYPES.map((rule_type) => ({
    rule_type,
    channel: rule_type === 'rank_drop' ? 'seo' : 'ai',
    default_severity: DEFAULT_SEVERITY[rule_type],
    params_schema: {},
  }));

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The errors of a scope member, or the `invalid_params` detail of params that do not fit the type. */
function scopeErrors(scope: unknown, type: RuleType): ValidationItem[] {
  if (scope === undefined) return [];
  if (!isRecord(scope)) return [notAnObject('scope')];
  const errors = extraMembers(scope, ['group_ids', 'engine_codes'], 'scope');
  for (const name of ['group_ids', 'engine_codes'] as const) {
    const value = scope[name];
    if (value === undefined) continue;
    if (!stringList(value) || value.length > MAX_SCOPE_ITEMS) {
      errors.push(bodyError(`scope.${name}`, 'list_type', `A list of at most ${String(MAX_SCOPE_ITEMS)} texts.`));
    }
  }
  const codes = scope.engine_codes;
  if (type === 'rank_drop' && Array.isArray(codes) && codes.length > 0) {
    errors.push(bodyError('scope.engine_codes', 'not_for_rule_type', 'A rank rule has no platform.'));
  }
  return errors;
}

/** Whether `params` fit the rule type: `rank_drop` takes `positions` (1 to 50), the AI types take none. */
function paramsFit(params: unknown, type: RuleType): boolean {
  if (params === undefined) return true;
  if (!isRecord(params)) return false;
  const keys = Object.keys(params);
  if (type !== 'rank_drop') return keys.length === 0;
  const { positions } = params;
  return (
    keys.every((key) => key === 'positions') &&
    (positions === undefined ||
      (typeof positions === 'number' &&
        Number.isInteger(positions) &&
        positions >= POSITIONS_MIN &&
        positions <= POSITIONS_MAX))
  );
}

const withDefaults = (params: unknown, type: RuleType): Record<string, unknown> =>
  type === 'rank_drop' ? { positions: 5, ...(isRecord(params) ? params : {}) } : {};

const normalScope = (scope: unknown): AlertRule['scope'] => ({
  group_ids: isRecord(scope) && stringList(scope.group_ids) ? scope.group_ids : [],
  engine_codes: isRecord(scope) && stringList(scope.engine_codes) ? scope.engine_codes : [],
});

export const alertHandlers: HttpHandler[] = [
  mock('get', '/api/v1/alert-rule-types', () => HttpResponse.json({ data: typeRows() })),

  mock('get', `${P}/alert-rules`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[is_active]', 'filter[rule_type_in]', 'offset', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const paging = offsetPaging(caller.url);
    if (Array.isArray(paging)) return invalid(request, paging);
    return HttpResponse.json(offsetPageOf(worldOf(caller.project.project_id).rules, paging));
  }),

  mock('post', `${P}/alert-rules`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'alerts:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const type = body.rule_type;
    const errors = [
      ...extraMembers(body, ['name', 'rule_type', 'scope', 'params', 'is_active']),
      ...(typeof body.name === 'string'
        ? textError(body.name.trim(), 'name', { max: 120 })
        : [bodyError('name', 'missing', 'Field required')]),
      ...(type === undefined
        ? [bodyError('rule_type', 'missing', 'Field required')]
        : enumError(type, 'rule_type', RULE_TYPES)),
    ];
    if (errors.length > 0 || !isOneOf(type, RULE_TYPES) || typeof body.name !== 'string') {
      return invalid(request, errors);
    }
    const scopeProblems = scopeErrors(body.scope, type);
    if (scopeProblems.length > 0) return invalid(request, scopeProblems);
    if (!paramsFit(body.params, type)) {
      return problem(request, 'invalid_params', { detail: 'These params do not fit the rule type.', rule_type: type });
    }
    const now = new Date().toISOString();
    const rule: AlertRule = {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      rule_type: type,
      scope: normalScope(body.scope),
      params: withDefaults(body.params, type),
      channels: ['in_app'],
      digest_mode: 'immediate',
      is_active: typeof body.is_active === 'boolean' ? body.is_active : true,
      created_at: now,
      updated_at: now,
    };
    worldOf(caller.project.project_id).rules.push(rule);
    return HttpResponse.json({ data: rule }, { status: 201 });
  }),

  mock('get', `${P}/alert-rules/{alert_rule_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
    });
    if (caller instanceof Response) return caller;
    const rule = worldOf(caller.project.project_id).rules.find((row) => row.id === params.alert_rule_id);
    return rule === undefined ? problem(request, 'not_found') : HttpResponse.json({ data: rule });
  }),

  mock('patch', `${P}/alert-rules/{alert_rule_id}`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'alerts:write',
    });
    if (caller instanceof Response) return caller;
    const rule = worldOf(caller.project.project_id).rules.find((row) => row.id === params.alert_rule_id);
    if (rule === undefined) return problem(request, 'not_found');
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const errors = [
      ...extraMembers(body, ['name', 'scope', 'params', 'is_active']),
      ...(body.name === undefined || body.name === null ? [] : textError(body.name, 'name', { max: 120 })),
      ...(body.scope === undefined || body.scope === null ? [] : scopeErrors(body.scope, rule.rule_type)),
    ];
    if (errors.length > 0) return invalid(request, errors);
    if (body.params !== undefined && body.params !== null && !paramsFit(body.params, rule.rule_type)) {
      return problem(request, 'invalid_params', {
        detail: 'These params do not fit the rule type.',
        rule_type: rule.rule_type,
      });
    }
    if (typeof body.name === 'string') rule.name = body.name.trim();
    if (body.scope !== undefined && body.scope !== null) rule.scope = normalScope(body.scope);
    if (body.params !== undefined && body.params !== null) rule.params = withDefaults(body.params, rule.rule_type);
    if (typeof body.is_active === 'boolean') rule.is_active = body.is_active;
    rule.updated_at = new Date().toISOString();
    return HttpResponse.json({ data: rule });
  }),

  mock('delete', `${P}/alert-rules/{alert_rule_id}`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'alerts:write',
    });
    if (caller instanceof Response) return caller;
    const world = worldOf(caller.project.project_id);
    if (!world.rules.some((row) => row.id === params.alert_rule_id)) return problem(request, 'not_found');
    world.rules = world.rules.filter((row) => row.id !== params.alert_rule_id);
    world.events = world.events.filter((row) => row.rule_id !== params.alert_rule_id);
    return noContent();
  }),

  mock('get', `${P}/alert-events`, ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'data:read',
      query: ['filter[acknowledged]', 'filter[rule_id]', 'cursor', 'limit'],
    });
    if (caller instanceof Response) return caller;
    const paging = pageRequest(caller.url);
    if (Array.isArray(paging)) return invalid(request, paging);
    const acknowledged = caller.url.searchParams.get('filter[acknowledged]');
    const ruleId = caller.url.searchParams.get('filter[rule_id]');
    const rows = worldOf(caller.project.project_id)
      .events.filter(
        (row) =>
          (acknowledged === null || (row.acknowledged_at !== null) === (acknowledged === 'true')) &&
          (ruleId === null || row.rule_id === ruleId),
      )
      .sort((a, b) => Number(b.id) - Number(a.id));
    const page = cursorPage(rows, paging, `${acknowledged ?? ''}|${ruleId ?? ''}`);
    return page === null ? problem(request, 'invalid_cursor') : HttpResponse.json(page);
  }),

  mock('post', `${P}/alert-events/acknowledge`, async ({ request, cookies, params }) => {
    const caller = keywordProjectCaller(request, cookies, params.workspace_id, params.project_id, {
      permission: 'alerts:write',
    });
    if (caller instanceof Response) return caller;
    const body: unknown = await request.json();
    if (!isRecord(body)) return invalid(request, [notAnObject()]);
    const { ids } = body;
    if (!stringList(ids) || ids.length < 1 || ids.length > MAX_ACKNOWLEDGE) {
      return invalid(request, [bodyError('ids', 'list_length', `Between 1 and ${String(MAX_ACKNOWLEDGE)} ids.`)]);
    }
    const now = new Date().toISOString();
    let acknowledged = 0;
    for (const event of worldOf(caller.project.project_id).events) {
      if (ids.includes(event.id) && event.acknowledged_at === null) {
        event.acknowledged_at = now;
        event.acknowledged_by = caller.session.user.user_id;
        acknowledged += 1;
      }
    }
    return HttpResponse.json({ data: { acknowledged } });
  }),
];
