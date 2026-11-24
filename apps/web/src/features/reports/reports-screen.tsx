'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactElement } from 'react';

import { NewLinkDialog } from './new-link-dialog';
import { ScheduleDialog } from './schedule-dialog';
import { InlineError } from '@/components/app/status/inline-error';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { formatTableDate } from '@/lib/format';
import { reasonOf } from '@/lib/internal-links/problem-reason';
import { useCan } from '@/lib/permissions';
import {
  deleteReportScheduleMutation,
  refreshReports,
  reportSchedulesQuery,
  reportSharesQuery,
  revokeReportShareMutation,
  updateReportScheduleMutation,
} from '@/lib/reports/queries';
import {
  SCHEDULES_MAX,
  type ReportSchedule,
  type ReportShare,
  type ReportShareState,
  type ReportsScope,
} from '@/lib/reports/types';

const STATE_TONE = { active: 'positive', expired: 'neutral', revoked: 'negative' } as const satisfies Record<
  ReportShareState,
  'positive' | 'neutral' | 'negative'
>;

export interface ReportsScreenProps extends ReportsScope {
  project: { name: string };
  timeZone: string;
}

function LinksSection({ scope, timeZone }: { scope: ReportsScope; timeZone: string }): ReactElement {
  const t = useTranslations('reports.links');
  const common = useTranslations('common');
  const canWrite = useCan('projects:write');
  const queryClient = useQueryClient();
  const shares = useQuery(reportSharesQuery(scope));
  const revoke = useMutation(revokeReportShareMutation);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ReportShare | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const columns: PlainColumn<ReportShare>[] = [
    { id: 'made', header: t('columns.made'), cell: (share) => formatTableDate(share.created_at, timeZone) },
    {
      id: 'expires',
      header: t('columns.expires'),
      cell: (share) =>
        share.state === 'revoked' && share.revoked_at !== null
          ? t('revokedOn', { date: formatTableDate(share.revoked_at, timeZone) })
          : formatTableDate(share.expires_at, timeZone),
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (share) => <Badge tone={STATE_TONE[share.state]}>{t(`state.${share.state}`)}</Badge>,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      hideHeader: true,
      actions: true,
      cell: (share) =>
        canWrite && share.state === 'active' ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('revokeLabel', { date: formatTableDate(share.created_at, timeZone) })}
            onClick={() => {
              setRevokeError(null);
              setRevoking(share);
            }}
          >
            {t('revoke')}
          </Button>
        ) : null,
    },
  ];

  const confirmRevoke = async (): Promise<void> => {
    if (revoking === null) return;
    try {
      await revoke.mutateAsync({
        params: {
          path: { workspace_id: scope.workspaceId, project_id: scope.projectId, report_share_id: revoking.id },
        },
      });
    } catch (error) {
      setRevokeError(reasonOf(error) || t('revokeFailedReason'));
      throw error;
    }
    toast({ type: 'success', title: t('revoked') });
    void refreshReports(queryClient, scope);
  };

  return (
    <section aria-labelledby="reports-links" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="reports-links" className="type-section-title">
            {t('title')}
          </h2>
          <p className="type-body text-foreground-secondary">{canWrite ? t('description') : t('needsRole')}</p>
        </div>
        {canWrite ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t('new')}
          </Button>
        ) : null}
      </div>
      <PlainTable
        caption={t('title')}
        columns={columns}
        rows={shares.data?.data ?? []}
        rowKey={(share) => share.id}
        status={shares.isError ? 'error' : shares.data === undefined ? 'loading' : 'ready'}
        errorState={
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={null}
            onRetry={() => void shares.refetch()}
            retrying={shares.isFetching}
            retryLabel={common('retry')}
          />
        }
        emptyText={t('empty')}
        skeletonRows={2}
      />
      <NewLinkDialog open={creating} onOpenChange={setCreating} scope={scope} timeZone={timeZone} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t('revokeTitle')}
        description={t('revokeText')}
        confirmLabel={t('revokeConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmRevoke}
        error={revokeError}
      />
    </section>
  );
}

