import type { Run } from '@/lib/api/types';

/**
 * The tasks of a run, counted once for every screen that shows them: Runs says how many are done (they have
 * an outcome), and the metrics refresh in Rankings says how many keywords were read (they succeeded) with the
 * failed ones apart.
 */
export interface TaskSummary {
  /** Tasks with an outcome: succeeded or failed. */
  done: number;
  succeeded: number;
  failed: number;
  /** Tasks without one yet. */
  pending: number;
  total: number;
}

export function taskSummary(run: Pick<Run, 'tasks_total' | 'tasks_succeeded' | 'tasks_failed'>): TaskSummary {
  const done = run.tasks_succeeded + run.tasks_failed;
  return {
    done,
    succeeded: run.tasks_succeeded,
    failed: run.tasks_failed,
    pending: Math.max(0, run.tasks_total - done),
    total: run.tasks_total,
  };
}
