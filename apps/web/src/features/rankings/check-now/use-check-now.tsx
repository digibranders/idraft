'use client';

import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useState, type ReactNode } from 'react';

import { checkNowRefusal, checkNowTarget } from './check-now-model';
import { RefreshProgress } from '../refresh/refresh-progress';
import {
  endedRefreshes,
  forgetOpenRefresh,
  rememberEndedRefresh,
  rememberRefreshRun,
  useOpenRefreshes,
} from '../refresh/refresh-queries';
import { leftToday } from '../refresh/refresh-model';
import { refreshKeywords, type ProjectScope } from '../rankings-queries';
import type { RecordAction } from '@/components/app/data-table/types';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/a11y/announcer';
import { api, unwrap } from '@/lib/api/client';
import type { Run, TrackedKeywordRow } from '@/lib/api/types';
import { formatInteger } from '@/lib/format';
import { useMe } from '@/lib/session/use-me';

const CHECK_NOW_PATH = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/seo/check-now';

export interface UseCheckNowArgs {
  scope: ProjectScope;
  enabled: boolean;
  archived: boolean;
  chosen: { ids: ReadonlySet<string>; allMatching: boolean };
  onDrop: (trackedIds: ReadonlySet<string>) => void;
}

export interface CheckNowResult {
  barAction: RecordAction<TrackedKeywordRow> | null;
  inspectorAction: (trackedId: string, active: boolean) => ReactNode;
  progress: ReactNode;
}

export function useCheckNow({ scope, enabled, archived, chosen, onDrop }: UseCheckNowArgs): CheckNowResult {
  const t = useTranslations('rankings.checkNow');
  const queryClient = useQueryClient();
  const { user } = useMe();
  const open = useOpenRefreshes(scope, user.user_id, enabled, 'seo_rank');
  const { refetch } = open;
  const manual = open.data?.manual ?? null;
  const left = manual === null ? null : leftToday(manual);
  const exhausted = left === 0;

  const [started, setStarted] = useState<readonly string[]>([]);
  const [ended, setEnded] = useState<ReadonlySet<string>>(() => endedRefreshes(queryClient, scope, 'seo_rank'));
  const followed = [...started, ...(open.data?.runs ?? []).map((run) => run.run_id)].filter(
    (runId, index, all) => !ended.has(runId) && all.indexOf(runId) === index,
  );

  const onSettled = useCallback(
    (runId: string): void => {
      rememberEndedRefresh(queryClient, scope, runId, 'seo_rank');
      setEnded((prev) => new Set(prev).add(runId));
      setStarted((prev) => prev.filter((id) => id !== runId));
      forgetOpenRefresh(queryClient, scope, runId, 'seo_rank');
    },
    [queryClient, scope],
  );

  const triggerCheck = useCallback(
    async (ids: string[]): Promise<void> => {
      try {
        const answer = await unwrap(
          api.POST(CHECK_NOW_PATH, {
            params: {
              path: {
                workspace_id: scope.workspaceId,
                project_id: scope.projectId,
              },
            },
            body: { tracked_keyword_ids: ids },
          }),
        );
        const run: Run = answer.data;
        void refetch();
        rememberRefreshRun(queryClient, scope, run, 'seo_rank');
        setStarted((prev) => (prev.includes(run.run_id) ? prev : [...prev, run.run_id]));
        announce(t('progress.started'));
      } catch (error) {
        const refusal = checkNowRefusal(error, ids.length);
        if (refusal.kind === 'limit') {
          toast({ type: 'error', title: t('refused.limit') });
        } else if (refusal.kind === 'quota') {
          toast({
            type: 'error',
            title: t('refused.quota', {
              limit: formatInteger(refusal.limit),
              used: formatInteger(refusal.used),
              requested: formatInteger(refusal.requested),
            }),
          });
        } else if (refusal.kind === 'paused') {
          toast({ type: 'error', title: t('refused.paused') });
        } else if (refusal.kind === 'unknownKeyword') {
          toast({ type: 'error', title: t('refused.unknownKeyword') });
          void refreshKeywords(queryClient, scope);
          onDrop(new Set(ids));
        } else {
          toast({ type: 'error', title: t('refused.other') });
        }
      }
    },
    [scope, queryClient, refetch, t, onDrop],
  );

  const target = checkNowTarget(chosen, archived);
  const disabledReason = exhausted
    ? t('blocked.noneLeft')
    : target.kind === 'blocked'
      ? t(`blocked.${target.reason}`)
      : null;

  const barAction: RecordAction<TrackedKeywordRow> | null = enabled
    ? {
        id: 'check-now',
        label: t('action'),
        icon: RefreshCw,
        group: 'object',
        disabledReason,
        onSelect: async () => {
          if (target.kind !== 'ids') return;
          await triggerCheck(target.ids);
        },
      }
    : null;

  const inspectorAction = useCallback(
    (trackedId: string, active: boolean): ReactNode => {
      if (!enabled || !active) return null;
      return (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void triggerCheck([trackedId])}>
          {t('action')}
        </Button>
      );
    },
    [enabled, triggerCheck, t],
  );

  const progress = followed.map((runId) => (
    <RefreshProgress key={runId} scope={scope} runId={runId} workload="seo_rank" onSettled={onSettled} />
  ));

  return { barAction, inspectorAction, progress };
}
