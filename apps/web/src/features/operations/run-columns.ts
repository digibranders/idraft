'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { RUN_STATUS_KEYS, TRIGGER_KEYS } from './run-model';
import { col } from '@/components/app/data-table/columns';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { Run } from '@/lib/api/types';
import { formatInteger, formatTableDateTime } from '@/lib/format';
import { money } from '@/lib/format/money';
import { collectionStatusOf } from '@/lib/runs/run-status';
import { taskSummary } from '@/lib/runs/task-summary';
import type { SortKey } from '@/lib/tables/table-state';
import { useWorkloadName } from '@/lib/workloads/use-workload-name';

/**
 * The columns of Runs (20-frontend-specification.md section 5.18): Workload, Status, Started, Trigger, Tasks,
 * Actual, Estimate, Window, Finished. The workload is the row's name. The ids of the sortable ones are what
 * `?sort=` holds; the table sorts the loaded rows itself.
 */

/** Newest first. */
export const DEFAULT_SORT: readonly SortKey[] = [{ id: 'created_at', desc: true }];

/** The columns that sort. */
export const SORT_FIELDS: ReadonlySet<string> = new Set([
  'workload',
  'status',
  'created_at',
  'trigger',
  'actual',
  'estimate',
  'completed_at',
]);

export const rowId = (row: Run): string => row.run_id;

export interface RunColumns {
  columns: readonly DataTableColumn<Run>[];
  /** What a search looks in: the workload, status and trigger as the table shows them. */
  searchText: (row: Run) => string;
  /** The row's name for assistive technology: the workload and when it started. */
  rowName: (row: Run) => string;
}

export function useRunColumns(timeZone: string): RunColumns {
  const t = useTranslations('runs');
  const common = useTranslations('common');
  const workloadName = useWorkloadName();
  return useMemo(() => {
    const statusLabel = (row: Run): string => t(`statuses.${RUN_STATUS_KEYS[row.status]}`);
    const triggerLabel = (row: Run): string => t(`triggers.${TRIGGER_KEYS[row.trigger]}`);
    const cost = (value: string | null): number | null => (value === null ? null : money(value));
    const columns: DataTableColumn<Run>[] = [
      col.keyword<Run>('workload', (row) => workloadName(row.workload), { header: t('columns.workload') }),
      col.status<Run>('status', (row) => ({ status: collectionStatusOf(row.status), label: statusLabel(row) }), {
        header: t('columns.status'),
        width: 168,
      }),
      col.date<Run>('created_at', (row) => row.created_at, {
        header: t('columns.created'),
        headerTooltip: common('timesIn', { timeZone }),
        timeZone,
      }),
      col.badge<Run>('trigger', (row) => ({ label: triggerLabel(row) }), {
        header: t('columns.trigger'),
        priority: 2,
      }),
      col.text<Run>(
        'tasks',
        (row) => {
          const { done, total, failed } = taskSummary(row);
          return total === 0
            ? null
            : t('tasks', { done: formatInteger(done), total: formatInteger(total), failed: formatInteger(failed) });
        },
        { header: t('columns.tasks'), priority: 2, width: 200, sortable: false },
      ),
      col.currency<Run>('actual', (row) => cost(row.actual_cost_usd), { header: t('columns.actual'), priority: 2 }),
      col.currency<Run>('estimate', (row) => cost(row.estimated_cost_usd), {
        header: t('columns.estimate'),
        priority: 3,
      }),
      col.text<Run>(
        'window',
        (row) =>
          t('window', {
            start: formatTableDateTime(row.window_start, timeZone),
            end: formatTableDateTime(row.window_end, timeZone),
          }),
        {
          header: t('columns.window'),
          headerTooltip: common('timesIn', { timeZone }),
          priority: 3,
          width: 240,
          sortable: false,
        },
      ),
      col.date<Run>('completed_at', (row) => row.completed_at, {
        header: t('columns.completed'),
        headerTooltip: common('timesIn', { timeZone }),
        priority: 4,
        timeZone,
        secondary: true,
      }),
    ];
    return {
      columns,
      searchText: (row) => `${workloadName(row.workload)} ${statusLabel(row)} ${triggerLabel(row)}`,
      rowName: (row) =>
        t('rowName', { workload: workloadName(row.workload), started: formatTableDateTime(row.created_at, timeZone) }),
    };
  }, [t, common, workloadName, timeZone]);
}
