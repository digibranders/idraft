import type { BudgetStatus, EngineCode, ProjectEngine, Run, Schedule } from '@/lib/api/types';

/*
 * What the tests of the activity cards share: a run, a schedule, a budget status and a project engine written
 * with the fields a test cares about. Not a test file.
 */

/** The engines of the mock world, as `GET engines` lists them (the labels the cards show). */
const ENGINE_FACTS: Readonly<Record<EngineCode, ProjectEngine['engine']>> = {
  chatgpt_web: {
    engine_code: 'chatgpt_web',
    label: 'ChatGPT',
    observation_class: 'consumer_ui',
    vendor: 'openai',
    exposes_citations: true,
    exposes_fanout: true,
    max_prompt_chars: 2000,
  },
  gemini_web: {
    engine_code: 'gemini_web',
    label: 'Gemini',
    observation_class: 'consumer_ui',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 2000,
  },
  google_ai_mode: {
    engine_code: 'google_ai_mode',
    label: 'Google AI Mode',
    observation_class: 'serp_ai',
    vendor: 'google',
    exposes_citations: true,
    exposes_fanout: false,
    max_prompt_chars: 700,
  },
};

const uuid = (kind: number, n: number): string =>
  `${String(kind).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;

type RunStatus = Run['status'];

export interface RunSpec {
  n: number;
  status?: RunStatus;
  createdAt?: string;
  completedAt?: string | null;
  succeeded?: number;
  failed?: number;
  total?: number;
  workload?: Run['workload'];
}

/** A run of the AI workload; counts default to a finished run with 238 of 250 answers collected. */
export function run({
  n,
  status = 'completed_with_errors',
  createdAt = '2026-11-12T01:10:00Z',
  completedAt = '2026-11-12T02:10:00Z',
  succeeded = 238,
  failed = 12,
  total = 250,
  workload = 'ai_prompt',
}: RunSpec): Run {
  return {
    run_id: uuid(1, n),
    project_id: uuid(2, 1),
    schedule_id: null,
    workload,
    trigger: 'schedule',
    created_at: createdAt,
    completed_at: completedAt,
    created_by: null,
    estimated_cost_usd: null,
    actual_cost_usd: null,
    blocked_by_budget_id: status === 'budget_blocked' ? uuid(3, 1) : null,
    status,
    status_reason: null,
    tasks_total: total,
    tasks_succeeded: succeeded,
    tasks_failed: failed,
    window_start: createdAt,
    window_end: createdAt,
    operation: {
      kind: 'collection_run',
      status: 'succeeded',
      started_at: createdAt,
      finished_at: completedAt,
      error: null,
      links: { self: `/runs/${String(n)}` },
      progress: { done: succeeded + failed, total, unit: 'tasks' },
    },
  };
}

export interface ScheduleSpec {
  n: number;
  cadence?: Schedule['cadence'];
  weekday?: number | null;
  active?: boolean;
  nextRunAt?: string;
  workload?: Schedule['workload'];
}

export function schedule({
  n,
  cadence = 'weekly',
  weekday = 1,
  active = true,
  nextRunAt = '2026-11-16T19:30:00Z',
  workload = 'ai_prompt',
}: ScheduleSpec): Schedule {
  return {
    schedule_id: uuid(4, n),
    project_id: uuid(2, 1),
    name: `AI answers ${String(n)}`,
    workload,
    cadence,
    cron_expr: cadence === 'cron' ? '0 1 * * *' : null,
    weekday,
    month_day: cadence === 'monthly' ? 1 : null,
    window_start_local: '01:00:00',
    window_hours: 8,
    timezone: 'UTC',
    priority: 'standard',
    provider_mode: 'standard_queue',
    selector: { all: true },
    is_active: active,
    created_at: '2026-06-01T09:00:00Z',
    last_run_id: null,
    next_run_at: nextRunAt,
  };
}

export interface BudgetSpec {
  n?: number;
  projectId?: string | null;
  workload?: BudgetStatus['budget']['workload'];
  limit?: string;
  spent?: string;
  committed?: string;
  pct?: number;
  soft?: number;
  state?: BudgetStatus['state'];
  action?: BudgetStatus['budget']['action_on_hard'];
  blocked?: number;
}

/** The project of the fixtures, for a budget that belongs to it. */
export const FIXTURE_PROJECT_ID = uuid(2, 1);

export function budgetStatus({
  n = 1,
  projectId = null,
  workload = 'ai_prompt',
  limit = '50.000000',
  spent = '12.400000',
  committed = '0.000000',
  pct = 24.8,
  soft = 80,
  state = 'ok',
  action = 'pause',
  blocked = 0,
}: BudgetSpec = {}): BudgetStatus {
  return {
    budget: {
      budget_id: uuid(3, n),
      project_id: projectId,
      workload,
      period: 'month',
      limit_usd: limit,
      soft_limit_pct: soft,
      action_on_hard: action,
      created_at: '2026-06-01T09:00:00Z',
    },
    spent_usd: spent,
    committed_estimate_usd: committed,
    pct_used: pct,
    state,
    blocked_runs: blocked,
  };
}

/** A project engine; `cost` null is a price the book does not have. */
export function projectEngine(
  code: EngineCode,
  { on = true, cost = '24.180000' }: { on?: boolean; cost?: string | null } = {},
): ProjectEngine {
  return {
    engine: ENGINE_FACTS[code],
    is_configured: true,
    is_enabled: on,
    location_ids: [],
    replicates: 1,
    provider_code: 'dataforseo',
    active_prompts: 24,
    estimated_monthly_cost_usd: cost,
  };
}
