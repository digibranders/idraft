'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Ban, CircleSlash, FolderOpen } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { RunInspector } from './run-inspector';
import { DEFAULT_SORT, rowId, SORT_FIELDS, useRunColumns } from './run-columns';
import { canCancel, RUN_STATUS_KEYS, RUN_STATUSES, RUN_TRIGGERS, RUN_WORKLOADS, TRIGGER_KEYS } from './run-model';
import { CANCEL_RUN, MAX_RUNS, refreshRuns, useMonthRuns, type RunFilters, type RunsScope } from './runs-queries';
import { DataTable } from '@/components/app/data-table/data-table';
import { gridFocus } from '@/components/app/data-table/grid-focus';
import type { RecordAction, RowActions, TableStatus } from '@/components/app/data-table/types';
import { FilterBar } from '@/components/app/filters/filter-bar';
import { MonthSelect } from '@/components/app/filters/month-select';
import { ReadOnlyFilterChips } from '@/components/app/filters/read-only-chips';
import type { FilterField } from '@/components/app/filters/types';
import { useUrlFilters } from '@/components/app/filters/use-url-filters';
import { InspectorLayout } from '@/components/app/inspector/inspector-layout';
import { useInspector } from '@/components/app/inspector/use-inspector';
import { PAGE_CLASS, PageHeader } from '@/components/app/shell/page-header';
import { Banner } from '@/components/app/status/banner';
import { EmptyState } from '@/components/app/status/empty-state';
import { InlineError } from '@/components/app/status/inline-error';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { TextLink } from '@/components/ui/text-link';
import { toast } from '@/components/ui/toast';
import { isApiProblem } from '@/lib/api/problem';
import { useErrorId } from '@/lib/api/use-error-id';
import type { Run } from '@/lib/api/types';
import { useUtcDay } from '@/lib/dom/use-utc-day';
import { enumValuesOf } from '@/lib/filters/filter-values';
import { formatInteger, formatList } from '@/lib/format';
import { currentMonth, monthLabel, recentMonths, type MonthKey } from '@/lib/format/month';
import { formatInspectTarget } from '@/lib/inspector/placement';
import { can, useCan, useMembership } from '@/lib/permissions';
import { projectPath, workspacePath } from '@/lib/routes/paths';
import { useMe } from '@/lib/session/use-me';
import {
  DEFAULT_DENSITY,
  formatColumns,
  formatSort,
  parseColumns,
  parseDensity,
  parseSort,
  sameSort,
  type Density,
  type SortKey,
} from '@/lib/tables/table-state';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

export interface RunsProject {
  id: string;
  slug: string;
  name: string;
  /** The project's time zone, for the times of its runs. */
  timeZone: string;
}

export interface RunsScreenProps {
  workspaceId: string;
  workspaceSlug: string;
  /**
   * The project whose runs are listed: the one the page is in. `null` only on the workspace's own page,
   * for a member who can open no project, which then says there is nothing to show.
   */
  project: RunsProject | null;
}

/** The URL's keys besides the filters': the month, and the table's state. */
const VIEW_STATE = {
  month: parseAsString,
  q: parseAsString.withDefault(''),
  sort: parseAsString,
  cols: parseAsString,
  density: parseAsString,
  inspect: parseAsString,
  itab: parseAsString,
};

/**
 * Operations > Runs of one project (20-frontend-specification.md section 5.18): the project's collection
 * runs of a month, newest first, with their status, tasks and cost, a run inspector, and Cancel for the
 * runs the member may stop. The project is the route (`/{workspace}/{project}/ops/runs`), so the page has
 * no project choice; the month and the filters live in the URL.
 */
