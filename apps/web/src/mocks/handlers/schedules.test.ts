import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_GROUP_IDS } from '../keyword-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { MOCK_RUNS, MOCK_SCHEDULE_IDS } from '../operations-fixtures';
import { mockId } from '../mock-ids';
import { OFFSET_PAGE, SCHEDULE, TRACKED_KEYWORD_DETAIL } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, pageOf } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;
const S = `${P}/schedules`;
const SCHEDULES = z.array(SCHEDULE);
/** Noon on 1 October 2026, UTC: Berlin is on summer time until 25 October. */
const NOON = Date.parse('2026-10-01T12:00:00Z');

const at = (iso: string): void => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(iso));
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOON);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('schedules', () => {
  it('lists the project schedules with their next run in their own time zone and their last run', async () => {
    const viewer = mockBrowser('viewer');
    const answer = await viewer.call('GET', S);
    expect(pageOf(answer, OFFSET_PAGE)).toEqual({ offset: 0, limit: 50, total: 3 });
    const [metrics, daily, weekly] = dataOf(answer, SCHEDULES);
    // The 20th at 03:00 in Berlin, summer time
    expect(metrics).toMatchObject({ cadence: 'monthly', month_day: 20, next_run_at: '2026-10-20T01:00:00.000Z' });
    const lastScheduled = MOCK_RUNS.filter((run) => run.schedule_id === MOCK_SCHEDULE_IDS.keywordMetrics).at(-1);
    expect(metrics?.last_run_id).toBe(lastScheduled?.run_id);
    expect(daily).toMatchObject({ next_run_at: '2026-10-02T00:00:00.000Z', last_run_id: null });
    // Paused, on Mondays: the next Monday all the same
    expect(weekly).toMatchObject({ is_active: false, weekday: 1, next_run_at: '2026-10-05T00:00:00.000Z' });
    const ranks = dataOf(await viewer.call('GET', `${S}?filter[workload]=seo_rank&filter[is_active]=true`), SCHEDULES);
    expect(ranks.map((schedule) => schedule.name)).toEqual(['Daily rankings']);
  });

  it('follows the clock change of the time zone', async () => {
    at('2026-10-31T12:00:00Z');
    const admin = mockBrowser('admin');
    const created = await admin.call('POST', S, {
      name: 'New York mornings',
      workload: 'seo_rank',
      cadence: 'daily',
      window_start_local: '02:30',
      timezone: 'America/New_York',
      selector: { all: true },
    });
    expect(created.status).toBe(201);
    // 1 November is the first day of winter time in New York: 02:30 is 07:30 UTC
    expect(dataOf(created, SCHEDULE)).toMatchObject({
      window_start_local: '02:30:00',
      window_hours: 6,
      priority: 'standard',
      provider_mode: 'standard_queue',
      next_run_at: '2026-11-01T07:30:00.000Z',
    });
  });

  it('answers the first stage that fails, as the service checks them', async () => {
    const editor = mockBrowser('editor');
    const daily = { name: 'Daily', cadence: 'daily', window_start_local: '02:00', timezone: 'UTC' };
    // The workload, then the cadence, then the provider mode
    expect(
      fieldCodes(
        await editor.call('POST', S, { ...daily, workload: 'ai_prompt', cadence: 'cron', timezone: 'Mars/Olympus' }),
      ),
    ).toEqual(['workload:workload_not_available']);
    expect(fieldCodes(await editor.call('POST', S, { ...daily, workload: 'seo_rank', cadence: 'cron' }))).toEqual([
      'cadence:cadence_not_supported',
    ]);
    // Labs is called live: the default queue mode is refused for keyword metrics
    expect(fieldCodes(await editor.call('POST', S, { ...daily, workload: 'keyword_metrics' }))).toEqual([
      'provider_mode:provider_mode_not_supported',
    ]);
    const metrics = { ...daily, workload: 'keyword_metrics', provider_mode: 'live' };
    // Then the selector: the first member the workload does not take, an empty one, all with stale days
    expect(
      fieldCodes(
        await editor.call('POST', S, { ...metrics, selector: { priority_lte: 2, groups: [MOCK_GROUP_IDS.brand] } }),
      ),
    ).toEqual(['selector.priority_lte:selector_not_supported']);
    expect(
      fieldCodes(await editor.call('POST', S, { ...daily, workload: 'seo_rank', selector: { groups: [], terms: [] } })),
    ).toEqual(['selector:selector_empty']);
    expect(fieldCodes(await editor.call('POST', S, { ...metrics, selector: { all: true, stale_days: 7 } }))).toEqual([
      'selector.stale_days:selector_conflict',
    ]);
    // Then the time zone, which is looked up once its name has the right shape
    expect(fieldCodes(await editor.call('POST', S, { ...metrics, timezone: 'Mars/Olympus' }))).toEqual([
      'timezone:timezone_unknown',
    ]);
    // A create's days are held to its cadence by the schema, as one error for the body
    expect(fieldCodes(await editor.call('POST', S, { ...metrics, cadence: 'weekly' }))).toEqual([':value_error']);
    // A renamed zone is kept by its current name
    const calcutta = await editor.call('POST', S, { ...metrics, timezone: 'Asia/Calcutta' });
    expect(dataOf(calcutta, SCHEDULE).timezone).toBe('Asia/Kolkata');
    // A name not shaped like a zone is refused before it is looked up
    expect(
      fieldCodes(
        await editor.call('POST', S, {
          name: 'Odd zone',
          workload: 'keyword_metrics',
          cadence: 'daily',
          window_start_local: '02:00',
          timezone: 'not a zone',
        }),
      ),
    ).toEqual(['timezone:string_pattern_mismatch']);
    expect(fieldCodes(await editor.call('POST', S, { name: 'x' }))).toEqual([
      'workload:missing',
      'cadence:missing',
      'window_start_local:missing',
      'timezone:missing',
    ]);
    expect(
      await editor.as('analyst').call('POST', S, {
        name: 'Daily',
        workload: 'seo_rank',
        cadence: 'daily',
        window_start_local: '02:00',
        timezone: 'UTC',
        selector: { all: true },
      }),
    ).toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('holds a change’s days to its cadence: required when it starts to use one, refused when it has none', async () => {
    const editor = mockBrowser('editor');
    const daily = `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`;
    expect(fieldCodes(await editor.call('PATCH', daily, { cadence: 'weekly' }))).toEqual(['weekday:required']);
    expect(fieldCodes(await editor.call('PATCH', daily, { weekday: 2 }))).toEqual(['weekday:not_applicable']);
    expect(fieldCodes(await editor.call('PATCH', daily, { cadence: 'monthly' }))).toEqual(['month_day:required']);
    const weekly = dataOf(await editor.call('PATCH', daily, { cadence: 'weekly', weekday: 3 }), SCHEDULE);
    expect(weekly).toMatchObject({ cadence: 'weekly', weekday: 3, month_day: null });
    // Back to daily, the weekday is dropped
    expect(dataOf(await editor.call('PATCH', daily, { cadence: 'daily' }), SCHEDULE)).toMatchObject({ weekday: null });
  });

  it('changes, pauses and resumes a schedule, its next run counted again from now', async () => {
    const editor = mockBrowser('editor');
    const changed = await editor.call('PATCH', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`, {
      cadence: 'monthly',
      month_day: 3,
      selector: { groups: [MOCK_GROUP_IDS.local] },
    });
    expect(dataOf(changed, SCHEDULE)).toMatchObject({
      cadence: 'monthly',
      month_day: 3,
      next_run_at: '2026-10-03T00:00:00.000Z',
      selector: { groups: [MOCK_GROUP_IDS.local] },
    });
    expect(fieldCodes(await editor.call('PATCH', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`, {}))).toEqual([
      ':value_error',
    ]);
    expect(
      fieldCodes(await editor.call('PATCH', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`, { workload: 'keyword_metrics' })),
    ).toEqual(['workload:extra_forbidden']);
    const paused = await editor.call('POST', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}/pause`, { reason: 'Holidays' });
    expect(dataOf(paused, SCHEDULE).is_active).toBe(false);
    at('2026-10-10T12:00:00Z');
    const resumed = await editor.call('POST', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}/resume`);
    // No catch-up: the 3rd has passed, so the next run is in November
    expect(dataOf(resumed, SCHEDULE)).toMatchObject({ is_active: true, next_run_at: '2026-11-03T01:00:00.000Z' });
  });

  it('lets a tracked keyword name a rank schedule, and refuses to delete a schedule in use', async () => {
    const editor = mockBrowser('editor');
    const tracked = `${P}/tracked-keywords/${mockId('tracked', 1)}`;
    expect(fieldCodes(await editor.call('PATCH', tracked, { schedule_id: MOCK_SCHEDULE_IDS.keywordMetrics }))).toEqual([
      'schedule_id:schedule_unknown',
    ]);
    expect((await editor.call('PATCH', tracked, { schedule_id: MOCK_SCHEDULE_IDS.dailyRanks })).status).toBe(200);
    const detail = dataOf(await editor.call('GET', tracked), TRACKED_KEYWORD_DETAIL);
    expect(detail.schedule).toEqual({
      schedule_id: MOCK_SCHEDULE_IDS.dailyRanks,
      name: 'Daily rankings',
      next_run_at: '2026-10-02T00:00:00.000Z',
    });
    expect(await editor.call('DELETE', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`)).toMatchObject({
      status: 409,
      code: 'schedule_in_use',
      body: { tracked_keyword_count: 1 },
    });
    await editor.call('PATCH', tracked, { schedule_id: null });
    expect((await editor.call('DELETE', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`)).status).toBe(204);
    expect(await editor.call('GET', `${S}/${MOCK_SCHEDULE_IDS.dailyRanks}`)).toMatchObject({ status: 404 });
    expect(pageOf(await editor.call('GET', S), OFFSET_PAGE).total).toBe(2);
  });
});
