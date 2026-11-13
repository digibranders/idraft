'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactElement } from 'react';

import { byEngineOrder } from '@/components/app/engine/order';
import { AiCollectionStatusView } from '@/components/app/status/ai-collection-status-view';
import { announce } from '@/lib/a11y/announcer';
import { projectKey } from '@/lib/api/keys';
import { useCan } from '@/lib/permissions';
import { degradedEngines, progressOf } from '@/lib/runs/ai-health-model';
import {
  useAiCoverage,
  useEngineNames,
  useLatestFinishedAiRunRead,
  useOpenAiRun,
  type AiRunsScope,
} from '@/lib/runs/ai-reads';
import { runInspectHref } from '@/lib/runs/run-link';

export interface AiCollectionStatusProps {
  scope: AiRunsScope;
  workspaceSlug: string;
  projectSlug: string;
  /** Called once when an AI run that was open ends, so the page reads the answers it collected. */
  onFinished: () => void;
}

/**
 * What a page of AI answers says about their collection (WP-30 task 5b): the progress of an AI run of the
 * project while one is open (D15), and the degraded notice from the newest finished run (D12). It reads
 * nothing for a member who cannot read the data. When an open run ends it announces that once, reads the
 * project's runs again (the sidebar line and the notice follow) and calls `onFinished`.
 */
export function AiCollectionStatus({
  scope,
  workspaceSlug,
  projectSlug,
  onFinished,
}: AiCollectionStatusProps): ReactElement | null {
  const t = useTranslations('runs');
  const queryClient = useQueryClient();
  const canRead = useCan('data:read');
  const open = useOpenAiRun(scope, canRead);
  const latestRead = useLatestFinishedAiRunRead(scope, canRead);
  const latest = latestRead.run;
  const coverage = useAiCoverage(scope, latest?.run_id ?? '', latest !== null, false);
  const engineName = useEngineNames(scope, canRead);

  // The newest `onFinished` without making the effect below depend on it: a page that passes a new function
  // on every render must not read its answers again for that
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);
  const wasOpen = useRef(false);
  const message = t('progress.finished');
  useEffect(() => {
    if (open !== null) {
      wasOpen.current = true;
      return;
    }
    // Only the end of a run this component saw open: a page that opens on a finished run says nothing
    if (!wasOpen.current) return;
    wasOpen.current = false;
    announce(message);
    void queryClient.invalidateQueries({ queryKey: [...projectKey(scope.workspaceId, scope.projectId), 'runs'] });
    finished.current();
  }, [open, message, queryClient, scope.workspaceId, scope.projectId]);

  const answer = coverage.data?.data;
  const degraded =
    answer === undefined
      ? []
      : degradedEngines(byEngineOrder(answer.by_engine, (row) => row.engine_code)).map((row) => ({
          ...row,
          name: engineName(row.engine),
        }));
  return (
    <AiCollectionStatusView
      progress={
        open === null
          ? null
          : { counts: progressOf(open), href: runInspectHref(workspaceSlug, projectSlug, open.run_id) }
      }
      notice={
        latest === null || degraded.length === 0
          ? null
          : { engines: degraded, href: runInspectHref(workspaceSlug, projectSlug, latest.run_id) }
      }
      // Either read failing leaves a degraded run unflagged, so either one says so, quietly, and retries itself
      failure={
        latestRead.isError
          ? { onRetry: () => void latestRead.refetch(), retrying: latestRead.isFetching }
          : answer === undefined && coverage.isError
            ? { onRetry: () => void coverage.refetch(), retrying: coverage.isFetching }
            : null
      }
    />
  );
}
