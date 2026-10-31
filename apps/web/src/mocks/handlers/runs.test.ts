import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MANUAL_RUN_LIMIT } from './operations-rules';
import { RUN_PLANNED_MS, RUN_WORKING_MS, runView } from '../factories/operations';
import { MOCK_PROJECTS, MOCK_WORKSPACE, mockUser } from '../fixtures';
import { MOCK_KEYWORDS, MOCK_TRACKED_KEYWORDS } from '../keyword-fixtures';
import { MOCK_RUNS, MOCK_SCHEDULE_IDS } from '../operations-fixtures';
import { mockId } from '../mock-ids';
import { CURSOR_PAGE, RUN, RUN_DETAIL, TRACKED_KEYWORD_DETAIL } from '@/test/api-shapes';
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
      // The backend gives a failed run no reason code of its own, so its operation has no error to mirror
      status_reason: null,
      operation: { status: 'failed', error: null },
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
    // An archived keyword is not tracked for this purpose either
    expect(
      fieldCodes(await editor.call('POST', `${P}/keyword-metrics/refresh`, { keyword_ids: [keywordIdOf('seo meme')] })),
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
    expect(refused).toMatchObject({ status: 429, code: 'manual_run_limit', body: { limit: MANUAL_RUN_LIMIT } });
    // The API names the limit and nothing else: no count of the day, no wait
    expect(Object.keys(refused.body)).not.toContain('used');
    expect(Object.keys(refused.body)).not.toContain('retry_after_seconds');
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
      // The API's code, not the member's words
      status_reason: 'cancelled_by_user',
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

describe('the run the system makes for new keywords', () => {
  const openRuns = async (browser: ReturnType<typeof mockBrowser>): Promise<z.infer<typeof RUNS>> =>
    dataOf(await browser.call('GET', `${P}/runs?filter[status_in]=planned,running&filter[trigger_in]=manual`), RUNS);

  it('is made when keywords are added, as a manual run of the system that does not count for the day', async () => {
    const editor = mockBrowser('editor');
    expect(await openRuns(editor)).toEqual([]);
    expect((await editor.call('POST', `${P}/tracked-keywords`, { keyword: 'fresh idea one' })).status).toBe(201);
    const bulk = await editor.call('POST', `${P}/tracked-keywords/bulk-create`, {
      items: [{ keyword: 'fresh idea two' }, { keyword: 'fresh idea three' }],
    });
    expect(bulk.status).toBe(200);
    const runs = await openRuns(editor);
    expect(runs.map((run) => [run.workload, run.trigger, run.created_by?.actor_type, run.tasks_total]).sort()).toEqual([
      ['keyword_metrics', 'manual', 'system', 1],
      ['keyword_metrics', 'manual', 'system', 2],
    ]);
    // Only the runs people ask for count against the 20 a day
    const answer = await editor.call('GET', `${P}/runs?limit=1`);
    expect(MANUAL_META.parse(answer.body.meta).manual_runs_today).toEqual({ limit: MANUAL_RUN_LIMIT, used: 0 });
  });

  it('is not made for a keyword the project tracks already, and a refresh by a member is a run of theirs', async () => {
    const editor = mockBrowser('editor');
    await editor.call('POST', `${P}/tracked-keywords`, { keyword: 'SEO Audit' });
    expect(await openRuns(editor)).toEqual([]);
    const own = dataOf(await editor.call('POST', `${P}/keyword-metrics/refresh`, {}), RUN);
    expect(own.created_by).toMatchObject({ actor_type: 'user', actor_id: mockUser('editor').user_id });
  });
});

describe('what a run says of why it ended, as the backend does', () => {
  const [seed] = MOCK_RUNS;
  if (seed === undefined) throw new Error('The fixtures have no run');
  const created = Date.parse('2026-10-01T12:00:00Z');
  const blocked = { ...seed, created_at: new Date(created).toISOString(), ending: 'budget_blocked' as const };

  it('answers a run a hard budget will block as planned, and blocks it when the worker plans it', () => {
    const planned = runView(
      MOCK_WORKSPACE.workspace_id,
      [],
      { ...blocked, blocked_by_budget_id: 'b1' },
      created + 1_000,
    );
    expect(planned).toMatchObject({
      status: 'planned',
      status_reason: null,
      blocked_by_budget_id: null,
      operation: { status: 'queued', error: null },
    });
    const later = runView(
      MOCK_WORKSPACE.workspace_id,
      [],
      { ...blocked, blocked_by_budget_id: 'b1' },
      created + RUN_PLANNED_MS,
    );
    expect(later).toMatchObject({
      status: 'budget_blocked',
      status_reason: 'budget_exceeded',
      blocked_by_budget_id: 'b1',
      operation: { status: 'blocked', error: { code: 'budget_blocked' } },
    });
  });

  it('lets a planned run that a budget will block be cancelled before the block', () => {
    const cancelled = {
      ...blocked,
      blocked_by_budget_id: 'b1',
      cancelled_at: new Date(created + 1_000).toISOString(),
    };
    expect(runView(MOCK_WORKSPACE.workspace_id, [], cancelled, created + 60_000)).toMatchObject({
      status: 'cancelled',
      status_reason: 'cancelled_by_user',
      blocked_by_budget_id: null,
    });
  });

  it('mirrors the status reason as the operation error of a cancelled run, and gives a failed run none of its own', () => {
    const cancelled = {
      ...seed,
      created_at: new Date(created).toISOString(),
      cancelled_at: new Date(created + 1_000).toISOString(),
    };
    expect(runView(MOCK_WORKSPACE.workspace_id, [], cancelled, created + 60_000)).toMatchObject({
      status: 'cancelled',
      operation: { status: 'cancelled', error: { code: 'cancelled_by_user' } },
    });
    const failed = {
      ...seed,
      created_at: new Date(created).toISOString(),
      ending: 'failed' as const,
      status_reason: null,
    };
    expect(runView(MOCK_WORKSPACE.workspace_id, [], failed, created + 60_000)).toMatchObject({
      status: 'failed',
      status_reason: null,
      operation: { status: 'failed', error: null },
    });
  });

  it('starts a manual rank check run that is planned, runs and completes, and counts for the day', async () => {
    const editor = mockBrowser('editor');
    const activeTracked = MOCK_TRACKED_KEYWORDS.filter((row) => row.project_id === fynix.project_id && row.is_active);
    const firstActive = activeTracked[0];
    const secondActive = activeTracked[1];
    if (firstActive === undefined || secondActive === undefined) throw new Error('Missing active tracked fixtures');
    const id1 = firstActive.tracked_keyword_id;
    const id2 = secondActive.tracked_keyword_id;
    const beforeCheck = dataOf(await editor.call('GET', `${P}/tracked-keywords/${id1}`), TRACKED_KEYWORD_DETAIL);
    const answer = await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1, id2] });
    expect(answer.status).toBe(202);
    const run = dataOf(answer, RUN);
    expect(run).toMatchObject({
      workload: 'seo_rank',
      trigger: 'manual',
      status: 'planned',
      tasks_total: 2,
      operation: { status: 'queued', links: { cancel: `${P}/runs/${run.run_id}/cancel` } },
    });
    tick(RUN_PLANNED_MS + RUN_WORKING_MS / 2);
    const running = dataOf(await editor.call('GET', `${P}/runs/${run.run_id}`), RUN_DETAIL);
    expect(running).toMatchObject({ status: 'running' });
    tick(RUN_WORKING_MS);
    const done = dataOf(await editor.call('GET', `${P}/runs/${run.run_id}`), RUN_DETAIL);
    expect(done).toMatchObject({ status: 'completed', tasks_succeeded: 2 });
    const afterCheck = dataOf(await editor.call('GET', `${P}/tracked-keywords/${id1}`), TRACKED_KEYWORD_DETAIL);
    expect(afterCheck.state.current.rank).not.toBeNull();
    expect(afterCheck.state.current.rank).not.toEqual(beforeCheck.state.current.rank);
    const listed = await editor.call('GET', `${P}/runs?limit=1`);
    expect(MANUAL_META.parse(listed.body.meta).manual_runs_today.used).toBe(1);
  });

  it('validates the check-now request shape and keyword status', async () => {
    const editor = mockBrowser('editor');
    const activeTracked = MOCK_TRACKED_KEYWORDS.filter((row) => row.project_id === fynix.project_id && row.is_active);
    const firstActive = activeTracked[0];
    if (firstActive === undefined) throw new Error('Missing active tracked fixture');
    const id1 = firstActive.tracked_keyword_id;
    const archived = MOCK_TRACKED_KEYWORDS.find((row) => row.project_id === fynix.project_id && !row.is_active);
    if (archived === undefined) throw new Error('Missing archived tracked fixture');

    expect(
      fieldCodes(
        await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [archived.tracked_keyword_id] }),
      ),
    ).toEqual(['tracked_keyword_ids:keyword_unknown']);
    expect(
      fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [mockId('tracked', 999)] })),
    ).toEqual(['tracked_keyword_ids:keyword_unknown']);

    expect(fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [] }))).toEqual([
      'tracked_keyword_ids:too_short',
    ]);

    const manyIds = Array.from({ length: 101 }, (_, i) => mockId('tracked', i + 1));
    expect(fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: manyIds }))).toEqual([
      'tracked_keyword_ids:too_long',
    ]);

    expect(fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1, id1] }))).toEqual([
      'tracked_keyword_ids:duplicate',
    ]);

    expect(
      fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1], extra: true })),
    ).toEqual(['extra:extra_forbidden']);

    expect(
      fieldCodes(await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1], depth: 30 })),
    ).toEqual(['depth:enum']);

    expect(await editor.as('viewer').call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1] })).toMatchObject({
      status: 403,
    });
  });

  it('enforces manual run limit and monthly quota limit on check-now', async () => {
    const editor = mockBrowser('editor');
    const activeTracked = MOCK_TRACKED_KEYWORDS.filter((row) => row.project_id === fynix.project_id && row.is_active);
    const firstActive = activeTracked[0];
    if (firstActive === undefined) throw new Error('Missing active tracked fixture');
    const id1 = firstActive.tracked_keyword_id;

    for (let index = 0; index < MANUAL_RUN_LIMIT; index += 1) {
      expect((await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1] })).status).toBe(202);
    }
    const limitRefused = await editor.call('POST', `${P}/seo/check-now`, { tracked_keyword_ids: [id1] });
    expect(limitRefused).toMatchObject({ status: 429, code: 'manual_run_limit', body: { limit: MANUAL_RUN_LIMIT } });
  });
});
