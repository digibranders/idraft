'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useAiSchedules } from './data/activity-reads';
import { nextRunOf } from './model/collection-status';
import { engineRows, type EngineCost, type EngineRow } from './model/engine-rows';
import { daysAsked, type DaysAsked, type Weekday } from './model/schedule-days';
import { useErrorState, useStaleNotice, type FrameState } from './parts/frame-state';
import { useCardExport } from '../engines/use-card-seams';
import { useOverview, useOverviewSchedule } from '../../overview-context';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { EngineLogo } from '@/components/app/engine/engine-logo';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatCurrency, formatInteger, formatList, formatTableDateTime } from '@/lib/format';
import { projectPath } from '@/lib/routes/paths';

/** The short weekday names are the family's (`aiOverview.activity.common.weekdays`): the calendar card reads them too. */
const WEEKDAY_KEYS = {
  monday: 'weekdays.monday',
  tuesday: 'weekdays.tuesday',
  wednesday: 'weekdays.wednesday',
  thursday: 'weekdays.thursday',
  friday: 'weekdays.friday',
  saturday: 'weekdays.saturday',
  sunday: 'weekdays.sunday',
} as const satisfies Record<Weekday, string>;

/** A row of the table with every cell as text, so the table, the summary and the export say the same. */
interface Line {
  row: EngineRow;
  status: string;
  days: string;
  next: string;
  cost: string;
}

/**
 * `ops.engines`: one row per project engine, whether it is on, the days the AI schedules ask it, when the next run
 * is and what a month of its active prompts is estimated to cost. Engines are rows and are never added up. An engine
 * that is off is not asked, so it has no days and no next run, and its cost is labelled "if on"; a price the book does
 * not have is n/a, never $0.
 */
