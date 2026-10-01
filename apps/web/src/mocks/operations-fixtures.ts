import { MOCK_GROUP_IDS, MOCK_TRACKED_KEYWORDS, fixtureReading, FYNIX_PROJECT_ID } from './keyword-fixtures';
import { MOCK_CREATED_AT, MOCK_USERS, MOCK_WORKSPACE } from './fixtures';
import { mockId } from './mock-ids';
import type { StoredRun, StoredSchedule } from './operations-state';

/**
 * The schedules, runs, budgets and prices the mocks start from (backend plan D8 to D14). Fynix got its
 * monthly keyword metrics schedule with its first tracked keyword in June, and a daily rank schedule and a
 * paused weekly one this week (rank runs start with part 2). Its runs are the keyword metrics runs of the
 * summer: one system run per new keyword a minute after it was added (D8), the schedule's run on the 20th of
 * each month, the owner's manual refresh of 24 September, and the failed run of the three keywords added
 * yesterday, which are still waiting for metrics. Costs are read from these runs.
 */

const owner = MOCK_USERS[0]?.user_id ?? null;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TIMEZONE = 'Europe/Berlin';

export const MOCK_SCHEDULE_IDS = {
  keywordMetrics: mockId('schedule', 1),
  dailyRanks: mockId('schedule', 2),
  weeklyContent: mockId('schedule', 3),
} as const;

/** The first tracked keyword of Fynix: its keyword metrics schedule was made with it (D8). */
const FIRST_TRACKED_AT = MOCK_TRACKED_KEYWORDS.map((row) => row.created_at).sort()[0] ?? MOCK_CREATED_AT;

export const MOCK_SCHEDULES: readonly StoredSchedule[] = [
  {
    schedule_id: MOCK_SCHEDULE_IDS.keywordMetrics,
    project_id: FYNIX_PROJECT_ID,
    name: 'Keyword metrics',
    workload: 'keyword_metrics',
    cadence: 'monthly',
    weekday: null,
    month_day: 20,
    window_start_local: '03:00:00',
    window_hours: 2,
    timezone: TIMEZONE,
    priority: 'standard',
    provider_mode: 'live',
    selector: { stale_days: 25 },
    is_active: true,
    created_at: FIRST_TRACKED_AT,
    deleted_at: null,
  },
  {
    schedule_id: MOCK_SCHEDULE_IDS.dailyRanks,
    project_id: FYNIX_PROJECT_ID,
    name: 'Daily rankings',
    workload: 'seo_rank',
    cadence: 'daily',
    weekday: null,
    month_day: null,
    window_start_local: '02:00:00',
    window_hours: 6,
    timezone: TIMEZONE,
    priority: 'standard',
    provider_mode: 'standard_queue',
    selector: { all: true },
    is_active: true,
    created_at: '2026-09-29T10:00:00.000Z',
    deleted_at: null,
  },
  {
    schedule_id: MOCK_SCHEDULE_IDS.weeklyContent,
    project_id: FYNIX_PROJECT_ID,
    name: 'Content keywords, weekly',
    workload: 'seo_rank',
    cadence: 'weekly',
    weekday: 1,
    month_day: null,
    window_start_local: '02:00:00',
    window_hours: 6,
    timezone: TIMEZONE,
    priority: 'low',
    provider_mode: 'standard_queue',
    selector: { groups: [MOCK_GROUP_IDS.content] },
    is_active: false,
    created_at: '2026-09-29T10:05:00.000Z',
    deleted_at: null,
  },
];

/** One Labs reading to fetch: a keyword at a location and language, first tracked at `since`. */
interface Reading {
  key: string;
  place: string;
  since: number;
  hasMetrics: boolean;
}

