'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  factsRequested,
  indexFacts,
  promptFactsQuery,
  type PromptFacts,
  type PromptFactsOptions,
  type PromptsSummaryWithFacts,
} from './facts';
import type { DateRange } from './prompt-model';
import type { PromptScope } from './prompt-queries';

/**
 * `usePromptFacts` for the Prompts page, which reads nothing while no platform is on (the summary is not asked
 * either) and keeps the last facts while a new window is read, as the counts do. `usePromptFacts` has neither option;
 * when it takes them this is its call.
 */
export function usePageFacts(
  scope: PromptScope,
  range: DateRange,
  includeBranded: boolean,
  enabled: boolean,
  options: PromptFactsOptions = {},
): UseQueryResult<PromptFacts> {
  const requested = options.requestFacts ?? factsRequested();
  const select = useCallback(
    (response: { data: PromptsSummaryWithFacts }) => indexFacts(response.data, requested),
    [requested],
  );
  return useQuery({
    ...promptFactsQuery(scope, range, includeBranded, { ...options, requestFacts: requested }),
    select,
    enabled,
    placeholderData: keepPreviousData,
  });
}
