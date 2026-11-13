import type { Run, Schemas } from '@/lib/api/types';
import { formatIsoDate, formatPercent, formatTableDate, formatTime } from '@/lib/format';
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

/** The most missing answers a run's list shows before "Show all N" (WP-30 task 5a). */
export const MISSING_SHOWN = 50;

export type CoverageEngine = Schemas['AiCoverageEngine'];
export type CoverageMissing = Schemas['AiCoverageMissing'];
export type AiCoverage = Schemas['AiCoverage'];

/** The kinds of answer a run's engine line names besides the valid ones; `partial` is inside the valid ones. */
export type InvalidPart = 'partial' | 'empty' | 'refused' | 'error';

/**
 * One engine of a run as the inspector shows it. `none`: nothing was planned, so there is no rate and no zero;
 * `thin`: fewer than `DEGRADED_MIN_PLANNED` planned, so the counts show and the rate does not; `rated`.
 */
export interface CoverageRow {
  engine: string;
  planned: number;
  valid: number;
  kind: 'none' | 'thin' | 'rated';
  /** Valid over planned, for a `rated` engine only. */
  rate: number | null;
  /** A `rated` engine below `DEGRADED_BELOW`: the only tone the inspector gives. */
  degraded: boolean;
  /** The partial answers (counted as valid) and the invalid ones, those with a count only, in reading order. */
  parts: { part: InvalidPart; count: number }[];
}

/**
 * The engines of a run, one row each in the order given (never pooled). The rate is valid over planned, not
 * over observed: an answer that never arrived is a miss, and the API's own `valid_rate` is not read so the
 * counts shown and the rate shown are the same two numbers.
 */
export function coverageRows(engines: readonly CoverageEngine[]): CoverageRow[] {
  return engines.map((row): CoverageRow => {
    const { planned, valid } = row;
    const kind = planned === 0 ? 'none' : planned < DEGRADED_MIN_PLANNED ? 'thin' : 'rated';
    const rate = kind === 'rated' ? valid / planned : null;
    const counted: [InvalidPart, number][] = [
      ['partial', row.partial],
      ['empty', row.invalid_by_status.empty],
      ['refused', row.invalid_by_status.refused],
      ['error', row.invalid_by_status.error],
    ];
    return {
      engine: row.engine_code,
      planned,
      valid,
      kind,
      rate,
      degraded: rate !== null && rate < DEGRADED_BELOW,
      parts: counted.filter(([, count]) => count > 0).map(([part, count]) => ({ part, count })),
    };
  });
}

/** An engine of a run that is degraded: the counts the notice names and the rate they make. */
export interface DegradedEngine {
  engine: string;
  planned: number;
  valid: number;
  rate: number;
}

/**
 * The engines of a run the degraded notice names (D12), one by one, in the order given. It is `coverageRows`
 * filtered, so the notice and the run inspector can never disagree on which engines are degraded: the same
 * exact rate against `DEGRADED_BELOW`, at least `DEGRADED_MIN_PLANNED` planned, each engine alone.
 */
export function degradedEngines(engines: readonly CoverageEngine[]): DegradedEngine[] {
  return coverageRows(engines).flatMap(({ engine, planned, valid, rate, degraded }) =>
    degraded && rate !== null ? [{ engine, planned, valid, rate }] : [],
  );
}

/** The fields of a run the progress line reads. */
export type ProgressRun = Pick<Run, 'tasks_total' | 'tasks_succeeded' | 'tasks_failed'>;

/**
 * How far an open run is: the tasks that ended (the failed ones too) of the tasks planned, and how many of
 * them failed. `null` while the run has planned no task, as "0 of 0" would be a claim.
 */
export function progressOf(run: ProgressRun): { processed: number; failed: number; total: number } | null {
  if (run.tasks_total <= 0) return null;
  return {
    processed: Math.min(run.tasks_succeeded + run.tasks_failed, run.tasks_total),
    failed: run.tasks_failed,
    total: run.tasks_total,
  };
}

/**
 * An engine's valid rate as the notice and the run inspector print it: a whole percent. A rate below
 * `DEGRADED_BELOW` is never printed as the line itself ("90%" beside "Below 90%"): when the whole percent would
 * reach it, the rate is floored (never rounded up) to one decimal, so 0.8996 reads "89.9%".
 */
export function formatCoverageRate(rate: number): string {
  if (rate >= DEGRADED_BELOW || Math.round(rate * 100) / 100 < DEGRADED_BELOW) {
    return formatPercent(rate, { decimals: 0 });
  }
  // The small addend keeps a rate like 0.896 (895.9999999999999 thousandths in floating point) from losing a place
  return formatPercent(Math.floor(rate * 1000 + 1e-9) / 1000, { decimals: 1 });
}

/** The missing answers to draw, and how many the cap leaves out. */
export function missingShown(
  missing: readonly CoverageMissing[],
  showAll: boolean,
): { rows: readonly CoverageMissing[]; hidden: number } {
  if (showAll || missing.length <= MISSING_SHOWN) return { rows: missing, hidden: 0 };
  return { rows: missing.slice(0, MISSING_SHOWN), hidden: missing.length - MISSING_SHOWN };
}

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
