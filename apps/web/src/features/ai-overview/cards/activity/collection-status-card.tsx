'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';

import { useAiRuns } from './data/activity-reads';
import {
  collectionStatus,
  nextRunOf,
  type CollectionStatus,
  type FinishedRun,
  type NextRun,
  type OpenRun,
} from './model/collection-status';
import { useErrorState, useStaleNotice, type FrameState } from './parts/frame-state';
import { useCardDrill, useCardExport } from '../engines/use-card-seams';
import { useOverview, useOverviewSchedule } from '../../overview-context';
import { ChartFrame } from '@/components/app/chart/chart-frame';
import { Banner } from '@/components/app/status/banner';
import { PlainTable, type PlainColumn } from '@/components/app/table/plain-table';
import { TextLink } from '@/components/ui/text-link';
import type { CardProps } from '@/features/layouts';
import { EMPTY_VALUE, formatInteger, formatTableDateTime } from '@/lib/format';
import type { CsvCell } from '@/lib/csv/csv-write';

/** One fact of the card: its label, its text in the Table view and its value in the export. */
interface Fact {
  label: string;
  text: string;
  value: CsvCell;
}

const FINISHED_STATUS = {
  completed: 'statusCompleted',
  completed_with_errors: 'statusCompletedWithErrors',
  failed: 'statusFailed',
} as const satisfies Record<FinishedRun['status'], string>;

/**
 * WB-OV-11: when the AI prompts were last collected, how many answers that run collected and how many failed (always
 * as counts of the run), a run under way, the budget blocking runs, and when the next run is. A paused schedule is
 * not "no schedule", and a next run that could not be read is n/a. Without access to runs the card says so and reads
 * nothing.
 */