export function RunsScreen(props: RunsScreenProps): ReactNode {
  const t = useTranslations('runs');
  const canRead = useCan('data:read');
  const { project } = props;
  // Inside a project its root opens the first destination the role can open; the workspace's root is the way
  // back only for the page outside any project
  const backPath =
    project === null ? workspacePath(props.workspaceSlug) : projectPath(props.workspaceSlug, project.slug);
  if (!canRead) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState
          icon={Ban}
          title={t('noAccessTitle')}
          reason={t('noAccessReason')}
          headingLevel={2}
          secondaryAction={<TextLink render={<Link href={backPath} />}>{t('backToOverview')}</TextLink>}
        />
      </div>
    );
  }
  if (project === null) {
    return (
      <div className={PAGE_CLASS}>
        <PageHeader title={t('title')} />
        <EmptyState
          icon={FolderOpen}
          title={t('noProjects')}
          reason={t('noProjectsReason')}
          headingLevel={2}
          secondaryAction={
            <TextLink render={<Link href={workspacePath(props.workspaceSlug)} />}>{t('toProjects')}</TextLink>
          }
        />
      </div>
    );
  }
  return <RunsContent workspaceId={props.workspaceId} project={project} />;
}

function RunsContent({ workspaceId, project }: Readonly<{ workspaceId: string; project: RunsProject }>): ReactNode {
  const t = useTranslations('runs');
  const common = useTranslations('common');
  const locale = useLocale();
  const workloadName = useWorkloadName();
  const queryClient = useQueryClient();
  const membership = useMembership();
  const { user } = useMe();

  // The same date all UTC day, so the months it offers do not change under the person; a new day is read
  const now = useUtcDay();
  const months = useMemo(() => recentMonths(now), [now]);
  const thisMonth = currentMonth(now);
  const [view, setView] = useQueryStates(VIEW_STATE, { history: 'replace' });
  const month: MonthKey = months.find((candidate) => candidate === view.month) ?? thisMonth;
  const label = monthLabel(month, locale);
  const scope = useMemo((): RunsScope => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);

  const fields = useMemo(
    (): FilterField[] => [
      {
        id: 'workload',
        kind: 'enum',
        label: t('filters.workload'),
        multi: true,
        options: RUN_WORKLOADS.map((value) => ({ value, label: workloadName(value) })),
      },
      {
        id: 'status',
        kind: 'enum',
        label: t('filters.status'),
        multi: true,
        options: RUN_STATUSES.map((value) => ({ value, label: t(`statuses.${RUN_STATUS_KEYS[value]}`) })),
      },
      {
        id: 'trigger',
        kind: 'enum',
        label: t('filters.trigger'),
        multi: true,
        options: RUN_TRIGGERS.map((value) => ({ value, label: t(`triggers.${TRIGGER_KEYS[value]}`) })),
      },
    ],
    [t, workloadName],
  );
  // A filter of a shared link that does not read is left out, and the person is told (13 section 5)
  const [values, setValues] = useUrlFilters(fields, {
    onDropped: (dropped) =>
      toast({
        type: 'info',
        title: t('droppedFilters.title', { count: dropped.length }),
        description: t('droppedFilters.description', {
          fields: formatList(
            dropped.map((field) => field.label),
            locale,
          ),
        }),
      }),
  });
  const filters = useMemo((): RunFilters => {
    const workloads = enumValuesOf(values.workload);
    const statuses = enumValuesOf(values.status);
    const triggers = enumValuesOf(values.trigger);
    return {
      workloads: RUN_WORKLOADS.filter((value) => workloads.includes(value)),
      statuses: RUN_STATUSES.filter((value) => statuses.includes(value)),
      triggers: RUN_TRIGGERS.filter((value) => triggers.includes(value)),
    };
  }, [values]);
  const filtered = Object.keys(values).length > 0;

  const list = useMonthRuns(scope, month, filters);
  const { columns, searchText, rowName } = useRunColumns(project.timeZone);
  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const sort = useMemo((): readonly SortKey[] => {
    const parsed = parseSort(view.sort, SORT_FIELDS);
    return parsed.length === 0 ? DEFAULT_SORT : parsed;
  }, [view.sort]);
  const visible = useMemo(() => parseColumns(view.cols, columnIds, ['workload']), [view.cols, columnIds]);
  const density = parseDensity(view.density);

  // Another month leaves the run that was open: it belongs to the other list
  const chooseMonth = (next: string | null): void => {
    void setView({ month: next, inspect: null, itab: null });
  };

  // The inspector: opened from a row, stepping in the table's order
  const inspector = useInspector();
  const openId = inspector.target?.type === 'run' ? inspector.target.id : null;
  const [order, setOrder] = useState<readonly string[]>([]);
  const at = inspector.position(order);
  const step = (direction: 'next' | 'previous'): void => {
    if (at === null || (direction === 'next' ? at.index === at.count - 1 : at.index === 0)) return;
    inspector.step(direction, order);
  };
  const openRow = openId === null ? null : (list.rows.find((row) => row.run_id === openId) ?? null);
  const onRowOpen = (row: Run, intent: 'inspector' | 'new-tab'): void => {
    const target = { type: 'run' as const, id: row.run_id };
    if (intent === 'new-tab') {
      const url = new URL(window.location.href);
      url.searchParams.set('inspect', formatInspectTarget(target));
      url.searchParams.delete('itab');
      window.open(url, '_blank', 'noopener');
      return;
    }
    if (row.run_id !== openId) inspector.open(target);
  };

  // Cancel: asked first, since tasks already sent to the provider still finish and are paid
  const [cancelling, setCancelling] = useState<Run | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancel = useMutation(CANCEL_RUN);
  const member = useMemo(
    () => ({ userId: user.user_id, permissions: membership.permissions }),
    [user.user_id, membership.permissions],
  );
  // A member who may cancel nothing gets no actions column; the others get Cancel on the runs they may stop
  const mayCancelSome = can(member.permissions, 'schedules:write') || can(member.permissions, 'runs:trigger');
  const cancelAction = (row: Run): RecordAction<Run> => ({
    id: 'cancel',
    label: t('cancel'),
    icon: CircleSlash,
    group: 'destructive',
    onSelect: () => {
      setCancelError(null);
      setCancelling(row);
    },
  });
  const rowActions: RowActions<Run> | undefined = mayCancelSome
    ? (row) => (canCancel(row, member) ? [cancelAction(row)] : [])
    : undefined;
  const confirmCancel = async (): Promise<void> => {
    if (cancelling === null) return;
    // The run's own project, which is the project on screen unless the page moved on since the dialog opened
    const runScope: RunsScope = { workspaceId, projectId: cancelling.project_id };
    setCancelError(null);
    try {
      await cancel.mutateAsync({
        params: {
          path: { workspace_id: workspaceId, project_id: cancelling.project_id, run_id: cancelling.run_id },
        },
      });
    } catch (error) {
      if (isApiProblem(error, 'invalid_state_transition')) {
        setCancelError(t('cancelEnded'));
        void refreshRuns(queryClient, runScope);
      } else if (isApiProblem(error, 'forbidden')) {
        setCancelError(t('cancelForbidden'));
      } else {
        setCancelError(t('cancelFailed'));
      }
      throw error;
    }
    toast({ type: 'success', title: t('cancelled') });
    // The list and the open run's detail read again, so no row keeps saying the run is open
    void refreshRuns(queryClient, runScope);
  };

  const status = ((): TableStatus => {
    if (list.error !== null && list.rows.length === 0) return 'error';
    if (list.loading) return 'loading';
    if (list.rows.length === 0) return filtered ? 'filtered-empty' : 'empty';
    return list.fetching ? 'refetching' : 'ready';
  })();
  const errorId = useErrorId(list.error);
  // The search is of the loaded runs, so it is what the box holds
  const searched = view.q.trim();
  const clearFilters = useCallback(() => setValues({}), [setValues]);

  const manual = list.manualRunsToday;
  const meta =
    manual === null
      ? t('meta', { project: project.name, month: label, timeZone: project.timeZone })
      : t('metaWithManual', {
          project: project.name,
          month: label,
          timeZone: project.timeZone,
          manual: t('manualToday', { used: formatInteger(manual.used), limit: formatInteger(manual.limit) }),
        });

  const runInspector =
    openId === null ? null : (
      <RunInspector
        // Another project's run is another inspector, not the same one with new data
        key={project.id}
        scope={scope}
        runId={openId}
        row={openRow}
        timeZone={project.timeZone}
        positionText={
          at === null
            ? null
            : t('inspector.position', { index: formatInteger(at.index + 1), count: formatInteger(at.count) })
        }
        navigation={
          at === null
            ? null
            : {
                onPrevious: () => step('previous'),
                onNext: () => step('next'),
                atFirst: at.index === 0,
                atLast: at.index === at.count - 1,
              }
        }
        onStep={at === null ? undefined : step}
        onClose={() => inspector.close()}
      />
    );

  return (
    <InspectorLayout inspector={runInspector}>
      <div className="flex h-page-body min-h-page-body-min flex-col gap-4 px-3 pt-5 pb-5 md:px-4 lg:px-5">
        <PageHeader title={t('title')} meta={meta} />
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-48">
            <MonthSelect
              months={months}
              value={month}
              label={t('month')}
              onValueChange={(next) => chooseMonth(next === thisMonth ? null : next)}
            />
          </div>
          <div className="min-w-0 flex-1">
            <FilterBar fields={fields} values={values} onChange={setValues} />
          </div>
        </div>
        {list.capped ? (
          <Banner tone="info" placement="region" message={t('cappedNotice', { count: formatInteger(MAX_RUNS) })} />
        ) : null}
        {list.incomplete === null ? null : (
          <Banner
            tone="warning"
            placement="region"
            live
            message={t('incomplete', { loaded: list.rows.length })}
            actions={
              <Button variant="secondary" size="sm" onClick={list.incomplete.retry} loading={list.incomplete.retrying}>
                {common('retry')}
              </Button>
            }
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable<Run>
            caption={t('caption')}
            itemNoun={{ one: t('noun.one'), other: t('noun.other') }}
            columns={columns}
            getRowId={rowId}
            rows={list.rows}
            total={list.rows.length}
            sort={sort}
            onSortChange={(next) => void setView({ sort: sameSort(next, DEFAULT_SORT) ? null : formatSort(next) })}
            defaultSort={DEFAULT_SORT}
            density={density}
            onDensityChange={(next: Density) => void setView({ density: next === DEFAULT_DENSITY ? null : next })}
            columnState={{
              visible,
              onChange: (next) => void setView({ cols: next === null ? null : formatColumns(next) }),
            }}
            search={view.q}
            onSearchChange={(next) => void setView({ q: next === '' ? null : next })}
            searchPlaceholder={t('search')}
            searchText={searchText}
            rowName={rowName}
            rowActions={rowActions}
            status={status}
            errorState={
              <InlineError
                title={t('loadFailed')}
                reason={t('loadFailedReason')}
                errorId={errorId}
                onRetry={list.refetch}
                retrying={list.fetching}
                retryLabel={common('retry')}
                live
              />
            }
            emptyState={<EmptyState title={t('empty', { month: label })} reason={t('emptyReason')} headingLevel={2} />}
            filteredEmptyState={
              searched !== '' ? (
                <EmptyState
                  title={t('searchEmpty.title', { query: searched, month: label })}
                  reason={t('searchEmpty.reason')}
                  headingLevel={2}
                  details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
                  primaryAction={
                    <Button variant="secondary" onClick={() => void setView({ q: null })}>
                      {t('searchEmpty.clear')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title={t('emptyFiltered', { month: label })}
                  reason={t('emptyFilteredReason')}
                  headingLevel={2}
                  details={filtered ? <ReadOnlyFilterChips fields={fields} values={values} /> : undefined}
                  primaryAction={
                    filtered ? (
                      <Button variant="secondary" onClick={clearFilters}>
                        {t('clearFilters')}
                      </Button>
                    ) : undefined
                  }
                />
              )
            }
            onRowOpen={onRowOpen}
            activeRowId={openId}
            onRowOrderChange={setOrder}
          />
        </div>
      </div>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(next) => {
          if (!next) setCancelling(null);
        }}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('keepRunning')}
        error={cancelError}
        onConfirm={confirmCancel}
        // The row's menu item is gone when the question closes, and the run's row may be too
        finalFocus={gridFocus}
      />
    </InspectorLayout>
  );
}
