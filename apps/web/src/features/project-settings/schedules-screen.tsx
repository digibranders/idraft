'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { ScheduleDialog } from './schedule-dialog';
import { isEditableSchedule, type EditableSchedule } from './schedule-model';
import {
  DELETE_SCHEDULE,
  PAUSE_SCHEDULE,
  refreshSchedules,
  RESUME_SCHEDULE,
  schedulesQuery,
  type ScheduleScope,
} from './schedule-queries';
import { useScheduleWords, useSelectorNames } from './schedule-words';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Menu, type MenuItemDef } from '@/components/ui/menu';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { Schedule } from '@/lib/api/types';
import { formatTableDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { runsPath } from '@/lib/routes/paths';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

const SKELETON_ROWS = 3;

export interface SchedulesScreenProps extends ScheduleScope {
  workspaceSlug: string;
  projectSlug: string;
  /** The project's time zone: where a schedule's rule is read unless it names a zone of its own. */
  timeZone: string;
}

/**
 * Settings > Project settings > Schedules (20 section 5.19.8): the project's schedules with what they
 * collect, when, and when they run next, and the dialog that makes and changes them. A member with
 * `schedules:write` also pauses, resumes and deletes; everyone else sees the list read-only. A change is
 * pessimistic: the screen waits for the answer and reads the list again.
 */
export function SchedulesScreen(props: SchedulesScreenProps): ReactNode {
  const { workspaceId, projectId, workspaceSlug, projectSlug, timeZone } = props;
  const scope: ScheduleScope = { workspaceId, projectId };
  const t = useTranslations('projectSettings.schedules');
  const common = useTranslations('common');
  const canWrite = useCan('schedules:write');
  const queryClient = useQueryClient();
  const schedules = useQuery(schedulesQuery(scope));
  const errorId = useErrorId(schedules.error);
  const names = useSelectorNames(scope);
  const words = useScheduleWords();
  const workloadName = useWorkloadName();
  const pause = useMutation(PAUSE_SCHEDULE);
  const resume = useMutation(RESUME_SCHEDULE);
  const remove = useMutation(DELETE_SCHEDULE);
  const [editing, setEditing] = useState<EditableSchedule | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Which schedule a pause or a resume is working on: its menu waits, and no second request starts
  const [busy, setBusy] = useState<string | null>(null);
  // Whether the dialog was opened from the empty state, whose button is gone once a schedule is made
  const [fromEmptyState, setFromEmptyState] = useState(false);
  // Once a row is gone together with its menu button, a closing delete question hands focus to the heading
  const [rowGone, setRowGone] = useState(false);
  // Whether focus goes to the heading when the edit dialog goes away: what opened it is gone, or about to be
  const focusHeading = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // The schedule whose menu opened the dialog: focus goes back to that row's menu button when the dialog
  // closes. The button is found by its attribute when it is needed, since a ref callback on a row is
  // detached and attached again at every render. Read by what closes the dialogs, so kept in a ref.
  const [openedFrom, setOpenedFrom] = useState<string | null>(null);
  const latest = useRef({ openedFrom, rowGone });
  useEffect(() => {
    latest.current = { openedFrom, rowGone };
  });
  const menuButtonOfOpener = useCallback((): HTMLElement | null => {
    const from = latest.current.openedFrom;
    return from === null
      ? null
      : (document.querySelector<HTMLElement>(`[data-schedule-menu="${from}"]`) ?? heading.current);
  }, []);
  const deleteFocus = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current(): HTMLElement | null {
        return latest.current.rowGone ? heading.current : menuButtonOfOpener();
      },
    }),
    [menuButtonOfOpener],
  );
  const rows = schedules.data?.data ?? [];
  // A role without `data:read` cannot list the schedules at all, which is not a failure to retry
  const forbidden = schedules.isError && isApiProblem(schedules.error, 'forbidden');
  const path = (schedule: Schedule): { workspace_id: string; project_id: string; schedule_id: string } => ({
    workspace_id: workspaceId,
    project_id: projectId,
    schedule_id: schedule.schedule_id,
  });

  const toggle = async (schedule: Schedule): Promise<void> => {
    setBusy(schedule.schedule_id);
    try {
      if (schedule.is_active) {
        await pause.mutateAsync({ params: { path: path(schedule) } });
        toast({ type: 'success', title: t('pausedDone', { name: schedule.name }) });
      } else {
        const resumed = await resume.mutateAsync({ params: { path: path(schedule) } });
        toast({
          type: 'success',
          title: t('resumedDone', { name: schedule.name }),
          description: words.nextRun(resumed.data, timeZone),
        });
      }
    } catch (error) {
      if (isApiProblem(error, 'not_found')) {
        toast({ type: 'info', title: t('gone', { name: schedule.name }) });
      } else {
        toast({
          type: 'error',
          title: t(schedule.is_active ? 'pauseFailed' : 'resumeFailed', { name: schedule.name }),
        });
      }
    } finally {
      setBusy(null);
      void refreshSchedules(queryClient, scope);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    setDeleteError(null);
    const { name } = deleting;
    try {
      await remove.mutateAsync({ params: { path: path(deleting) } });
    } catch (error) {
      if (isApiProblem(error, 'not_found')) {
        toast({ type: 'info', title: t('gone', { name }) });
        setRowGone(true);
        void refreshSchedules(queryClient, scope);
        return;
      }
      // The problem names the code and gives a sentence in English; the count of keywords is not part of it
      setDeleteError(isApiProblem(error, 'schedule_in_use') ? t('deleteInUse') : t('deleteFailed'));
      throw error;
    }
    toast({ type: 'success', title: t('deleted', { name }), description: t('deletedHint') });
    setRowGone(true);
    void refreshSchedules(queryClient, scope);
  };

  const itemsFor = (schedule: Schedule): MenuItemDef[] => {
    const items: MenuItemDef[] = [];
    if (isEditableSchedule(schedule)) {
      items.push({
        id: 'edit',
        label: t('menu.edit'),
        onSelect: () => {
          setFromEmptyState(false);
          setOpenedFrom(schedule.schedule_id);
          setEditing(schedule);
        },
      });
    }
    items.push({
      id: 'toggle',
      label: schedule.is_active ? t('menu.pause') : t('menu.resume'),
      onSelect: () => void toggle(schedule),
    });
    items.push({
      id: 'delete',
      label: t('menu.delete'),
      tone: 'destructive',
      onSelect: () => {
        setRowGone(false);
        setOpenedFrom(schedule.schedule_id);
        setDeleting(schedule);
      },
    });
    return items;
  };

  const columns: PlainColumn<Schedule>[] = [
    {
      id: 'schedule',
      header: t('columns.schedule'),
      wrap: true,
      cell: (schedule) => (
        <span className="flex flex-col">
          <span className="type-body text-foreground">{schedule.name}</span>
          <span className="type-meta">{workloadName(schedule.workload)}</span>
        </span>
      ),
    },
    {
      id: 'collects',
      header: t('columns.collects'),
      wrap: true,
      cell: (schedule) => words.collects(schedule.selector, names),
    },
    {
      id: 'when',
      header: t('columns.when'),
      wrap: true,
      cell: (schedule) => (
        <>
          {words.when(schedule)}
          {schedule.timezone === timeZone ? null : <span className="block type-meta">{schedule.timezone}</span>}
        </>
      ),
    },
    {
      id: 'next',
      header: t('columns.next'),
      // 22-content-formatting.md section 4: a column of times says which zone they are in
      description: t('columns.nextZone', { timeZone }),
      cell: (schedule) => (
        <>
          {schedule.is_active ? (
            <span className="block num type-body whitespace-nowrap text-foreground-secondary">
              {formatTableDateTime(schedule.next_run_at, schedule.timezone)}
            </span>
          ) : (
            <Badge tone="warning">{t('pausedBadge')}</Badge>
          )}
          {/* The API names the last run by its id only, so Runs is where its time is */}
          <span className="block type-meta">
            {schedule.last_run_id === null ? (
              t('neverRun')
            ) : (
              <TextLink render={<Link href={runsPath(workspaceSlug, projectSlug)} />}>{t('lastRun')}</TextLink>
            )}
          </span>
        </>
      ),
    },
    ...(canWrite
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            hideHeader: true,
            actions: true,
            cell: (schedule: Schedule) => (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    icon={MoreHorizontal}
                    size="icon-sm"
                    variant="ghost"
                    label={t('actionsFor', { name: schedule.name })}
                    // Only the schedule being changed waits, and keeps focus while it does
                    disabled={busy === schedule.schedule_id}
                    focusableWhenDisabled
                    data-schedule-menu={schedule.schedule_id}
                  />
                }
                items={itemsFor(schedule)}
              />
            ),
          } satisfies PlainColumn<Schedule>,
        ]
      : []),
  ];

  const newSchedule = (
    <Button
      variant="primary"
      icon={Plus}
      onClick={() => {
        setFromEmptyState(rows.length === 0);
        setOpenedFrom(null);
        setEditing('new');
      }}
    >
      {t('newSchedule')}
    </Button>
  );

  return (
    <section aria-labelledby="schedules-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="schedules-title" ref={heading} tabIndex={-1} className="type-section-title outline-none">
            {t('title')}
          </h2>
          <p className="mt-1 type-meta">{t('description')}</p>
        </div>
        {canWrite && rows.length > 0 ? newSchedule : null}
      </div>
      {canWrite || forbidden ? null : (
        <Banner tone="info" placement="region" lead={t('readOnlyLead')} message={t('readOnly')} />
      )}
      {schedules.isError ? (
        forbidden ? (
          <Banner tone="info" placement="region" message={t('forbidden')} />
        ) : (
          <InlineError
            title={t('loadFailed')}
            reason={t('loadFailedReason')}
            errorId={errorId}
            onRetry={() => void schedules.refetch()}
            retrying={schedules.isFetching}
            retryLabel={common('retry')}
          />
        )
      ) : !schedules.isPending && rows.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          headingLevel={3}
          title={t('emptyTitle')}
          reason={canWrite ? t('emptyReason') : t('emptyReasonReadOnly')}
          primaryAction={canWrite ? newSchedule : undefined}
        />
      ) : (
        <PlainTable<Schedule>
          caption={t('tableLabel')}
          columns={columns}
          rows={rows}
          rowKey={(schedule) => schedule.schedule_id}
          status={schedules.isPending ? 'loading' : 'ready'}
          errorState={null}
          emptyText={t('emptyTitle')}
          skeletonRows={SKELETON_ROWS}
        />
      )}
      <ScheduleDialog
        scope={scope}
        schedule={editing}
        timeZone={timeZone}
        onClose={(outcome) => {
          // The first schedule is made from the empty state, whose button is gone once the list has a row; a
          // schedule deleted by someone else takes its row, and the menu the dialog came from, with it
          focusHeading.current = outcome === 'gone' || (outcome === 'created' && fromEmptyState);
          setEditing(null);
        }}
        // Read when the dialog goes away, after `onClose` has said how it ended; `true` is back to what opened it
        finalFocus={() => (focusHeading.current ? heading.current : menuButtonOfOpener()) ?? true}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
        finalFocus={deleteFocus}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={t('deleteDescription', { name: deleting?.name ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={common('cancel')}
        onConfirm={confirmDelete}
        error={deleteError}
      />
    </section>
  );
}
