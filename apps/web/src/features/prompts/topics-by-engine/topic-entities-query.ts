'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { NO_TOPIC, type DateRange } from '@/features/prompts/prompt-model';
import type { PromptScope } from '@/features/prompts/prompt-queries';
import { apiQuery, type ApiQueryOptions } from '@/lib/api/query';
import type { SummaryEntity, TopicSummaryRow } from '@/lib/api/types';

/** What the entities read of the Topics tab is asked of: the scope of the page's own summary read. */
export interface TopicReadScope {
  scope: PromptScope;
  range: DateRange;
  includeBranded: boolean;
  country: string | null;
}

const SUMMARY = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/ai/prompts-summary' as const;

/**
 * `GET {P}/ai/prompts-summary` for the topic rows alone with the entity cells (C-15: 12 to 16 KB where all rows with
 * entities are megabytes). The page's own read keeps the prompt rows; this one adds who leads each engine of a topic.
 * Its key sits under the project's `ai` prefix, so `refreshPrompts` reaches it.
 */
export const topicEntitiesQuery = ({
  scope,
  range,
  includeBranded,
  country,
}: TopicReadScope): ApiQueryOptions<typeof SUMMARY> =>
  apiQuery(SUMMARY, {
    params: {
      path: { workspace_id: scope.workspaceId, project_id: scope.projectId },
      query: {
        from: range.from,
        to: range.to,
        include_branded: includeBranded,
        ...(country === null ? {} : { 'filter[country_iso]': country }),
        rows: 'topics',
        include: ['entities'],
      },
    },
  });

export interface EntityRead {
  /** `loading` while the first read is on its way or not asked; `failed` when it failed; `ready` once rows are held. */
  status: 'loading' | 'failed' | 'ready';
  /** The topic rows by key: the term id, or `NO_TOPIC` for the prompts without a topic. */
  rows: ReadonlyMap<string, TopicSummaryRow>;
  /** The tracked entities of the answers read, in the order the API lists them. */
  tracked: readonly SummaryEntity[];
  /** A read is on its way, the rows shown (if any) being those of an earlier one. */
  fetching: boolean;
  /** What the read failed with, for the error id; `null` while it has not failed. */
  error?: unknown;
  retry: () => void;
}

const NO_ROWS: ReadonlyMap<string, TopicSummaryRow> = new Map();
const NO_ENTITIES: readonly SummaryEntity[] = [];

/** The entities read, asked only while `enabled`; the last rows stay while the next window is read. */
export function useTopicEntities(read: TopicReadScope, enabled: boolean): EntityRead {
  const query = useQuery({ ...topicEntitiesQuery(read), enabled, placeholderData: keepPreviousData });
  const { data, refetch } = query;
  const rows = useMemo(
    () =>
      data === undefined
        ? NO_ROWS
        : new Map(data.data.topics.map((topic) => [topic.term_id ?? NO_TOPIC, topic] as const)),
    [data],
  );
  return {
    status: query.isError ? 'failed' : data === undefined ? 'loading' : 'ready',
    rows,
    tracked: data?.data.entities ?? NO_ENTITIES,
    fetching: query.isFetching,
    error: query.error,
    retry: () => void refetch(),
  };
}
