'use client';

import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import { chartCompetitors, pageRankHistoryQuery } from './detail-queries';
import type { DetailWindow } from './detail-window';
import {
  projectEntitiesQuery,
  type KeywordDetail,
  type KeywordScope,
  type ProjectEntity,
} from '../keyword-inspector/inspector-queries';
import type { RankHistory } from '@/lib/api/types';

export interface PageRankHistory {
  /** The project's entities: the history asks for the keyword's competitors among them, so it waits for them. */
  entities: UseQueryResult<{ data: ProjectEntity[] }>;
  history: UseQueryResult<{ data: RankHistory }>;
}

/**
 * The history of one window of the page. The chart panel and the metric strip both read it through the same
 * query (`pageRankHistoryQuery` under the same key), so it is one request however many sections draw from it.
 * A new window keeps the previous history on show while it loads.
 */
export function usePageRankHistory(scope: KeywordScope, detail: KeywordDetail, win: DetailWindow): PageRankHistory {
  const entities = useQuery(projectEntitiesQuery(scope));
  const competitors = useMemo(
    () => chartCompetitors(entities.data?.data ?? [], detail.competitor_overrides),
    [entities.data, detail.competitor_overrides],
  );
  const history = useQuery({
    ...pageRankHistoryQuery(scope, win, competitors.asked),
    enabled: entities.isSuccess,
    placeholderData: keepPreviousData,
  });
  return { entities, history };
}
