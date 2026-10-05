'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { FINISH_KEYS, RUN_SLOW_MS } from './refresh-model';
import { useRefreshRun } from './refresh-queries';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import { CollectionProgress } from '@/components/app/status/collection-progress';
import { toast, type ToastOptions } from '@/components/ui/toast';
import type { Run } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { collectionStatusOf, isFinished, isOpenRun } from '@/lib/runs/run-status';
import { useRunReason } from '@/lib/runs/use-run-reason';

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
 * at the end, since new metrics may have arrived. A run the API no longer knows is let go of without a word;
 * one it will not say anything about, or does not answer for, with one line that it may still run.
 */
export function RefreshProgress({ scope, runId, onSettled }: RefreshProgressProps): ReactElement | null {
  const t = useTranslations('rankings.refresh');
  const reasonText = useRunReason();
  const queryClient = useQueryClient();
  const { run, gone, lost } = useRefreshRun(scope, runId);
  // The end is reported once, however many times the answer is read again
  const handled = useRef(false);
  // A run the cache already holds as ended was reported on an earlier visit to the screen
  const reportedBefore = useRef(run !== undefined && isFinished(run.status));

  useEffect(() => {
    if (handled.current) return;
    // A run that no longer exists has nothing to say: let go of it quietly
    if (gone) {
      handled.current = true;
      onSettled(runId);
      return;
    }
    if (lost !== null) {
      handled.current = true;
      toast({ id: `keyword-refresh-${runId}`, type: 'info', title: t('progress.lost') });
      onSettled(runId);
      return;
    }
    if (run === undefined || !isFinished(run.status)) return;
    handled.current = true;
    if (!reportedBefore.current) {
      toast({ id: `keyword-refresh-${runId}`, ...finishedToast(run, t, reasonText) });
      void refreshKeywords(queryClient, scope);
    }
    onSettled(runId);
  }, [run, gone, lost, runId, scope, queryClient, onSettled, t, reasonText]);

  // A run still queued after a long while is said to take longer than usual, and is followed all the same
  const queued = run?.status === 'planned';
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!queued) return undefined;
    const timer = window.setTimeout(() => setSlow(true), RUN_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [queued]);

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
  const title = queued ? (slow ? t('progress.slow') : t('progress.queued')) : t('progress.running');
  return (
    <CollectionProgress
      density="standard"
      status={collectionStatusOf(run.status)}
      text={title}
      counts={counts}
      countsText={text}
      progressText={text}
    />
  );
}

type Translate = ReturnType<typeof useTranslations<'rankings.refresh'>>;

/** The toast of a run that has ended: how it ended, with the reason when the API gave one we have words for. */
function finishedToast(
  run: Run,
  t: Translate,
  reasonText: (reason: string | null | undefined) => string | null,
): Omit<ToastOptions, 'id'> {
  const reasonWords = reasonText(run.status_reason);
  const reason = reasonWords === null ? {} : { description: reasonWords };
  switch (run.status) {
    case 'completed':
      return run.tasks_total === 0
        ? { type: 'info', title: t('finished.nothing') }
        : {
            type: 'success',
            title: t('finished.completed', {
              done: formatInteger(run.tasks_succeeded),
              total: formatInteger(run.tasks_total),
            }),
          };
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
