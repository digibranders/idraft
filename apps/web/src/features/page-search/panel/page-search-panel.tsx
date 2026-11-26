'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactElement } from 'react';

import { BreakdownTabs } from './breakdown-tabs';
import { MetricCharts } from './metric-charts';
import { MetricTiles } from './metric-tiles';
import { Busy, LoadError, NotConnected, NotLive, Pending, StaleBanner } from './panel-states';
import { MAX_PERIOD_DAYS, PeriodControls } from './period-controls';
import { usePanelState } from './use-panel-state';
import { Verdict } from './verdict';
import { periodParams, periodValue } from '../period';
import { pageSearchQuery } from '../queries';
import type { PeriodParams } from '../types';
import { InspectorSection } from '@/components/app/inspector/inspector-section';
import { readRangeParams, type DateRangeValue } from '@/components/app/date-range/range-model';
import { EmptyState } from '@/components/app/status/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBusinessDate } from '@/lib/format';

export interface PageSearchPanelProps {
  workspaceId: string;
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  /** The page, as every url id of the API. */
  urlId: string;
  /** The page's status in the crawl; anything but 200 shows one sentence and reads nothing. `null`: unknown, read. */
  statusCode: number | null;
  /** The project's time zone, for the picker's note. Days are Search Console's (Pacific Time). */
  timeZone: string;
}

/**
 * The Search tab of a page (spec 10.3): the period, the verdict, the four numbers and their charts. It is content for
 * the shared inspector, so it sets no width. The first read sends no dates and learns the last final day from the
 * answer; the picker is drawn once it is known.
 */
export function PageSearchPanel(props: PageSearchPanelProps): ReactElement {
  if (props.statusCode !== null && props.statusCode !== 200) return <NotLive />;
  return <LivePanel {...props} />;
}

function PanelSkeleton(): ReactElement {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <Skeleton shape="block" height="row" />
      <Skeleton shape="block" height="chart-140" />
      <Skeleton shape="block" height="chart-140" />
    </div>
  );
}

/** The period of the address, or `null` for the default month: a range the app refuses is the default too. */
function addressPeriod(
  address: { win: string | null; from: string | null; to: string | null },
  finalThrough: string,
): DateRangeValue | null {
  const { value, dropped } = readRangeParams(address, { today: finalThrough, maxDays: MAX_PERIOD_DAYS });
  return dropped === null ? value : null;
}

function LivePanel({
  workspaceId,
  projectId,
  workspaceSlug,
  projectSlug,
  urlId,
  timeZone,
}: PageSearchPanelProps): ReactElement {
  const t = useTranslations('pageSearch');
  const scope = useMemo(() => ({ workspaceId, projectId }), [workspaceId, projectId]);
  const state = usePanelState();

  // The read with no dates is the default month; it also tells the last final day, which the address's period needs
  // With a period in the address the read with no dates only tells the last final day, so the comparison does not matter
  const defaults: PeriodParams = { compare: state.hasPeriod ? 'none' : state.compare };
  const probe = useQuery(pageSearchQuery(scope, urlId, defaults));
  const finalThrough = probe.data?.meta.final_through ?? null;
  const range = state.hasPeriod && finalThrough !== null ? addressPeriod(state.address, finalThrough) : null;
  const params =
    range === null || finalThrough === null
      ? { compare: state.compare }
      : periodParams(range, state.compare, finalThrough);
  // A period in the address cannot be sent before the last final day is known
  const waiting = state.hasPeriod && probe.data === undefined;
  const read = useQuery({
    ...pageSearchQuery(scope, urlId, params),
    enabled: !waiting,
    placeholderData: keepPreviousData,
  });

  const failed = waiting ? probe : read;
  const answer = waiting ? undefined : read.data;
  const controls =
    finalThrough === null ? null : (
      <PeriodControls
        value={periodValue(range, finalThrough)}
        onValueChange={state.setPeriod}
        compare={state.compare}
        onCompareChange={state.setCompare}
        finalThrough={finalThrough}
        timeZone={timeZone}
      />
    );
  if (answer === undefined) {
    return failed.isError ? (
      <div className="flex flex-col gap-4">
        {controls}
        <LoadError
          error={failed.error}
          retrying={failed.isFetching}
          onRetry={() => {
            void failed.refetch();
          }}
        />
      </div>
    ) : (
      <PanelSkeleton />
    );
  }

  const { data: detail, meta } = answer;
  if (meta.state === 'not_connected') return <NotConnected workspaceSlug={workspaceSlug} projectSlug={projectSlug} />;
  if (meta.state === 'pending') return <Pending />;

  const banner =
    meta.state === 'reauth_required' || meta.state === 'no_access' ? (
      <StaleBanner
        state={meta.state}
        finalThrough={meta.final_through}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
      />
    ) : null;

  const current = detail.current;
  const window = meta.window;
  if (current === null || window === null) {
    return (
      <div className="flex flex-col gap-4">
        {banner}
        {controls}
        {meta.retry_after === null ? (
          <Pending />
        ) : (
          <Busy
            seconds={meta.retry_after}
            onRetry={() => {
              void read.refetch();
            }}
          />
        )}
      </div>
    );
  }

  const status = read.isFetching ? 'refetching' : 'ready';
  const noImpressions = current.impressions === 0;
  return (
    <div className="flex flex-col gap-4">
      {banner}
      {controls}
      {detail.health === null ? null : (
        <Verdict
          health={detail.health}
          current={current}
          previous={detail.previous}
          window={window}
          compareWindow={meta.compare_window}
        />
      )}
      <MetricTiles
        current={current}
        previous={detail.previous}
        window={window}
        compareWindow={meta.compare_window}
        status={status}
      />
      <InspectorSection
        title={t('overTime')}
        status={noImpressions ? 'empty' : 'ready'}
        empty={
          <EmptyState variant="inline" title={t('states.notCollected')} reason={t('overTimeEmpty')} headingLevel={3} />
        }
      >
        <MetricCharts
          current={current}
          series={detail.series}
          previousSeries={detail.previous_series}
          window={window}
          compareWindow={meta.compare_window}
          metrics={state.metrics}
          onToggle={state.toggleMetric}
          status={status}
        />
      </InspectorSection>
      <BreakdownTabs
        scope={scope}
        urlId={urlId}
        period={params}
        metric={state.metrics[0] ?? 'clicks'}
        tab={state.tab}
        onTabChange={state.setTab}
      />
      {meta.final_through === null ? null : (
        <p className="type-meta text-foreground-tertiary">
          {t('note', { date: formatBusinessDate(meta.final_through) })}
        </p>
      )}
    </div>
  );
}
