import { describe, expect, it } from 'vitest';

import { aiScheduleRuns, EVENTUS_AI_SCHEDULES } from './ai-runs';
import { EVENTUS_WORLD } from './ai-prompt-world';
import { answerOf, DAY_MS, runInstants } from './prompt-fixtures';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const runs = aiScheduleRuns(EVENTUS_WORLD, NOW);

describe('the AI schedules of Eventus Security', () => {
  it('are one on Monday and one on Thursday, weekly, in the project time zone, for every prompt', () => {
    expect(EVENTUS_AI_SCHEDULES.map((schedule) => [schedule.workload, schedule.cadence, schedule.weekday])).toEqual([
      ['ai_prompt', 'weekly', 1],
      ['ai_prompt', 'weekly', 4],
    ]);
    for (const schedule of EVENTUS_AI_SCHEDULES) {
      expect(schedule).toMatchObject({
        project_id: EVENTUS_WORLD.projectId,
        timezone: 'Asia/Kolkata',
        provider_mode: 'standard_queue',
        selector: { all: true },
        is_active: true,
        deleted_at: null,
      });
    }
    expect(new Set(EVENTUS_AI_SCHEDULES.map((schedule) => schedule.schedule_id)).size).toBe(2);
  });
});

describe('the AI runs of Eventus Security', () => {
  it('has one run for each Monday and Thursday of the last 92 days, none in the future', () => {
    const instants = runInstants(NOW);
    expect(runs).toHaveLength(instants.length);
    for (const run of runs) {
      expect(run).toMatchObject({
        project_id: EVENTUS_WORLD.projectId,
        workload: 'ai_prompt',
        trigger: 'schedule',
        created_by: null,
        calls: 0,
        keyword_count: null,
        stale_days: null,
        cancelled_at: null,
      });
      expect(Date.parse(run.created_at)).toBeLessThanOrEqual(NOW);
    }
    expect(new Set(runs.map((run) => run.run_id)).size).toBe(runs.length);
  });

  it('belongs to the schedule of its weekday and asks every prompt on both engines', () => {
    const byId = new Map(EVENTUS_AI_SCHEDULES.map((schedule) => [schedule.schedule_id, schedule.weekday]));
    for (const run of runs) {
      expect(run.tasks_total).toBe(72 * 2);
      // The window opens at 01:00 in Kolkata, before the 02:00 UTC answers of the run day
      const answered = Math.floor((Date.parse(run.created_at) + 12 * 3_600_000) / DAY_MS);
      expect([1, 4]).toContain(byId.get(run.schedule_id ?? ''));
      expect(new Date(answered * DAY_MS).getUTCDay()).toBe(byId.get(run.schedule_id ?? ''));
    }
  });

  it('counts as failed the answers of that run that are not valid, and ends with errors only then', () => {
    let withErrors = 0;
    for (const run of runs) {
      const day = Math.floor((Date.parse(run.created_at) + 12 * 3_600_000) / DAY_MS);
      let invalid = 0;
      for (const [index] of EVENTUS_WORLD.definition.prompts.entries()) {
        for (const engine of ['chatgpt_web', 'gemini_web'] as const) {
          if (!answerOf(index, 'en', engine, day, EVENTUS_WORLD.projectId).facts.is_valid) invalid += 1;
        }
      }
      expect(run.tasks_failed).toBe(invalid);
      expect(run.ending).toBe(invalid > 0 ? 'completed_with_errors' : 'completed');
      if (invalid > 0) withErrors += 1;
    }
    expect(withErrors).toBeGreaterThan(0);
  });
});
