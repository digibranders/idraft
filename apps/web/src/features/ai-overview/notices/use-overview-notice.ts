'use client';

import { useMemo } from 'react';

import { useCurrentAggregates } from '../data/use-current-aggregates';
import { useOverview, useOverviewFreshness, useOverviewSchedule } from '../overview-context';
import { noticeOf, type Notice, type NoticeInputs } from './notice-model';
import { useNow } from './use-now';

export interface OverviewNotice {
  /** The one notice that applies; `null` when none does, and while what it needs is being read. */
  notice: Notice | null;
  /** Every read the notices need has answered (or failed): what appears from now on appeared after the page loaded. */
  settled: boolean;
}

/**
 * The notice of the page: reads what the table of WP-33 plan section 3.5 needs and gives the first row that applies.
 * The summary is the numbers' own read, the freshness is the project's (not the window's), and the schedules are
 * asked only while an engine is on. A read that failed leaves out the notices that need it and keeps the others.
 */
export function useOverviewNotice(): OverviewNotice {
  const { scope, engines, enabledEngines } = useOverview();
  const { aggregates, summary } = useCurrentAggregates();
  const freshness = useOverviewFreshness();
  const schedule = useOverviewSchedule({ subscribed: enabledEngines.length > 0 });
  const now = useNow();
  const days = scope.range.days;
  const country = scope.country;

  const notice = useMemo((): Notice | null => {
    const enginesRead = engines.data;
    const input: NoticeInputs = {
      enginesOn: enginesRead === undefined ? null : enabledEngines.length,
      activePrompts:
        enginesRead === undefined
          ? null
          : Math.max(0, ...enginesRead.filter((engine) => engine.is_enabled).map((engine) => engine.active_prompts)),
      country,
      // The prompts of this scope: the last scope's count, kept while this one is read, would say another country empty
      promptsInScope: summary.placeholder ? null : (aggregates?.promptCount ?? null),
      schedule: schedule.status === 'error' ? { nextRunAt: null, paused: false } : (schedule.data ?? null),
      freshness: freshness.status === 'error' ? 'failed' : (freshness.data ?? null),
      engines: aggregates?.engines ?? null,
      days,
      now,
    };
    return noticeOf(input);
  }, [
    engines.data,
    enabledEngines,
    country,
    summary.placeholder,
    aggregates,
    schedule.status,
    schedule.data,
    freshness.status,
    freshness.data,
    days,
    now,
  ]);

  const loading = [engines.status, summary.status, freshness.status, schedule.status].includes('loading');
  return { notice, settled: !loading };
}
