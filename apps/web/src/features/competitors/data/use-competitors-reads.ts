'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  competitorsQuery,
  keywordRanksQuery,
  lostPromptsQuery,
  readScopeOf,
  seriesQuery,
  type ProjectRef,
} from './competitors-queries';
import { useRead, type Gate, type Read } from './read-state';
import type { CompetitorsScope } from '../scope/scope-model';
import type { ApiResponse } from '@/lib/api/query';
import type { EngineCode } from '@/lib/api/types';

/**
 * The reads of the Competitors page, each asked only by the tabs that show it, so a tab's reads stay off the others.
 * A scope change keeps the last data (`keepPreviousData`) and the read says `refetching`. Reads that depend on the
 * engines wait for them: with none known an empty list would mean every engine, so nothing is asked.
 */

type Project = '/api/v1/workspaces/{workspace_id}/projects/{project_id}';

export type CompetitorsRead = Read<ApiResponse<'get', `${Project}/ai/competitors`>>;
export type SeriesRead = Read<ApiResponse<'get', `${Project}/ai/metrics/{metric}/series`>>;
export type KeywordsRead = Read<ApiResponse<'get', `${Project}/tracked-keywords`>>;

export interface CompetitorsReadsInput {
  project: ProjectRef;
  scope: CompetitorsScope;
  range: { from: string; to: string };
  /** The engines that are on. */
  enabledEngines: readonly EngineCode[];
  /** The engines have been read and at least one is on. */
  enginesReady: boolean;
}

export interface CompetitorsReads {
  /** The tracked set with its values per engine; every AI tab reads it. */
  competitors: CompetitorsRead;
  /** The prompts lost to each competitor on the engine `eng`; the AI Visibility tab. */
  lost: CompetitorsRead;
  /** The weekly share of voice of every tracked entity; the Share of Voice tab. */
  sovSeries: SeriesRead;
  /** The weekly mention rate of every tracked entity; the Mentions tab. */
  mentionSeries: SeriesRead;
  /** The tracked keywords with the competitors' ranks; the SEO Ranking tab. */
  keywords: KeywordsRead;
}

const NO_IDS: readonly string[] = [];
const AI_TABS = new Set(['competitors', 'mentions', 'citations', 'sov', 'visibility']);

export function useCompetitorsReads({
  project,
  scope,
  range,
  enabledEngines,
  enginesReady,
}: CompetitorsReadsInput): CompetitorsReads {
  const read = useMemo(() => readScopeOf(scope, range, enabledEngines), [scope, range, enabledEngines]);
  const { tab, eng } = scope;
  const waiting = !enginesReady;

  const setGate: Gate = waiting ? 'waiting' : AI_TABS.has(tab) ? 'run' : 'idle';
  const competitors = useRead(
    useQuery({ ...competitorsQuery(project, read), enabled: setGate === 'run', placeholderData: keepPreviousData }),
    setGate,
  );

  const lostGate: Gate = waiting ? 'waiting' : tab === 'visibility' && eng !== null ? 'run' : 'idle';
  const lost = useRead(
    useQuery({
      ...lostPromptsQuery(project, read, eng ?? 'chatgpt_web'),
      enabled: lostGate === 'run',
      placeholderData: keepPreviousData,
    }),
    lostGate,
  );

  const entityIds = useMemo(
    () => (competitors.data === undefined ? NO_IDS : competitors.data.data.map((row) => row.entity.entity_id)),
    [competitors.data],
  );
  const seriesGateFor = (wanted: boolean): Gate => {
    if (!wanted) return 'idle';
    if (waiting) return 'waiting';
    if (competitors.data !== undefined) return 'run';
    return competitors.status === 'error' ? 'idle' : 'waiting';
  };
  const sovGate = seriesGateFor(tab === 'sov' || tab === 'competitors');
  const sovSeries = useRead(
    useQuery({
      ...seriesQuery(project, read, 'ai.share_of_voice', entityIds),
      enabled: sovGate === 'run',
      placeholderData: keepPreviousData,
    }),
    sovGate,
  );
  const mentionGate = seriesGateFor(tab === 'mentions');
  const mentionSeries = useRead(
    useQuery({
      ...seriesQuery(project, read, 'ai.mention_rate', entityIds),
      enabled: mentionGate === 'run',
      placeholderData: keepPreviousData,
    }),
    mentionGate,
  );

  const keywordsGate: Gate = tab === 'seo' ? 'run' : 'idle';
  const keywords = useRead(
    useQuery({ ...keywordRanksQuery(project), enabled: keywordsGate === 'run', placeholderData: keepPreviousData }),
    keywordsGate,
  );

  return { competitors, lost, sovSeries, mentionSeries, keywords };
}
