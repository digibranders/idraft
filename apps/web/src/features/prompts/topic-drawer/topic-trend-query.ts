'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { NO_TOPIC, topicSummaryRow } from '@/features/prompts/prompt-model';
import type { TopicReadScope } from '@/features/prompts/topics-by-engine/topic-entities-query';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { PromptsSummary, SummaryEntity, TopicSummaryRow } from '@/lib/api/types';

const SUMMARY = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary' as const;

/**
 * `GET {P}/ai/prompts-summary` for one topic's weeks (C-15): the topic rows alone, with the weekly points and the weekly
 * entity cells, narrowed to the topic by `filter[term]`, which keeps the heavy part (entity cells by week) to one topic.
 * Under `filter[term]` the rows are the topic and those below it; `useTopicTrend` takes the topic's own. Its key sits
 * under the project's `ai` prefix, so `refreshPrompts` reaches it.
 */
export const topicTrendQuery = (
  { scope, range, includeBranded, country }: TopicReadScope,
  termId: string,
): ApiQueryOptions<typeof SUMMARY> =>
  apiQuery(SUMMARY, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: {
        from: range.from,
        to: range.to,
        include_branded: includeBranded,
        ...(country === null ? {} : { 'filter[country_iso]': country }),
        rows: 'topics',
        include: ['series', 'entities'],
        'filter[term]': termId,
      },
    },
  });

export interface TopicTrend {
  /** `loading` while the first read is on its way or not asked; `failed` when it failed; `ready` once rows are held. */
  status: 'loading' | 'failed' | 'ready';
  /** The topic's own row; `undefined` while it is not read, and when the read holds none. */
  row: TopicSummaryRow | undefined;
  /** The tracked entities of the answers read, in the order the API lists them. */
  tracked: readonly SummaryEntity[];
  /** A read is on its way, the row shown (if any) being that of an earlier one. */
  fetching: boolean;
  /** What the read failed with, for the error id; `null` while it has not failed. */
  error: unknown;
  retry: () => void;
}

const NO_ENTITIES: readonly SummaryEntity[] = [];

/**
 * The weeks of one topic, asked only while `enabled`; the last row stays while the next window is read. The prompts without
 * a topic have no `filter[term]`: their row is the page summary's (`page`), which holds their weekly points, and nothing is
 * read.
 */
export function useTopicTrend(
  read: TopicReadScope,
  topicKey: string,
  enabled: boolean,
  page: PromptsSummary | undefined,
): TopicTrend {
  const untopiced = topicKey === NO_TOPIC;
  const query = useQuery({
    ...topicTrendQuery(read, topicKey),
    enabled: enabled && !untopiced,
    placeholderData: keepPreviousData,
  });
  if (untopiced) {
    return {
      status: page === undefined ? 'loading' : 'ready',
      row: topicSummaryRow(page, NO_TOPIC),
      tracked: page?.entities ?? NO_ENTITIES,
      fetching: false,
      error: null,
      retry: () => undefined,
    };
  }
  const { data } = query;
  return {
    status: query.isError ? 'failed' : data === undefined ? 'loading' : 'ready',
    row: data?.data.topics.find((topic) => topic.term_id === topicKey),
    tracked: data?.data.entities ?? NO_ENTITIES,
    fetching: query.isFetching,
    error: query.error,
    retry: () => void query.refetch(),
  };
}
