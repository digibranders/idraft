'use client';

import { useMemo } from 'react';

import { useOverview, useOverviewSummary } from '../overview-context';
import { buildAggregates, type OverviewAggregates } from './aggregates';
import type { Read } from './read-state';
import type { PromptsSummary } from '@/lib/api/types';

export interface CurrentAggregates {
  /** The window's own figures with no comparison, the sources or the fan-out; `null` until the summary and the engines are read. */
  aggregates: OverviewAggregates | null;
  /** The summary read they are made from: the same request as the numbers' (one key), so it costs none. */
  summary: Read<PromptsSummary>;
}

/**
 * The counts of the scope's window that the header and the notices say (the prompts, the answers not valid): the
 * same summary and the same arithmetic as the numbers, so they share one denominator (R12).
 */
export function useCurrentAggregates(): CurrentAggregates {
  const { scope, engines } = useOverview();
  const summary = useOverviewSummary();
  const aggregates = useMemo(
    () =>
      summary.data === undefined || engines.data === undefined
        ? null
        : buildAggregates({
            current: summary.data,
            previous: null,
            engines: engines.data,
            chosenEngines: scope.engines,
            topicsKept: null,
            sources: null,
            fanout: null,
          }),
    [summary.data, engines.data, scope.engines],
  );
  return { aggregates, summary };
}
