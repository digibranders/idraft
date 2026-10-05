'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { FINISH_KEYS, collectionStatusOf, isFinished, isOpenRun, reasonKeyOf } from './refresh-model';
import { useRefreshRun } from './refresh-queries';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { CollectionProgress } from '@/components/app/status/collection-progress';
import { toast, type ToastOptions } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import type { Run } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';

export interface RefreshProgressProps {
  scope: ProjectScope;
  runId: string;
  /** The run ended, or cannot be followed: the header lets go of it. Called once, with the id. */
  onSettled: (runId: string) => void;
}

/**
 * A metrics refresh under Rankings' page header (23-application-patterns.md section 12.1): a bar while the
 * run is queued or running, and when it ends one toast. It asks about the run every few seconds, so it
 * survives the dialog and a reload (Rankings finds the open runs on mount). The keyword table is read again
 * at the end, since new metrics may have arrived.
 */
export function RefreshProgress({ scope, runId, onSettled }: RefreshProgressProps): ReactElement | null {
  const t = useTranslations('rankings.refresh');
  const queryClient = useQueryClient();
  const current = useRefreshRun(scope, runId);
  const run = current.data;
  // The end is reported once, however many times the answer is read again
  const handled = useRef(false);
  const gone = isApiProblem(current.error, 'not_found');

  useEffect(() => {
    if (handled.current) return;
    // A run that no longer exists has nothing to say: let go of it quietly
    if (gone) {
      handled.current = true;
      onSettled(runId);
      return;
    }
    if (run === undefined || !isFinished(run.status)) return;
    handled.current = true;
    toast({ id: `keyword-refresh-${runId}`, ...finishedToast(run, t) });
    void refreshKeywords(queryClient, scope);
    onSettled(runId);
  }, [run, gone, runId, scope, queryClient, onSettled, t]);

  if (run === undefined || !isOpenRun(run)) return null;
  const done = run.tasks_succeeded + run.tasks_failed;
  const counts = run.tasks_total > 0 ? { done, failed: run.tasks_failed, total: run.tasks_total } : undefined;
  const text =
    counts === undefined
      ? undefined
      : counts.failed > 0
        ? t('progress.countsFailed', {
            done: formatInteger(done),
            total: formatInteger(counts.total),
            failed: formatInteger(counts.failed),
          })
        : t('progress.counts', { done: formatInteger(done), total: formatInteger(counts.total) });
  return (
    <CollectionProgress
      density="standard"
      status={collectionStatusOf(run.status)}
      text={run.status === 'planned' ? t('progress.queued') : t('progress.running')}
      counts={counts}
      countsText={text}
      progressText={text}
    />
  );
}

type Translate = ReturnType<typeof useTranslations<'rankings.refresh'>>;

/** The toast of a run that has ended: how it ended, with the reason when the API gave one we have words for. */
function finishedToast(run: Run, t: Translate): Omit<ToastOptions, 'id'> {
  const reasonKey = reasonKeyOf(run.status_reason);
  const reason = reasonKey === null ? {} : { description: t(`reasons.${reasonKey}`) };
  switch (run.status) {
    case 'completed':
      return run.tasks_total === 0
        ? { type: 'info', title: t('finished.nothing') }
        : { type: 'success', title: t('finished.completed', { count: run.tasks_succeeded }) };
    case 'completed_with_errors':
      return {
        type: 'info',
        title: t('finished.completedWithErrors', {
          done: formatInteger(run.tasks_succeeded),
          total: formatInteger(run.tasks_total),
          failed: formatInteger(run.tasks_failed),
        }),
      };
    case 'failed':
      return { type: 'error', title: t(`finished.${FINISH_KEYS.failed}`), ...reason };
    case 'cancelled':
      return { type: 'info', title: t(`finished.${FINISH_KEYS.cancelled}`), ...reason };
    case 'budget_blocked':
      return { type: 'info', title: t(`finished.${FINISH_KEYS.budget_blocked}`) };
    case 'planned':
    case 'running':
      throw new Error('A run that has not ended has no finished toast');
  }
}
