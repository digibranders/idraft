import type { CollectionStatus } from '@/components/app/status/collection-progress';
import type { ManualRuns, Run } from '@/lib/api/types';

/**
 * What the metrics refresh knows without asking anyone (19-api-specification.md section 3.6.1, "As built
 * (step 5, metrics refresh)"): the request it sends, the runs it follows and the words for how they end.
 */

/** Metrics older than this many days are stale: the API's own default, sent so the dialog's words are true. */
export const STALE_DAYS = 25;
/** One refresh takes at most this many keyword ids. */
export const MAX_REFRESH_KEYWORDS = 1000;
/** How often a run that has not ended is asked about. */
export const RUN_POLL_MS = 5_000;
/** How often the list is read again while a keyword on screen waits for its first metrics. */
export const PENDING_POLL_MS = 30_000;
/** A keyword the page saw pending is waited for this long, and no longer. */
export const PENDING_CAP_MS = 15 * 60_000;
/** The open manual refreshes a reload looks for: a project starts at most 20 manual runs a day. */
export const OPEN_RUNS_LIMIT = 20;

export type RunStatus = Run['status'];
export type FinishedStatus = Exclude<RunStatus, 'planned' | 'running'>;

/** What a refresh is asked to cover. */
export type RefreshChoice = 'selection' | 'matching' | 'stale';

/** The request body of a refresh: ids of keywords (`keyword_id`, not `tracked_keyword_id`) or the stale ones. */
export type RefreshBody = { keyword_ids: string[] } | { stale_days: number };

export const refreshBody = (choice: RefreshChoice, keywordIds: readonly string[]): RefreshBody =>
  choice === 'stale' ? { stale_days: STALE_DAYS } : { keyword_ids: [...keywordIds] };

/**
 * The keywords of rows, each once, in the order they come: a keyword tracked at several locations or on
 * both devices is one keyword, and the API refreshes it at each place.
 */
export function uniqueKeywordIds(rows: readonly { keyword: { keyword_id: string } }[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) seen.add(row.keyword.keyword_id);
  return [...seen];
}

/** How many manual refreshes the project may still start today. */
export const leftToday = (manual: ManualRuns): number => Math.max(manual.limit - manual.used, 0);

/** A keyword that waits for its first metrics: active, and none read yet. */
export const isPendingMetrics = (row: { is_active: boolean; metrics?: unknown }): boolean =>
  row.is_active && (row.metrics === null || row.metrics === undefined);

/** Whether the run has not ended: it is planned or running. */
export const isOpenRun = (run: Pick<Run, 'status'>): boolean => run.status === 'planned' || run.status === 'running';

/** The status as `CollectionProgress` names it: a planned run is queued (17-empty-loading-error-states.md section 4.1). */
export const collectionStatusOf = (status: RunStatus): CollectionStatus => (status === 'planned' ? 'queued' : status);

/** The catalog key of how a run ended, under `rankings.refresh.finished`: keys are camelCase, the API's codes are not. */
export const FINISH_KEYS = {
  completed: 'completed',
  completed_with_errors: 'completedWithErrors',
  failed: 'failed',
  cancelled: 'cancelled',
  budget_blocked: 'budgetBlocked',
} as const satisfies Record<FinishedStatus, string>;

/** The catalog key of a run's `status_reason` code, under `rankings.refresh.reasons`. */
export const REASON_KEYS = {
  cancelled_by_user: 'cancelledByUser',
  project_not_collecting: 'projectNotCollecting',
  workload_unavailable: 'workloadUnavailable',
  budget_exceeded: 'budgetExceeded',
} as const;

type ReasonCode = keyof typeof REASON_KEYS;
export type ReasonKey = (typeof REASON_KEYS)[ReasonCode];

const isReasonCode = (code: string): code is ReasonCode => Object.hasOwn(REASON_KEYS, code);

/** The key of the words for a status reason, or `null` for a code this client has no words for (or none). */
export function reasonKeyOf(reason: string | null | undefined): ReasonKey | null {
  return reason !== null && reason !== undefined && isReasonCode(reason) ? REASON_KEYS[reason] : null;
}

/** Whether a run's status says it ended (any status but planned and running). */
export const isFinished = (status: RunStatus): status is FinishedStatus => status !== 'planned' && status !== 'running';