function SchedulesSection({ scope, timeZone }: { scope: ReportsScope; timeZone: string }): ReactElement {
  const t = useTranslations('reports.schedules');
  const common = useTranslations('common');
  const canWrite = useCan('projects:write');
  const queryClient = useQueryClient();
  const schedules = useQuery(reportSchedulesQuery(scope));
  const update = useMutation(updateReportScheduleMutation);
  const remove = useMutation(deleteReportScheduleMutation);
  const [editing, setEditing] = useState<ReportSchedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ReportSchedule | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = schedules.data?.data ?? [];
  const path = (
    schedule: ReportSchedule,
  ): { workspace_id: string; project_id: string; report_schedule_id: string } => ({
    workspace_id: scope.workspaceId,
    project_id: scope.projectId,
    report_schedule_id: schedule.id,
  });

  const toggle = (schedule: ReportSchedule): void => {
    setBusy(schedule.id);
    update.mutate(
      { params: { path: path(schedule) }, body: { paused: !schedule.paused } },
      {
        onSuccess: () => toast({ type: 'success', title: t(schedule.paused ? 'resumed' : 'paused') }),
        onError: (error) =>
          toast({ type: 'error', title: t('toggleFailed'), description: reasonOf(error) || t('failedReason') }),
        onSettled: () => {
          setBusy(null);
          void refreshReports(queryClient, scope);
        },
      },
    );
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync({ params: { path: path(deleting) } });
    } catch (error) {
      setDeleteError(reasonOf(error) || t('deleteFailedReason'));
      throw error;
    }
    toast({ type: 'success', title: t('deleted') });
    void refreshReports(queryClient, scope);
  };

  const columns: PlainColumn<ReportSchedule>[] = [
    { id: 'frequency', header: t('columns.frequency'), cell: (schedule) => t(`frequency.${schedule.frequency}`) },
    {
      id: 'recipients',
      header: t('columns.recipients'),
      wrap: true,
      cell: (schedule) => (
        <span className="flex flex-col">
          {schedule.recipients.map((address) => (
            <span key={address}>{address}</span>
          ))}
        </span>
      ),
    },
    {
      id: 'next',
      header: t('columns.next'),
      description: t('nextDescription'),
      cell: (schedule) => (schedule.paused ? t('notScheduled') : formatTableDate(schedule.next_run_at, 'UTC')),
    },
    {
      id: 'status',
      header: t('columns.status'),
      wrap: true,
      cell: (schedule) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={schedule.paused ? 'neutral' : 'positive'}>
            {t(schedule.paused ? 'statePaused' : 'stateRunning')}
          </Badge>
          {schedule.last_error === null ? (
            schedule.last_sent_at === null ? null : (
              <span className="type-meta">
                {t('lastSent', { date: formatTableDate(schedule.last_sent_at, timeZone) })}
              </span>
            )
          ) : (
            <span className="type-meta text-negative-text">{t('lastFailed', { reason: schedule.last_error })}</span>
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      hideHeader: true,
      actions: true,
      cell: (schedule) =>
        canWrite ? (
          <span className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(schedule)}>
              {t('edit')}
            </Button>
            <Button variant="secondary" size="sm" loading={busy === schedule.id} onClick={() => toggle(schedule)}>
              {t(schedule.paused ? 'resume' : 'pause')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDeleteError(null);
                setDeleting(schedule);
              }}
            >
              {t('delete')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="reports-schedules" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="reports-schedules" className="type-section-title">
            {t('title')}
          </h2>
          <p className="type-body text-foreground-secondary">{t('description')}</p>
        </div>
        {canWrite ? (
          <Button
            variant="primary"
            icon={Plus}
            disabled={rows.length >= SCHEDULES_MAX}
            onClick={() => setEditing('new')}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>
      <PlainTable
        caption={t('title')}
        columns={columns}
        rows={rows}
        rowKey={(schedule) => schedule.id}
        status={schedules.isError ? 'error' : schedules.data === undefined ? 'loading' : 'ready'}
        errorState={
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={null}
            onRetry={() => void schedules.refetch()}
            retrying={schedules.isFetching}
            retryLabel={common('retry')}
          />
        }
        emptyText={t('empty')}
        skeletonRows={2}
      />
      <ScheduleDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        scope={scope}
        schedule={editing === 'new' ? null : editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t('deleteTitle')}
        description={t('deleteText')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </section>
  );
}

/**
 * Reports: the project's report links and scheduled emails. A link opens a read-only report without signing in, shows
 * no costs, expires and can be revoked; a schedule emails a fresh link every week or month. Members who read data see
 * both lists; making, changing and revoking need `projects:write`.
 */
export function ReportsScreen({ workspaceId, projectId, project, timeZone }: ReportsScreenProps): ReactElement {
  const t = useTranslations('reports');
  const scope: ReportsScope = { workspaceId, projectId };
  return (
    <div className={`${PAGE_CLASS} gap-6`}>
      <PageHeader title={t('title')} meta={t('meta', { project: project.name })} />
      <LinksSection scope={scope} timeZone={timeZone} />
      <SchedulesSection scope={scope} timeZone={timeZone} />
    </div>
  );
}
