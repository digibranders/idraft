import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MANUAL_RUN_LIMIT } from './operations-rules';
import { RUN_PLANNED_MS, RUN_WORKING_MS } from '../factories/operations';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { MOCK_KEYWORDS, MOCK_TRACKED_KEYWORDS } from '../keyword-fixtures';
import { MOCK_RUNS, MOCK_SCHEDULE_IDS } from '../operations-fixtures';
import { mockId } from '../mock-ids';
import { CURSOR_PAGE, RUN, RUN_DETAIL } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const RUNS = z.array(RUN);
const MANUAL_META = z.object({ manual_runs_today: z.object({ limit: z.number(), used: z.number() }) });
const NOON = Date.parse('2026-10-01T12:00:00Z');

let clock = NOON;
const tick = (ms: number): void => {
  clock += ms;
};

beforeEach(() => {
  clock = NOON;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The keyword id of a fixture keyword by its text. */
const keywordIdOf = (text: string): string => {
  const found = MOCK_KEYWORDS.find((keyword) => keyword.text === text);
  if (found === undefined) throw new Error(`No keyword ${text}`);
  return found.keyword_id;
};

describe('runs', () => {
  it('lists the project runs newest first with the manual runs of the day, filtered by status and trigger', async () => {
    const viewer = mockBrowser('viewer');
    const answer = await viewer.call('GET', `${P}/runs?limit=5`);
    const runs = dataOf(answer, RUNS);
    expect(runs[0]).toMatchObject({
      status: 'failed',
      trigger: 'manual',
      created_by: { actor_type: 'system' },
      tasks_total: 3,
      tasks_failed: 3,
      actual_cost_usd: '0.000000',
      operation: { status: 'failed', error: { code: 'provider_timeout' } },
    });
    expect(pageOf(answer, CURSOR_PAGE).has_more).toBe(true);
    expect(MANUAL_META.parse(answer.body.meta).manual_runs_today).toEqual({ limit: MANUAL_RUN_LIMIT, used: 0 });
    const scheduled = dataOf(await viewer.call('GET', `${P}/runs?filter[trigger_in]=schedule&limit=50`), RUNS);
    expect(scheduled.map((run) => run.created_at.slice(0, 10))).toEqual(['2026-09-20', '2026-08-20', '2026-07-20']);
    expect(scheduled.every((run) => run.schedule_id === MOCK_SCHEDULE_IDS.keywordMetrics)).toBe(true);
    const failed = dataOf(await viewer.call('GET', `${P}/runs?filter[status_in]=failed,cancelled`), RUNS);
    expect(failed).toHaveLength(1);
    expect(fieldCodes(await viewer.call('GET', `${P}/runs?filter[status_in]=done`))).toEqual([
      'filter[status_in]:enum',
    ]);
  });

  it('gives a run its tasks by status and what it was asked for', async () => {
    const owners = MOCK_RUNS.find((run) => run.created_by !== null);
    if (owners === undefined) throw new Error('No manual fixture run');
    const detail = dataOf(await mockBrowser('viewer').call('GET', `${P}/runs/${owners.run_id}`), RUN_DETAIL);
    expect(detail).toMatchObject({
      status: 'completed',
      created_by: { actor_type: 'user', label: mockUser('owner').name },
      tasks_by_status: { ingested: owners.tasks_total },
      config_snapshot: { workload: 'keyword_metrics', selector: { keyword_count: owners.tasks_total } },
    });
    // One Labs call per location and language, plus each keyword
    const expected = owners.calls * 12_000 + owners.tasks_total * 120;
    expect(detail.actual_cost_usd).toBe(`0.${String(expected).padStart(6, '0')}`);
  });

  it('refreshes stale metrics as a manual run that is planned, runs and completes', async () => {
    const analyst = mockBrowser('analyst');
    const answer = await analyst.call('POST', `${P}/keyword-metrics/refresh`, {});
    expect(answer.status).toBe(202);
    const run = dataOf(answer, RUN);
    // The fixture metrics are a week old: only the three keywords still waiting are stale
    expect(run).toMatchObject({
      workload: 'keyword_metrics',
      trigger: 'manual',
      status: 'planned',
      tasks_total: 3,
      estimated_cost_usd: '0.012360',
      actual_cost_usd: null,
      operation: { status: 'queued', links: { cancel: `${P}/runs/${run.run_id}/cancel` } },
    });
    tick(RUN_PLANNED_MS + RUN_WORKING_MS / 2);
    const running = dataOf(await analyst.call('GET', `${P}/runs/${run.run_id}`), RUN_DETAIL);
    expect(running).toMatchObject({ status: 'running', tasks_by_status: { ingested: 1, pending: 2 } });
    tick(RUN_WORKING_MS);
    const done = dataOf(await analyst.call('GET', `${P}/runs/${run.run_id}`), RUN_DETAIL);
    expect(done).toMatchObject({ status: 'completed', tasks_succeeded: 3, actual_cost_usd: '0.012360' });
    const listed = await analyst.call('GET', `${P}/runs?limit=1`);
    expect(MANUAL_META.parse(listed.body.meta).manual_runs_today.used).toBe(1);
    // Every active keyword, location and language when nothing counts as fresh
    const all = dataOf(await analyst.call('POST', `${P}/keyword-metrics/refresh`, { stale_days: 0 }), RUN);
    const readings = new Set(
      MOCK_TRACKED_KEYWORDS.filter((row) => row.is_active).map(
        (row) => `${row.keyword_id}:${String(row.location_id)}:${row.language_code}`,
      ),
    );
    expect(all.tasks_total).toBe(readings.size);
  });

  it('refreshes the keywords named, and refuses ones the project does not track', async () => {
    const editor = mockBrowser('editor');
    const run = dataOf(
      await editor.call('POST', `${P}/keyword-metrics/refresh`, { keyword_ids: [keywordIdOf('seo audit')] }),
      RUN,
    );
    // "seo audit" is tracked in Germany and in the United States
    expect(run.tasks_total).toBe(2);
    expect(
      fieldCodes(await editor.call('POST', `${P}/keyword-metrics/refresh`, { keyword_ids: [mockId('keyword', 999)] })),
    ).toEqual(['keyword_ids:keyword_unknown']);
    expect(await editor.as('viewer').call('POST', `${P}/keyword-metrics/refresh`, {})).toMatchObject({
      status: 403,
    });
  });

  it('allows 20 manual runs a project a day and answers 429 with the wait after that', async () => {
    const editor = mockBrowser('editor');
    for (let index = 0; index < MANUAL_RUN_LIMIT; index += 1) {
      expect((await editor.call('POST', `${P}/keyword-metrics/refresh`, {})).status).toBe(202);
    }
    const refused = await editor.call('POST', `${P}/keyword-metrics/refresh`, {});
    expect(refused).toMatchObject({
      status: 429,
      code: 'manual_run_limit',
      body: { limit: MANUAL_RUN_LIMIT, used: MANUAL_RUN_LIMIT, retry_after_seconds: 12 * 60 * 60 },
    });
    // A new day, a new count
    tick(12 * 60 * 60 * 1000);
    expect((await editor.call('POST', `${P}/keyword-metrics/refresh`, {})).status).toBe(202);
  });

  it('cancels a run that has not ended: a manual run its starter cancels, any run with schedules:write', async () => {
    const analyst = mockBrowser('analyst');
    const run = dataOf(await analyst.call('POST', `${P}/keyword-metrics/refresh`, {}), RUN);
    const cancelled = await analyst.call('POST', `${P}/runs/${run.run_id}/cancel`, { reason: 'Started by mistake' });
    expect(dataOf(cancelled, RUN)).toMatchObject({
      status: 'cancelled',
      status_reason: 'Started by mistake',
      actual_cost_usd: '0.000000',
    });
    expect(await analyst.call('POST', `${P}/runs/${run.run_id}/cancel`)).toMatchObject({
      status: 409,
      code: 'invalid_state_transition',
    });
    const editors = dataOf(await analyst.as('editor').call('POST', `${P}/keyword-metrics/refresh`, {}), RUN);
    expect(await analyst.call('POST', `${P}/runs/${editors.run_id}/cancel`)).toMatchObject({ status: 403 });
    expect((await analyst.as('admin').call('POST', `${P}/runs/${editors.run_id}/cancel`)).status).toBe(200);
  });

  it('lists the workspace runs of the projects the member sees, by project and by time', async () => {
    const analyst = mockBrowser('analyst');
    // `from` and `to` are instants: created at or after `from`, and before `to`
    const september = dataOf(
      await analyst.call(
        'GET',
        `${W}/runs?filter[project_id]=${fynix.project_id}&from=2026-09-20T00:00:00Z&to=2026-09-25T00:00:00Z&limit=50`,
      ),
      RUNS,
    );
    expect(september.every((run) => run.created_at >= '2026-09-20' && run.created_at < '2026-09-25')).toBe(true);
    expect(september.map((run) => run.trigger)).toContain('schedule');
    const eventus = MOCK_PROJECTS.find((project) => project.slug === 'eventus-security');
    const other = dataOf(await analyst.call('GET', `${W}/runs?filter[project_id]=${eventus?.project_id ?? ''}`), RUNS);
    expect(other).toEqual([]);
    expect(fieldCodes(await analyst.call('GET', `${W}/runs?from=yesterday`))).toEqual([
      'from:datetime_from_date_parsing',
    ]);
  });

  it('lists a project’s runs by the time they were created, given with its zone', async () => {
    const analyst = mockBrowser('analyst');
    const all = dataOf(await analyst.call('GET', `${P}/runs?limit=50`), RUNS);
    expect(all.length).toBeGreaterThan(0);
    expect(dataOf(await analyst.call('GET', `${P}/runs?from=2100-01-01T00:00:00Z`), RUNS)).toEqual([]);
    expect(dataOf(await analyst.call('GET', `${P}/runs?to=2000-01-01T00:00:00%2B02:00`), RUNS)).toEqual([]);
    // A date, or a time without a zone, is not an instant
    expect(fieldCodes(await analyst.call('GET', `${P}/runs?from=2026-09-20`))).toEqual(['from:timezone_aware']);
    expect(fieldCodes(await analyst.call('GET', `${P}/runs?to=2026-09-20T00:00:00`))).toEqual(['to:timezone_aware']);
    const many = Array.from({ length: 21 }, () => 'planned').join(',');
    expect(fieldCodes(await analyst.call('GET', `${P}/runs?filter[status_in]=${many}`))).toEqual([
      'filter[status_in]:too_long',
    ]);
  });

  it('refuses a cancel to a member who may cancel no run, before it looks the run up', async () => {
    const viewer = mockBrowser('viewer');
    expect(await viewer.call('POST', `${P}/runs/${mockId('run', 999)}/cancel`)).toMatchObject({ status: 403 });
  });
});
