import type { Run } from '@/lib/api/types';
import { formatIsoDate, formatTableDate, formatTime } from '@/lib/format';
import { collectionStatusOf, isOpenRun, type QueuedOrStatus } from '@/lib/runs/run-status';

/**
 * What the collection of a project shows, decided without React: the sidebar's line, and the thresholds the
 * degraded notice of the AI pages uses (WP-30 decisions D12 and D13). Components render these through
 * message keys, so no sentence is joined here. It lives in lib because the shell and the AI pages share it,
 * and a feature never imports another feature (26 section 2).
 */

/** An engine whose valid share is below this is degraded; exactly this share is not (D12). */
export const DEGRADED_BELOW = 0.9;
/** A run that planned fewer tasks than this is never called degraded: one failed answer would say so (D12). */
export const DEGRADED_MIN_PLANNED = 10;

/** The fields of a run the line reads. */
export type LineRun = Pick<
  Run,
  'status' | 'workload' | 'tasks_total' | 'tasks_succeeded' | 'created_at' | 'completed_at'
>;

/** The newest run as the read left it: it failed, or it answered with a run or with none. */
export type NewestRunRead = { state: 'failed' } | { state: 'ready'; run: LineRun | null };

/** What the counts of a run are counted in: the `noun` of the message `runs.line.lastRun`. */
export type RunNoun = 'answers' | 'checks' | 'keywords' | 'tasks';

const NOUNS: Readonly<Partial<Record<Run['workload'], RunNoun>>> = {
  ai_prompt: 'answers',
  ai_mode_keyword: 'answers',
  seo_rank: 'checks',
  keyword_metrics: 'keywords',
};

export type LineDescription =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  /** `status` is what the icon shows: always `running`, for a planned run too, as both read "Running now". */
  | { kind: 'running'; status: 'running' }
  | {
      kind: 'finished';
      status: QueuedOrStatus;
      /** The time of day when the run ended today in the project's zone, else its date. */
      when: string;
      /** `null` when the run planned no task: nothing is known to count, and a zero would be a claim. */
      counts: { done: number; total: number; noun: RunNoun } | null;
    };

/**
 * The sidebar's collection line (D13): the newest run of the project, in the project's time zone. A read
 * that failed is its own line and never a time, and a run with nothing planned has no counts.
 */
export function lineOf(read: NewestRunRead, timeZone: string, now: Date = new Date()): LineDescription {
  if (read.state === 'failed') return { kind: 'unavailable' };
  const { run } = read;
  if (run === null) return { kind: 'none' };
  // A planned run reads "Running now" too, so it shows the spinning icon and not the static queued one (D13)
  if (isOpenRun(run)) return { kind: 'running', status: 'running' };
  const status = collectionStatusOf(run.status);
  const ended = run.completed_at ?? run.created_at;
  const today = formatIsoDate(ended, timeZone) === formatIsoDate(now, timeZone);
  return {
    kind: 'finished',
    status,
    when: today ? formatTime(ended, timeZone) : formatTableDate(ended, timeZone, now),
    counts:
      run.tasks_total === 0
        ? null
        : { done: run.tasks_succeeded, total: run.tasks_total, noun: NOUNS[run.workload] ?? 'tasks' },
  };
}