/** The readings the fixture keywords need, in the order they were first tracked. */
const READINGS: readonly Reading[] = (() => {
  const found = new Map<string, Reading>();
  for (const row of MOCK_TRACKED_KEYWORDS) {
    const place = `${String(row.location_id)}:${row.language_code}`;
    const key = `${row.keyword_id}:${place}`;
    const since = Date.parse(row.created_at);
    const known = found.get(key);
    if (known === undefined || since < known.since) {
      found.set(key, {
        key,
        place,
        since,
        hasMetrics: fixtureReading(row.keyword_id, row.location_id, row.language_code) !== null,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.since - b.since);
})();

const iso = (ms: number): string => new Date(ms).toISOString();

interface RunSeed {
  at: number;
  scheduleId: string | null;
  createdBy: string | null;
  readings: readonly Reading[];
  staleDays: number | null;
  ending: StoredRun['ending'];
  reason: string | null;
}

const seeds: RunSeed[] = [];
// D8: a system run a minute after each new keyword; the three added yesterday failed
for (const reading of READINGS.filter((candidate) => candidate.hasMetrics)) {
  seeds.push({
    at: reading.since + MINUTE_MS,
    scheduleId: null,
    createdBy: null,
    readings: [reading],
    staleDays: null,
    ending: 'completed',
    reason: null,
  });
}
const pending = READINGS.filter((reading) => !reading.hasMetrics);
const pendingSince = Math.max(...pending.map((reading) => reading.since));
seeds.push({
  at: pendingSince + MINUTE_MS,
  scheduleId: null,
  createdBy: null,
  readings: pending,
  staleDays: null,
  ending: 'failed',
  reason: 'DataForSEO Labs did not answer in time after 3 attempts. These keywords are tried again in 24 hours.',
});
// The monthly schedule: 03:00 in Berlin (01:00 UTC in summer) on the 20th, keywords not fetched for 25 days
for (const month of ['06', '07', '08', '09']) {
  const at = Date.parse(`2026-${month}-20T01:00:00.000Z`);
  const stale = READINGS.filter((reading) => reading.hasMetrics && reading.since < at - 25 * DAY_MS);
  seeds.push({
    at,
    scheduleId: MOCK_SCHEDULE_IDS.keywordMetrics,
    createdBy: null,
    readings: stale,
    staleDays: 25,
    ending: 'completed',
    reason: null,
  });
}
// The owner's refresh of every keyword, whose metrics the fixtures show (fetched at 03:12)
seeds.push({
  at: Date.parse('2026-09-24T03:10:00.000Z'),
  scheduleId: null,
  createdBy: owner,
  readings: READINGS.filter((reading) => reading.hasMetrics && reading.since < Date.parse('2026-09-24T03:10:00Z')),
  staleDays: null,
  ending: 'completed',
  reason: null,
});

export const MOCK_RUNS: readonly StoredRun[] = seeds
  .filter((seed) => seed.readings.length > 0)
  .sort((a, b) => a.at - b.at)
  .map((seed, index): StoredRun => ({
    run_id: mockId('run', index + 1),
    project_id: FYNIX_PROJECT_ID,
    schedule_id: seed.scheduleId,
    workload: 'keyword_metrics',
    trigger: seed.scheduleId === null ? 'manual' : 'schedule',
    created_at: iso(seed.at),
    created_by: seed.createdBy,
    tasks_total: seed.readings.length,
    tasks_failed: seed.ending === 'failed' ? seed.readings.length : 0,
    calls: new Set(seed.readings.map((reading) => reading.place)).size,
    keyword_count: seed.staleDays === null ? seed.readings.length : null,
    stale_days: seed.staleDays,
    ending: seed.ending,
    status_reason: seed.reason,
    blocked_by_budget_id: null,
    cancelled_at: null,
    cancel_reason: null,
  }));

// Budgets (ops.budgets) and the price book (D14)

export const BUDGET_GROUPS = [
  'seo_rank',
  'ai_prompt',
  'keyword_research',
  'ai_benchmark',
  'extraction_llm',
  'first_party',
  'all',
] as const;
export type BudgetGroup = (typeof BUDGET_GROUPS)[number];

export interface StoredBudget {
  budget_id: string;
  workspace_id: string;
  /** `null` for the whole workspace. */
  project_id: string | null;
  workload: BudgetGroup;
  limit_usd: string;
  soft_limit_pct: number;
  action_on_hard: 'pause' | 'alert_only';
  created_at: string;
}

export const MOCK_BUDGET_IDS = {
  workspace: mockId('budget', 1),
  fynixRanks: mockId('budget', 2),
  fynixResearch: mockId('budget', 3),
} as const;

export const MOCK_BUDGETS: readonly StoredBudget[] = [
  {
    budget_id: MOCK_BUDGET_IDS.workspace,
    workspace_id: MOCK_WORKSPACE.workspace_id,
    project_id: null,
    workload: 'all',
    limit_usd: '250.00',
    soft_limit_pct: 80,
    action_on_hard: 'pause',
    created_at: MOCK_CREATED_AT,
  },
  {
    budget_id: MOCK_BUDGET_IDS.fynixRanks,
    workspace_id: MOCK_WORKSPACE.workspace_id,
    project_id: FYNIX_PROJECT_ID,
    workload: 'seo_rank',
    limit_usd: '40.00',
    soft_limit_pct: 80,
    action_on_hard: 'pause',
    created_at: '2026-09-29T10:00:00.000Z',
  },
  {
    budget_id: MOCK_BUDGET_IDS.fynixResearch,
    workspace_id: MOCK_WORKSPACE.workspace_id,
    project_id: FYNIX_PROJECT_ID,
    workload: 'keyword_research',
    limit_usd: '0.50',
    soft_limit_pct: 80,
    action_on_hard: 'alert_only',
    created_at: FIRST_TRACKED_AT,
  },
];

export interface StoredPrice {
  price_id: string;
  provider_code: string;
  endpoint: string;
  price_unit: string;
  /** Micro-dollars, so sums stay exact. */
  unit_price_micros: number;
  conditions: Record<string, unknown>;
  valid_from: string;
  valid_to: string | null;
  source_url: string;
  verified_at: string;
}

/** Labs prices of doc 27 section 1, verified on 29 September 2026; SERP prices arrive with rank collection. */
const LABS_SOURCE = 'https://dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api';
const LABS_VERIFIED = '2026-09-29';
const LABS_ENDPOINTS = [
  'keyword_overview',
  'historical_keyword_data',
  'keyword_ideas',
  'keyword_suggestions',
  'related_keywords',
  'ranked_keywords',
  'domain_intersection',
  'bulk_keyword_difficulty',
] as const;

/** Labs `keyword_overview`: the endpoint keyword metrics call, per call and per keyword (D6). */
export const KEYWORD_OVERVIEW_ENDPOINT = 'dataforseo_labs/google/keyword_overview/live';
export const LABS_TASK_MICROS = 12_000;
export const LABS_ITEM_MICROS = 120;

export const MOCK_PRICES: readonly StoredPrice[] = LABS_ENDPOINTS.flatMap((name, index) => {
  const endpoint = `dataforseo_labs/google/${name}/live`;
  const common = {
    provider_code: 'dataforseo',
    endpoint,
    valid_from: LABS_VERIFIED,
    valid_to: null,
    source_url: LABS_SOURCE,
    verified_at: LABS_VERIFIED,
  };
  return [
    {
      ...common,
      price_id: mockId('price', index * 2 + 1),
      price_unit: 'task',
      unit_price_micros: LABS_TASK_MICROS,
      conditions: {},
    },
    {
      ...common,
      price_id: mockId('price', index * 2 + 2),
      price_unit: 'item',
      unit_price_micros: LABS_ITEM_MICROS,
      conditions: name === 'keyword_overview' ? { max_items_per_task: 700 } : {},
    },
  ];
});
