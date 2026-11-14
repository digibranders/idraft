'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

import { buildAggregates, type OverviewAggregates } from '../data/aggregates';
import { readNumber, type NumberReading } from '../data/number-sources';
import { askedEngines, comparisonWindow } from '../data/overview-queries';
import type { Read } from '../data/read-state';
import { useOverviewFanout, useOverviewSources, type OverviewReadInput } from '../data/use-overview-reads';
import { useOverview, useOverviewPeriods } from '../overview-context';
import type { Branded } from '../scope/scope-model';
import { useTopicsKept } from '../scope/use-topic-tree';
import { numberHref } from './number-links';
import { numberDisplay, type NumberContext, type Say, type UnreadWhy } from './number-model';
import { Delta } from '@/components/app/metric/delta';
import { useLayoutScreen, type NumberStripProps, type NumberValue } from '@/features/layouts';
import type { ProjectEngine } from '@/lib/api/types';
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
 * What a number reads: its figure from the aggregates; with no summary (`shown` is `null`) and no engine asked
 * (`engines` is the project's list then), an engine's number says why that engine is not asked, which is that it
 * is off in the project or outside the filter, and the others are unread.
 */
function readingOf(
  shown: OverviewAggregates | null,
  engines: readonly ProjectEngine[] | null,
  item: NumberItem,
): NumberReading | null {
  if (shown !== null) return readNumber(shown, item);
  if (engines === null || item.engine === undefined) return { status: 'unread' };
  const project = engines.find((entry) => entry.engine.engine_code === item.engine);
  return { status: 'notAsked', why: project?.is_enabled === true ? 'outsideFilter' : 'off' };
}

/**
 * The values of the numbers in the layout. The sources and the fan-out are read only while the layout has a
 * number that needs them, so a page of the default numbers makes neither request, and each waits for its own read
 * without holding back the numbers of the summary.
 */
export function useNumberValues(): NumberValues {
  const say = useTranslations('aiOverview.numbers') as Say;
  const { workspaceId, workspaceSlug, project, scope, enabledEngines, engines } = useOverview();
  const { document } = useLayoutScreen();
  const periods = useOverviewPeriods();
  const topicsKept = useTopicsKept();
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

  const { current, previous, paired, settled, busy } = periods;
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
            topicsKept,
            sources: sources.data ?? null,
            fanout: fanout.data ?? null,
          }),
    [current.data, previousData, engines.data, scope.engines, topicsKept, sources.data, fanout.data],
  );
  // The count of topics is of the chosen topic's subtree once a topic is chosen, which the topic tree tells; until
  // it is read no count is better than the wrong one
  const shown = useMemo(
    () =>
      aggregates === null || scope.topic === null || topicsKept !== null
        ? aggregates
        : { ...aggregates, topicCount: null },
    [aggregates, scope.topic, topicsKept],
  );
  const compared = comparisonWindow(scope) !== null;
  const previousStatus = previous?.status ?? null;
  // The previous window of this scope is read (or failed): its data is not the last scope's, though it may be read again
  const previousSettled =
    previous !== null &&
    (previousStatus === 'ready' ||
      previousStatus === 'error' ||
      (previousStatus === 'refetching' && !previous.placeholder));
  const previousAnswers = aggregates?.previousAnswers ?? null;
  // The summary is not asked of no engine, so there are no figures: every engine says why it is not asked, and the
  // prompts, which come with the summary, say that no engine is. Only once the engines are known to be none
  const nothingAsked = engines.data !== undefined && askedEngines({ scope, enabledEngines }).length === 0;

  const context = useMemo(
    (): NumberContext => ({
      window: scope.range,
      days: scope.range.days,
      // Said once its read has settled: while it is under way there is nothing to say of a change yet
      previous: compared && previousSettled ? scope.previous : null,
      previousEmpty: previousAnswers === 0,
      previousFailed: previousStatus === 'error',
      branded: scope.branded,
      busy: !settled,
      stale: current.stale,
      unreadOf: (metric) => {
        if (aggregates === null) return nothingAsked ? 'noEngine' : whyUnread(current, false, scope.branded);
        if (metric !== SOURCES_METRIC && metric !== FANOUT_METRIC) return whyUnread(current, false, scope.branded);
        const read = metric === SOURCES_METRIC ? sources : fanout;
        // The fan-out read answers for the engines it names together, and a number is one engine's: a read that is
        // here and gives no figure for it is a limit of the read, not a number that is missing
        if (metric === FANOUT_METRIC && read.data !== undefined && !read.placeholder) return 'oneAtATime';
        return whyUnread(read, true, scope.branded);
      },
    }),
    [
      scope,
      compared,
      previousStatus,
      previousSettled,
      previousAnswers,
      settled,
      current,
      aggregates,
      nothingAsked,
      sources,
      fanout,
    ],
  );

  const engineList = engines.data;
  const drillProject = useMemo(
    () => ({ workspace: workspaceSlug, project: project.slug }),
    [workspaceSlug, project.slug],
  );
  const valueOf = useCallback(
    (item: NumberItem): NumberValue => {
      const reading = readingOf(shown, nothingAsked ? (engineList ?? []) : null, item);
      const display = numberDisplay(reading, item, context, say);
      const href = numberHref(item, reading, scope, drillProject, enabledEngines);
      return {
        value: display.value,
        unknown: display.unknown,
        delta: display.change === null ? undefined : <Delta input={display.change} test="interim" tip={false} />,
        context: display.context,
        tip: display.tip,
        ...(href === null ? {} : { href }),
      };
    },
    [shown, nothingAsked, engineList, context, say, scope, drillProject, enabledEngines],
  );

  // Every read the numbers wait on is read again, so a number that failed on its own read gets its chance too
  const retry = useCallback((): void => {
    current.refetch();
    previous?.refetch();
    sources.refetch();
    fanout.refetch();
  }, [current, previous, sources, fanout]);
  const failed = current.status === 'error';
  return useMemo(
    (): NumberValues => ({
      valueOf,
      // Busy while any read is under way, though the values stay: a read of the same scope takes nothing away
      status: current.status === 'loading' ? 'loading' : busy ? 'refetching' : 'ready',
      error: failed ? { errorId: current.errorId, retry } : null,
    }),
    [valueOf, current.status, current.errorId, busy, failed, retry],
  );
}