export default function EnginesCard({ item, live }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.engines');
  const common = useTranslations('aiOverview.activity.common');
  const { workspaceSlug, project, engines, canManageEngines } = useOverview();
  const schedules = useAiSchedules({ subscribed: live });
  const schedule = useOverviewSchedule({ subscribed: live });
  const timeZone = project.timeZone;

  const schedulesRead = schedules.status === 'ready' || schedules.status === 'refetching';
  const days: DaysAsked | null = schedules.data === undefined ? null : daysAsked(schedules.data);
  const next = nextRunOf(schedule.data);

  const daysText = (asked: DaysAsked | null): string => {
    if (asked === null) return EMPTY_VALUE;
    switch (asked.kind) {
      case 'weekdays':
        return formatList(asked.days.map((day) => common(WEEKDAY_KEYS[day])));
      case 'daily':
        return t('daily');
      case 'custom':
        return t('custom');
      case 'paused':
        return t('paused');
      case 'none':
        return t('notScheduled');
    }
  };
  const nextText = (): string => {
    switch (next.kind) {
      case 'at':
        return formatTableDateTime(next.at, timeZone);
      case 'paused':
        return t('paused');
      case 'none':
        return t('notScheduled');
      case 'unknown':
        return EMPTY_VALUE;
    }
  };
  const costText = (cost: EngineCost): string => {
    switch (cost.kind) {
      case 'estimate':
        return t('costEstimate', { amount: formatCurrency(cost.usd) });
      case 'if_on':
        return t('costIfOn', { amount: formatCurrency(cost.usd) });
      case 'unknown':
        return EMPTY_VALUE;
    }
  };

  const rows = engineRows(engines.data ?? []);
  const lines: Line[] = rows.map((row) => ({
    row,
    status: row.isOn ? t('on') : t('off'),
    days: row.isOn ? daysText(days) : t('notAsked'),
    next: row.isOn ? nextText() : t('notAsked'),
    cost: costText(row.cost),
  }));
  const header = [t('headerEngine'), t('headerStatus'), t('headerDays'), t('headerNext'), t('headerCost')];
  const cells = (line: Line): string[] => [line.row.label, line.status, line.days, line.next, line.cost];
  const on = rows.filter((row) => row.isOn);

  const error = useErrorState(engines, t('subject'));
  const stale = useStaleNotice(engines.stale);
  const partial =
    schedules.status === 'error' && !schedulesRead ? { kind: 'partial' as const, text: t('partial') } : undefined;
  const enginesHref = projectPath(workspaceSlug, project.slug, '/settings/engines');
  let frame: FrameState;
  if (engines.status === 'error') {
    frame = { status: 'error', error };
  } else if (
    engines.status === 'loading' ||
    engines.status === 'idle' ||
    // The schedules are always asked for unless the card is paused: idle is a read not made yet, not "not scheduled"
    schedules.status === 'loading' ||
    schedules.status === 'idle'
  ) {
    frame = { status: 'loading' };
  } else if (rows.length === 0) {
    frame = {
      status: 'empty',
      empty: canManageEngines
        ? {
            title: t('emptyTitle'),
            reason: t('emptyReason'),
            action: <TextLink render={<Link href={enginesHref} />}>{t('toEngines')}</TextLink>,
          }
        : { title: t('emptyTitle'), reason: `${t('emptyReason')} ${t('askAdmin')}` },
    };
  } else {
    frame = { status: engines.status === 'refetching' ? 'refetching' : 'ready', notice: stale ?? partial };
  }

  useCardExport(item.id, () =>
    frame.status === 'ready' || frame.status === 'refetching' ? { id: item.id, header, rows: lines.map(cells) } : null,
  );

  // The card is narrow, so its body is three columns, with the cost second so it is seen before any sideways scroll:
  // the engine with its state under the name, the cost, and the days and the next run stacked in one cell. The
  // Table view has every field in a column of its own.
  const bodyColumns: PlainColumn<Line>[] = [
    {
      id: 'engine',
      header: t('headerEngine'),
      wrap: true,
      cell: (line) => (
        <div className="flex flex-col">
          <EngineLogo engine={line.row.code} name={line.row.label} />
          <span className="type-meta">{line.status}</span>
        </div>
      ),
    },
    { id: 'cost', header: t('headerCostShort'), wrap: true, cell: (line) => line.cost },
    {
      id: 'schedule',
      header: t('headerSchedule'),
      wrap: true,
      cell: (line) => (
        <div className="flex flex-col">
          {/* A paused or missing schedule has one word for both: it is said once */}
          {(line.days === line.next ? [line.days] : [line.days, line.next]).map((text) => (
            <span key={text}>{text}</span>
          ))}
        </div>
      ),
    },
  ];
  const tableColumns: PlainColumn<Line>[] = [
    {
      id: 'engine',
      header: t('headerEngine'),
      cell: (line) => <EngineLogo engine={line.row.code} name={line.row.label} truncate />,
    },
    { id: 'status', header: t('headerStatus'), cell: (line) => line.status },
    { id: 'days', header: t('headerDays'), cell: (line) => line.days },
    { id: 'next', header: t('headerNext'), cell: (line) => line.next },
    { id: 'cost', header: t('headerCost'), cell: (line) => line.cost },
  ];
  const tableOf = (columns: PlainColumn<Line>[]): ReactElement => (
    <PlainTable
      caption={t('caption')}
      columns={columns}
      rows={lines}
      rowKey={(line) => line.row.code}
      status="ready"
      errorState={null}
      emptyText={t('emptyTitle')}
    />
  );
  const counts = { on: formatInteger(on.length), total: rows.length };
  // What a screen reader is told is a fact only once the engines are read: before that it is the title
  let summary = t('title');
  if (engines.data !== undefined) {
    if (rows.length === 0) summary = t('emptyTitle');
    else if (on.length === 0) summary = t('summaryNone', { total: rows.length });
    else summary = t('summary', { ...counts, list: formatList(on.map((row) => row.label)) });
  }
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={180}
      title={t('title')}
      meta={rows.length === 0 ? null : t('meta', counts)}
      summary={summary}
      footnote={<p>{t('footnote')}</p>}
      body={tableOf(bodyColumns)}
      table={tableOf(tableColumns)}
      menu={{ fileName: t('fileName'), csv: { header, rows: lines.map(cells) } }}
      {...frame}
    />
  );
}
