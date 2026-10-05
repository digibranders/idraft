import type { Run } from '@/lib/api/types';

/**
 * What a run's status and its reason mean to every screen that shows runs (19-api-specification.md section
 * 3.11.4): Runs and the metrics refresh in Rankings read them the same way, so they live here and not in
 * either feature.
 */

export type RunStatus = Run['status'];
export type FinishedStatus = Exclude<RunStatus, 'planned' | 'running'>;

/** Whether the run has not ended: it is planned or running, and may still be cancelled. */
export const isOpenRun = (run: Pick<Run, 'status'>): boolean => run.status === 'planned' || run.status === 'running';

/** Whether a run's status says it ended (any status but planned and running). */
export const isFinished = (status: RunStatus): status is FinishedStatus => status !== 'planned' && status !== 'running';

/** What a run's status is called by `CollectionProgress`, which takes these as its `status`. */
export type QueuedOrStatus = 'queued' | Exclude<RunStatus, 'planned'>;

/** The status as `CollectionProgress` names it: a planned run is queued (17-empty-loading-error-states.md section 4.1). */
export const collectionStatusOf = (status: RunStatus): QueuedOrStatus => (status === 'planned' ? 'queued' : status);

/** The catalog key of a run's `status_reason` code, under `runReasons`: keys are camelCase, the API's codes are not. */
export const REASON_KEYS = {
  cancelled_by_user: 'cancelledByUser',
  budget_exceeded: 'budgetExceeded',
  project_not_collecting: 'projectNotCollecting',
  workload_unavailable: 'workloadUnavailable',
} as const;

type ReasonCode = keyof typeof REASON_KEYS;
export type ReasonKey = (typeof REASON_KEYS)[ReasonCode];

const isReasonCode = (code: string): code is ReasonCode => Object.hasOwn(REASON_KEYS, code);

/** The key of the words for a status reason, or `null` for a code this client has no words for (or none). */
export function reasonKeyOf(reason: string | null | undefined): ReasonKey | null {
  return reason !== null && reason !== undefined && isReasonCode(reason) ? REASON_KEYS[reason] : null;
}
