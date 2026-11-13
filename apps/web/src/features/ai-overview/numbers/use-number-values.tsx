'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { buildAggregates } from '../data/aggregates';
import { readNumber } from '../data/number-sources';
import { comparisonWindow } from '../data/overview-queries';
import type { Read } from '../data/read-state';
import { useOverviewFanout, useOverviewSources, type OverviewReadInput } from '../data/use-overview-reads';
import { useOverview, useOverviewPeriods } from '../overview-context';
import type { Branded } from '../scope/scope-model';
import { numberDisplay, type NumberContext, type Say, type UnreadWhy } from './number-model';
import { Delta } from '@/components/app/metric/delta';
import { useLayoutScreen, type NumberStripProps, type NumberValue } from '@/features/layouts';
import type { NumberItem } from '@/lib/layouts/types';

/**
 * The numbers of the AI visibility Overview as the strip draws them (WP-33 plan section 3.4): one hook that reads
 * what the numbers of the layout need, builds the aggregates once per change of the reads, and answers `valueOf`
 * for every number on every render, which is a lookup and a formatting and nothing more.
 */

export interface NumberValues {
  /** What the strip shows for a number of the layout. Cheap and pure: call it for every number on every render. */
  valueOf: NumberStripProps['valueOf'];
  /** `loading` until the summary has answered, `refetching` while any read of the scope is under way. */
  status: NumberStripProps['status'];
  /** The summary failed, so the strip cannot say anything: the page shows its error row with this Retry. */
  error: { errorId: string | null; retry: () => void } | null;
}

const SOURCES_METRIC = 'ai.citation_share';
const FANOUT_METRIC = 'ai.fanout_presence_rate';

/** Why a read that has no data gives no figure; a read that is ready and still has none cannot answer this scope. */
function whyUnread(read: Read<unknown>, remote: boolean, branded: Branded): UnreadWhy {
  switch (read.status) {
    case 'loading':
    case 'refetching':
      return 'loading';
    case 'error':
      return 'error';
    case 'idle':
    case 'ready':
      return remote && branded === 'only' ? 'brandedOnly' : 'idle';
  }
}

/**
 * The values of the numbers in the layout. The sources and the fan-out are read only while the layout has a
 * number that needs them, so a page of the default numbers makes neither request, and each waits for its own read
 * without holding back the numbers of the summary.
 */
export function useNumberValues(): NumberValues {
  const say = useTranslations('aiOverview.numbers') as Say;
  const { workspaceId, project, scope, enabledEngines, engines } = useOverview();
  const { document } = useLayoutScreen();
  const periods = useOverviewPeriods();
  const numbers = document.numbers;
  const needsSources = useMemo(() => numbers?.some((number) => number.metric === SOURCES_METRIC) === true, [numbers]);
  const needsFanout = useMemo(() => numbers?.some((number) => number.metric === FANOUT_METRIC) === true, [numbers]);
  const ref = useMemo(() => ({ workspaceId, projectId: project.id }), [workspaceId, project.id]);
  // An empty list of engines is what keeps a read from running: it is not asked for a number nobody has
  const sourcesInput = useMemo(
    (): OverviewReadInput => ({ project: ref, scope, enabledEngines: needsSources ? enabledEngines : [] }),
    [ref, scope, enabledEngines, needsSources],
  );
  const fanoutInput = useMemo(
    (): OverviewReadInput => ({ project: ref, scope, enabledEngines: needsFanout ? enabledEngines : [] }),
    [ref, scope, enabledEngines, needsFanout],
  );
  const sources = useOverviewSources(sourcesInput);
  const fanout = useOverviewFanout(fanoutInput);

  const { current, previous, paired, settled } = periods;
  const previousData = paired ? (previous?.data ?? null) : null;
  const aggregates = useMemo(
    () =>
      current.data === undefined || engines.data === undefined
        ? null
        : buildAggregates({
            current: current.data,
            // A change between two scopes is no change: the previous window counts only once it is the same scope
            previous: previousData,
            engines: engines.data,
            chosenEngines: scope.engines,
            // The chosen topic's subtree needs the topic tree (the scope bar's): until then no count of topics
            topicsKept: null,
            sources: sources.data ?? null,
            fanout: fanout.data ?? null,
          }),
    [current.data, previousData, engines.data, scope.engines, sources.data, fanout.data],
  );
  // The count of topics is of the chosen topic's subtree once a topic is chosen, which the topic tree (the scope
  // bar's) will tell; until then no count is better than the wrong one
  const shown = useMemo(
    () => (aggregates === null || scope.topic === null ? aggregates : { ...aggregates, topicCount: null }),
    [aggregates, scope.topic],
  );
  const compared = comparisonWindow(scope) !== null;
  const previousStatus = previous?.status ?? null;
  const previousAnswers = aggregates?.previousAnswers ?? null;

  const context = useMemo(
    (): NumberContext => ({
      window: scope.range,
      days: scope.range.days,
      // Said once its read has settled: while it is under way there is nothing to say of a change yet
      previous: compared && (previousStatus === 'ready' || previousStatus === 'error') ? scope.previous : null,
      previousEmpty: previousAnswers === 0,
      previousFailed: previousStatus === 'error',
      branded: scope.branded,
      busy: !settled,
      stale: current.stale,
      unreadOf: (metric) => {
        if (aggregates === null || (metric !== SOURCES_METRIC && metric !== FANOUT_METRIC)) {
          return whyUnread(current, false, scope.branded);
        }
        return whyUnread(metric === SOURCES_METRIC ? sources : fanout, true, scope.branded);
      },
    }),
    [scope, compared, previousStatus, previousAnswers, settled, current, aggregates, sources, fanout],
  );

  const valueOf = useCallback(
    (item: NumberItem): NumberValue => {
      const reading = shown === null ? ({ status: 'unread' } as const) : readNumber(shown, item);
      const display = numberDisplay(reading, item, context, say);
      return {
        value: display.value,
        unknown: display.unknown,
        delta: display.change === null ? undefined : <Delta input={display.change} test="interim" tip={false} />,
        context: display.context,
        tip: display.tip,
      };
    },
    [shown, context, say],
  );

  const retry = useCallback((): void => {
    current.refetch();
    previous?.refetch();
  }, [current, previous]);
  const failed = current.status === 'error';
  return useMemo(
    (): NumberValues => ({
      valueOf,
      status: current.status === 'loading' ? 'loading' : settled ? 'ready' : 'refetching',
      error: failed ? { errorId: current.errorId, retry } : null,
    }),
    [valueOf, current.status, current.errorId, settled, failed, retry],
  );
}
