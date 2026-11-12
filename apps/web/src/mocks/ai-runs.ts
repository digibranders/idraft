import { EVENTUS_WORLD, type DefinitionWorld } from './ai-prompt-world';
import { mockId } from './mock-ids';
import type { StoredRun, StoredSchedule } from './operations-state';
import { answerOf, DAY_MS, runInstants } from './prompt-fixtures';

/**
 * The AI side of the schedules and runs of a project with a definition file: the two weekly schedules the base plan
 * makes when an engine is turned on (Monday and Thursday, `withAiSchedules` in ./handlers/prompts.ts), and the run
 * each of them made for every Monday and Thursday of the last 92 days, which asked every prompt on every engine.
 * The answers of those runs are the ones ./handlers/prompt-answers.ts lists, so a run's failed tasks are the
 * answers of its day that are not valid.
 */

const WINDOW_START_LOCAL = '01:00:00';
const WINDOW_HOURS = 8;
/** The window opens at 01:00 in Asia/Kolkata (UTC+5:30), which is 19:30 UTC the day before: 6.5 hours before the answers (02:00 UTC). */
const WINDOW_BEFORE_ANSWERS_MS = 6 * 3_600_000 + 30 * 60_000;
/** Fixture runs of this kind are numbered far above the keyword runs', and far below the numbers a browser mints from. */
const RUN_NUMBER_BASE = 900_000_000;

const SCHEDULES = [
  { weekday: 1, number: 4, name: 'AI answers, Monday' },
  { weekday: 4, number: 5, name: 'AI answers, Thursday' },
] as const;

/** The two AI schedules of a project, as the planner makes them. */
const schedulesOf = (world: DefinitionWorld): StoredSchedule[] =>
  SCHEDULES.map((schedule) => ({
    schedule_id: mockId('schedule', schedule.number),
    project_id: world.projectId,
    name: schedule.name,
    workload: 'ai_prompt',
    cadence: 'weekly',
    weekday: schedule.weekday,
    month_day: null,
    window_start_local: WINDOW_START_LOCAL,
    window_hours: WINDOW_HOURS,
    timezone: world.definition.project.timezone,
    priority: 'standard',
    provider_mode: 'standard_queue',
    selector: { all: true },
    is_active: true,
    created_at: '2026-06-01T09:00:00.000Z',
    deleted_at: null,
    next_run_at: null,
    last_window_at: null,
  }));

export const EVENTUS_AI_SCHEDULES: readonly StoredSchedule[] = schedulesOf(EVENTUS_WORLD);

/** The runs of the AI schedules of `world`'s project up to `now`, oldest first. */
export function aiScheduleRuns(world: DefinitionWorld, now: number): StoredRun[] {
  const schedules = schedulesOf(world);
  const engines = world.definition.engines.map((engine) => engine.engine_code);
  return runInstants(now)
    .reverse()
    .flatMap((at): StoredRun[] => {
      const schedule = schedules.find((candidate) => candidate.weekday === new Date(at).getUTCDay());
      if (schedule === undefined) return [];
      const day = Math.floor(at / DAY_MS);
      let failed = 0;
      world.definition.prompts.forEach((_, index) => {
        for (const engine of engines) {
          if (!answerOf(index, world.definition.project.language_code, engine, day, world.projectId).facts.is_valid) {
            failed += 1;
          }
        }
      });
      return [
        {
          // The run's number follows its day, so it is the same on every request
          run_id: mockId('run', RUN_NUMBER_BASE + day),
          project_id: world.projectId,
          schedule_id: schedule.schedule_id,
          workload: 'ai_prompt',
          trigger: 'schedule',
          created_at: new Date(at - WINDOW_BEFORE_ANSWERS_MS).toISOString(),
          created_by: null,
          tasks_total: world.definition.prompts.length * engines.length,
          tasks_failed: failed,
          // No Labs calls: an AI answer is priced by the answer
          calls: 0,
          keyword_count: null,
          stale_days: null,
          ending: failed > 0 ? 'completed_with_errors' : 'completed',
          status_reason: null,
          blocked_by_budget_id: null,
          cancelled_at: null,
          cancel_reason: null,
        },
      ];
    });
}