export default function CollectionStatusCard({ item }: CardProps): ReactElement {
  const t = useTranslations('aiOverview.activity.collection');
  const { project, canViewRuns } = useOverview();
  const drill = useCardDrill();
  const runs = useAiRuns();
  // WP-33 adds a `subscribed` option to the Overview reads: pass `live` to this one when it lands
  const schedule = useOverviewSchedule();
  const timeZone = project.timeZone;
  const status: CollectionStatus | null = runs.data === undefined ? null : collectionStatus(runs.data);
  const next = nextRunOf(schedule.data);
  const when = (instant: string): string => formatTableDateTime(instant, timeZone);

  const nextText = (run: NextRun): string => {
    switch (run.kind) {
      case 'at':
        return t('nextAt', { date: when(run.at) });
      case 'paused':
        return t('nextPaused');
      case 'none':
        return t('nextNone');
      case 'unknown':
        return t('nextAt', { date: EMPTY_VALUE });
    }
  };
  const noRunReason = (run: NextRun): string => {
    switch (run.kind) {
      case 'at':
        return t('noRunNextAt', { date: when(run.at) });
      case 'paused':
        return t('noRunPaused');
      case 'none':
        return t('noRunNone');
      case 'unknown':
        return t('noRunUnknown');
    }
  };
  const countsText = (run: FinishedRun): string =>
    t('counts', {
      collected: formatInteger(run.collected),
      total: formatInteger(run.total),
      failed: formatInteger(run.failed),
    });
  const openText = (run: OpenRun): string => {
    if (run.status === 'planned') return t('planned', { total: formatInteger(run.total) });
    const counts = { collected: formatInteger(run.collected), total: formatInteger(run.total) };
    return run.failed > 0 ? t('openFailed', { ...counts, failed: formatInteger(run.failed) }) : t('open', counts);
  };

  const facts: Fact[] = [];
  const finished = status?.latest ?? null;
  if (finished !== null) {
    facts.push(
      { label: t('rowLatest'), text: when(finished.at), value: when(finished.at) },
      {
        label: t('rowStatus'),
        text: t(FINISHED_STATUS[finished.status]),
        value: t(FINISHED_STATUS[finished.status]),
      },
      { label: t('rowCollected'), text: formatInteger(finished.collected), value: finished.collected },
      { label: t('rowFailed'), text: formatInteger(finished.failed), value: finished.failed },
      { label: t('rowAsked'), text: formatInteger(finished.total), value: finished.total },
    );
  }
  const running = status?.open ?? null;
  if (running !== null) facts.push({ label: t('rowOpen'), text: openText(running), value: openText(running) });
  facts.push({ label: t('rowNext'), text: nextText(next), value: nextText(next) });
  const stopped = status?.blocked ?? null;
  if (stopped !== null) {
    facts.push({ label: t('rowBlocked'), text: formatInteger(stopped.count), value: stopped.count });
  }

  const error = useErrorState(runs, t('subject'));
  const notice = useStaleNotice(runs.stale);
  const hasRun = status !== null && (status.latest !== null || status.open !== null || status.blocked !== null);
  let frame: FrameState;
  if (!canViewRuns) {
    frame = { status: 'empty', empty: { title: t('noAccessTitle'), reason: t('noAccessReason') } };
  } else if (runs.status === 'error') {
    frame = { status: 'error', error };
  } else if (runs.status === 'loading' || runs.status === 'idle' || schedule.status === 'loading') {
    frame = { status: 'loading' };
  } else if (!hasRun) {
    frame = { status: 'empty', empty: { title: t('noRunTitle'), reason: noRunReason(next) } };
  } else {
    frame = { status: runs.status === 'refetching' ? 'refetching' : 'ready', notice };
  }

  useCardExport(item.id, () =>
    frame.status === 'ready' || frame.status === 'refetching'
      ? {
          id: item.id,
          header: [t('headerItem'), t('headerValue')],
          rows: facts.map((fact) => [fact.label, fact.value]),
        }
      : null,
  );

  const columns: PlainColumn<Fact>[] = [
    { id: 'item', header: t('headerItem'), cell: (fact) => fact.label },
    { id: 'value', header: t('headerValue'), cell: (fact) => fact.text },
  ];
  const latest = status?.latest ?? null;
  const open = status?.open ?? null;
  const blocked = status?.blocked ?? null;
  const runsHref = drill('runs');
  // What a screen reader is told is a fact only once the runs are read: before that (loading, failed, no access) it
  // is the title, and "no finished run" is said only where the runs were read and there is none
  let summary = t('title');
  if (latest !== null) {
    summary = t('summary', {
      latest: t('latest', { date: when(latest.at) }),
      counts: countsText(latest),
      next: nextText(next),
    });
  } else if (canViewRuns && runs.data !== undefined) {
    summary = t('summaryNone', { next: nextText(next) });
  }
  return (
    <ChartFrame
      kind="html"
      variant="panel"
      height={180}
      title={t('title')}
      summary={summary}
      body={
        <div className="flex flex-col gap-3">
          {open === null ? null : <p className="num type-body-strong">{openText(open)}</p>}
          {latest === null ? null : (
            <div className="flex flex-col gap-1">
              <p className="type-meta">{t('latest', { date: when(latest.at) })}</p>
              <p className="num type-body-strong">{countsText(latest)}</p>
              <p className="type-meta">{t(FINISHED_STATUS[latest.status])}</p>
            </div>
          )}
          <p className="type-body text-foreground-secondary">{nextText(next)}</p>
          {blocked === null ? null : (
            <Banner
              tone="warning"
              placement="region"
              message={t('blocked', { count: blocked.count, date: when(blocked.latestAt) })}
            />
          )}
          {runsHref === null ? null : <TextLink render={<Link href={runsHref} />}>{t('viewRuns')}</TextLink>}
        </div>
      }
      table={
        <PlainTable
          caption={t('tableCaption')}
          columns={columns}
          rows={facts}
          rowKey={(fact) => fact.label}
          status="ready"
          errorState={null}
          emptyText={t('noRunTitle')}
        />
      }
      menu={{
        fileName: t('fileName'),
        csv: { header: [t('headerItem'), t('headerValue')], rows: facts.map((fact) => [fact.label, fact.value]) },
      }}
      {...frame}
    />
  );
}
