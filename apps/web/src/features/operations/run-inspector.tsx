'use client';

import { ClipboardList, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';

import { RUN_STATUS_KEYS, taskStatusRows, taskSummary, TRIGGER_KEYS } from './run-model';
import { useRunDetail, type RunsScope } from './runs-queries';
import { Inspector } from '@/components/app/inspector/inspector';
import { InspectorBody } from '@/components/app/inspector/inspector-tabs';
import type { InspectorNavigation } from '@/components/app/inspector/inspector-header';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { KeyValues, type KeyValue } from '@/components/app/inspector/key-values';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { CollectionStatusIcon } from '@/components/app/status/collection-progress';
import { isApiProblem } from '@/lib/api/problem';
import type { Run, RunDetail } from '@/lib/api/types';
import { EMPTY_VALUE, formatCurrency, formatDetailDateTime, formatInteger } from '@/lib/format';
import { money } from '@/lib/format/money';
import { collectionStatusOf } from '@/lib/runs/run-status';
import { useRunReason } from '@/lib/runs/use-run-reason';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

export interface RunInspectorProps {
  scope: RunsScope;
  runId: string;
  /** The run's row of the list, so the title and the summary show while the detail loads; `null` from a shared link. */
  row: Run | null;
  /** The project's time zone, for dates. */
  timeZone: string;
  /** "12 of 986"; `null` when the run is not in the list. */
  positionText: string | null;
  navigation: InspectorNavigation | null;
  onStep: ((direction: 'next' | 'previous') => void) | undefined;
  onClose: () => void;
}

/**
 * The inspector of one run (17-empty-loading-error-states.md section 4.2, "Full" density, for what part 1
 * has): its status in the header, a summary of what it is, when it ran and what it cost, and its tasks by
 * status. The task table, dead letters and provider calls arrive with Operations and the tasks API.
 */
export function RunInspector({
  scope,
  runId,
  row,
  timeZone,
  positionText,
  navigation,
  onStep,
  onClose,
}: RunInspectorProps): ReactElement {
  const t = useTranslations('runs');
  const common = useTranslations('common');
  const errors = useTranslations('status.error');
  const inspector = useTranslations('inspector');
  const workloadName = useWorkloadName();
  const reasonText = useRunReason();
  const detail = useRunDetail(scope, runId);
  const run: Run | RunDetail | null = detail.data?.data ?? row;
  const notFound = isApiProblem(detail.error, 'not_found');
  const errorId = isApiProblem(detail.error) ? detail.error.requestId : null;

  const when = (instant: string | null): string =>
    instant === null ? EMPTY_VALUE : formatDetailDateTime(instant, timeZone);
  const cost = (value: string | null): string => (value === null ? EMPTY_VALUE : formatCurrency(money(value)));
  const startedBy = (candidate: Run): string =>
    candidate.created_by === null || candidate.created_by.actor_type === 'system'
      ? t('inspector.system')
      : candidate.created_by.label;

  const summary = (candidate: Run): KeyValue[] => {
    const reason = reasonText(candidate.status_reason) ?? candidate.status_reason;
    return [
      { id: 'trigger', label: t('inspector.trigger'), value: t(`triggers.${TRIGGER_KEYS[candidate.trigger]}`) },
      {
        id: 'window',
        label: t('inspector.window'),
        value: t('window', { start: when(candidate.window_start), end: when(candidate.window_end) }),
      },
      { id: 'started', label: t('inspector.started'), value: when(candidate.created_at) },
      { id: 'finished', label: t('inspector.finished'), value: when(candidate.completed_at) },
      { id: 'startedBy', label: t('inspector.startedBy'), value: startedBy(candidate) },
      { id: 'estimate', label: t('inspector.estimate'), value: cost(candidate.estimated_cost_usd) },
      { id: 'actual', label: t('inspector.actual'), value: cost(candidate.actual_cost_usd) },
      ...(reason === null || reason === '' ? [] : [{ id: 'reason', label: t('inspector.reason'), value: reason }]),
      ...(candidate.blocked_by_budget_id === null
        ? []
        : [{ id: 'budget', label: t('inspector.budget'), value: t('inspector.blockedBy') }]),
    ];
  };

  const failedTitle = t('inspector.loadFailed');
  const loadError: ReactNode = (
    <InlineError
      title={failedTitle}
      reason={t('loadFailedReason')}
      errorId={
        errorId === null
          ? null
          : {
              id: errorId,
              label: errors('errorId', { id: errorId }),
              copyLabel: errors('copyErrorId'),
              copiedLabel: errors('copied'),
            }
      }
      onRetry={() => void detail.refetch()}
      retrying={detail.isFetching}
      retryLabel={common('retry')}
    />
  );

  const tasks = detail.data?.data;
  const counts = tasks === undefined ? null : taskSummary(tasks);
  const taskRows = tasks === undefined ? [] : taskStatusRows(tasks.tasks_by_status);

  return (
    <Inspector
      type="run"
      backLabel={t('inspector.back')}
      onClose={onClose}
      onStep={onStep}
      header={{
        title: run === null ? t('inspector.type') : workloadName(run.workload),
        typeLabel: t('inspector.type'),
        typeNoun: t('inspector.noun'),
        positionText,
        navigation,
        badges:
          run === null ? null : (
            <span className="inline-flex items-center gap-1.5 type-body">
              <CollectionStatusIcon status={collectionStatusOf(run.status)} />
              {t(`statuses.${RUN_STATUS_KEYS[run.status]}`)}
            </span>
          ),
        moreActions: [],
      }}
    >
      <InspectorBody>
        {detail.isError && run === null ? (
          notFound ? (
            <EmptyState
              variant="inline"
              title={failedTitle}
              reason={inspector('notFound', { type: t('inspector.noun') })}
              headingLevel={3}
            />
          ) : (
            loadError
          )
        ) : (
          <>
            <InspectorSection
              title={t('inspector.summary')}
              icon={ClipboardList}
              status={run === null ? 'loading' : 'ready'}
            >
              {run === null ? null : <KeyValues items={summary(run)} />}
            </InspectorSection>
            <InspectorSection
              title={t('inspector.byStatus')}
              icon={ListChecks}
              // A poll that fails after a good read leaves what is on screen, and says so; the error view is
              // for a read that has given nothing yet
              status={
                tasks === undefined ? (detail.isError ? 'error' : 'loading') : taskRows.length === 0 ? 'empty' : 'ready'
              }
              error={loadError}
              empty={
                <EmptyState
                  variant="inline"
                  title={t('inspector.noTasks')}
                  reason={t('inspector.noTasksReason')}
                  headingLevel={3}
                />
              }
            >
              {counts === null ? null : (
                <div className="flex flex-col gap-2">
                  {detail.isError ? <p className="type-meta">{t('inspector.stale')}</p> : null}
                  <p className="type-meta">
                    {t('tasks', {
                      done: formatInteger(counts.done),
                      total: formatInteger(counts.total),
                      failed: formatInteger(counts.failed),
                    })}
                  </p>
                  <KeyValues
                    items={taskRows.map((task) => ({
                      id: task.code,
                      label: task.key === null ? task.code : t(`taskStatuses.${task.key}`),
                      value: <span className="num">{formatInteger(task.count)}</span>,
                    }))}
                  />
                </div>
              )}
            </InspectorSection>
          </>
        )}
      </InspectorBody>
    </Inspector>
  );
}
