'use client';

import { useTranslations } from 'next-intl';
import { useCallback, type ReactElement } from 'react';

import { weekdayOf } from '../model/calendar-model';
import type { Weekday } from '../model/schedule-days';
import type { DayCounts } from '../model/status-model';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import type { CsvTable } from '@/lib/csv/csv-write';
import { formatChartDate, formatInteger } from '@/lib/format';

/** The short weekday names are the family's (`aiOverview.activity.common.weekdays`). */
const WEEKDAY_KEYS = {
  monday: 'weekdays.monday',
  tuesday: 'weekdays.tuesday',
  wednesday: 'weekdays.wednesday',
  thursday: 'weekdays.thursday',
  friday: 'weekdays.friday',
  saturday: 'weekdays.saturday',
  sunday: 'weekdays.sunday',
} as const satisfies Record<Weekday, string>;

/** The short name of a weekday: "Fri". */
export function useWeekdayName(): (weekday: Weekday) => string {
  const common = useTranslations('aiOverview.activity.common');
  return useCallback((weekday) => common(WEEKDAY_KEYS[weekday]), [common]);
}

/** A project day as the cards write it: "Fri Nov 6". */
export function useDayText(): (date: string) => string {
  const weekdayName = useWeekdayName();
  // Stable, so a chart option built from it is not rebuilt on every render
  return useCallback((date) => `${weekdayName(weekdayOf(date))} ${formatChartDate(date)}`, [weekdayName]);
}

/** One engine's days, for the export and the download: every engine, run days only, no blank made into 0. */
export interface EngineDays {
  label: string;
  days: readonly DayCounts[];
}

export function useDailyCsv(): (engines: readonly EngineDays[]) => CsvTable {
  const t = useTranslations('aiOverview.activity.daily');
  return (engines) => ({
    header: [
      t('headerDay'),
      t('headerEngine'),
      t('headerScheduled'),
      t('headerAnswers'),
      t('headerValid'),
      t('headerComplete'),
      t('headerPartial'),
      t('headerEmpty'),
      t('headerRefused'),
      t('headerError'),
      t('headerBlocked'),
    ],
    rows: engines.flatMap(({ label, days }) =>
      days.map((day) => [
        day.date,
        label,
        // A schedule the route cannot name is blank in the file, not 0
        day.scheduled,
        day.answers,
        day.valid,
        day.complete,
        day.partial,
        day.empty,
        day.refused,
        day.error,
        day.budgetBlocked,
      ]),
    ),
  });
}

export interface DayTableProps {
  engine: string;
  days: readonly DayCounts[];
}

/** The run days of one engine as a table: the full alternative of the calendar. */
export function DayTable({ engine, days }: DayTableProps): ReactElement {
  const t = useTranslations('aiOverview.activity.daily');
  const dayText = useDayText();
  const columns: PlainColumn<DayCounts>[] = [
    // The first column is a row header, which the table lets wrap: a day stays on one line
    {
      id: 'day',
      header: t('headerDay'),
      cell: (day) => <span className="whitespace-nowrap">{dayText(day.date)}</span>,
    },
    {
      id: 'scheduled',
      header: t('headerScheduled'),
      cell: (day) => (day.scheduled === null ? t('scheduleUnknown') : formatInteger(day.scheduled)),
    },
    { id: 'answers', header: t('headerAnswers'), cell: (day) => formatInteger(day.answers) },
    { id: 'valid', header: t('headerValid'), cell: (day) => formatInteger(day.valid) },
    { id: 'partial', header: t('headerPartial'), cell: (day) => formatInteger(day.partial) },
    { id: 'empty', header: t('headerEmpty'), cell: (day) => formatInteger(day.empty) },
    { id: 'refused', header: t('headerRefused'), cell: (day) => formatInteger(day.refused) },
    { id: 'error', header: t('headerError'), cell: (day) => formatInteger(day.error) },
    { id: 'blocked', header: t('headerBlocked'), cell: (day) => formatInteger(day.budgetBlocked) },
  ];
  return (
    <PlainTable
      caption={t('tableCaption', { engine })}
      columns={columns}
      rows={days}
      rowKey={(day) => day.date}
      status="ready"
      errorState={null}
      emptyText={t('noDaysTitle')}
    />
  );
}
