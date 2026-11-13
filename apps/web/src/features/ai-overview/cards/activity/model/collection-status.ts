import type { OverviewSchedule } from '../../../data/use-overview-reads';
import type { Run } from '@/lib/api/types';

/**
 * What the collection status card says about the AI runs of the project (WP-37 plan T6). Pure: the card reads the
 * runs and the schedule through the hooks of ../data/activity-reads.ts and hands them here. Counts are tasks (answers
 * asked), exactly as the run reports them; nothing is turned into a rate.
 */

/** When the next AI run is. Paused, none and unknown are three different facts, and none of them is a date. */
export type NextRun =
  | { kind: 'at'; at: string }
  /** The project has AI schedules and every one is paused. */
  | { kind: 'paused' }
  /** The project has no AI schedule. */
  | { kind: 'none' }
  /** The schedules are not read (they failed, or are still loading). */
  | { kind: 'unknown' };

export function nextRunOf(schedule: OverviewSchedule | undefined): NextRun {
  if (schedule === undefined) return { kind: 'unknown' };
  if (schedule.paused) return { kind: 'paused' };
  return schedule.nextRunAt === null ? { kind: 'none' } : { kind: 'at', at: schedule.nextRunAt };
}

export interface RunCounts {
  /** Answers collected (`tasks_succeeded`). */
  collected: number;
  failed: number;
  /** Answers the run asked for (`tasks_total`). */
  total: number;
}

export interface FinishedRun extends RunCounts {
  runId: string;
  status: 'completed' | 'completed_with_errors' | 'failed';
  /** When it finished (`completed_at`), or when it was made when the API gives no end. */
  at: string;
}

export interface OpenRun extends RunCounts {
  runId: string;
  status: 'planned' | 'running';
  at: string;
}

/** The runs a budget blocked after the latest finished run: how many, and when the newest was made. */
export interface BlockedRuns {
  count: number;
  latestAt: string;
}

export interface CollectionStatus {
  latest: FinishedRun | null;
  open: OpenRun | null;
  blocked: BlockedRuns | null;
}

const countsOf = (run: Run): RunCounts => ({
  collected: run.tasks_succeeded,
  failed: run.tasks_failed,
  total: run.tasks_total,
});

function finishedOf(run: Run): FinishedRun | null {
  const { status } = run;
  if (status !== 'completed' && status !== 'completed_with_errors' && status !== 'failed') return null;
  return { ...countsOf(run), runId: run.run_id, status, at: run.completed_at ?? run.created_at };
}

function openOf(run: Run): OpenRun | null {
  const { status } = run;
  if (status !== 'planned' && status !== 'running') return null;
  return { ...countsOf(run), runId: run.run_id, status, at: run.created_at };
}

const newestFirst = (a: Run, b: Run): number => Date.parse(b.created_at) - Date.parse(a.created_at);

/** The newest finished AI run, the newest one under way, and the runs a budget blocked since. */
export function collectionStatus(runs: readonly Run[]): CollectionStatus {
  const ai = runs.filter((run) => run.workload === 'ai_prompt').sort(newestFirst);
  const latestRun = ai.find((run) => finishedOf(run) !== null);
  const since = latestRun === undefined ? Number.NEGATIVE_INFINITY : Date.parse(latestRun.created_at);
  const blocked = ai.filter((run) => run.status === 'budget_blocked' && Date.parse(run.created_at) > since);
  const [newestBlocked] = blocked;
  return {
    latest: latestRun === undefined ? null : finishedOf(latestRun),
    open: ai.map(openOf).find((open) => open !== null) ?? null,
    blocked: newestBlocked === undefined ? null : { count: blocked.length, latestAt: newestBlocked.created_at },
  };
}
