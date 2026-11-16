'use client';

import { useMemo } from 'react';

import { askedEngines } from '../../data/overview-queries';
import { useOverviewSummary as readSummary } from '../../data/use-overview-reads';
import { useOverview, useOverviewPeriods } from '../../overview-context';
import { SHAPE_OPTIONS, useTrackedSet } from '../../cards/competitors/data/use-competitor-reads';
import { leadsOf, type CompetitorLead, type LeadRead } from '../../cards/competitors/model/lead-rule';
import type { TrackedEntity, TrackedSet } from '../../cards/competitors/model/types';
import { useCardPlatforms, type CardPlatforms } from '../../cards/competitors/parts/card-engine';
import { inCatalogOrder } from '../../cards/engines/engine-role';
import type { Read } from '../../data/read-state';
import { groupsOf } from '../../cards/topics/topic-nodes';
import { useTopicSummary } from '../../cards/topics/use-topic-reads';
import { competitorOrder } from '../model/order';
import type { PromptGroup } from '../model/prompt-lists';
import type { EngineCode, PromptsSummary } from '@/lib/api/types';

/**
 * What the competitor drawer reads of the page scope. The prompt rows with the entity cells and the total are the
 * competitor gap card's own read (one request, one cache entry), so the order of the competitors, the counts of
 * the leads and the prompts behind them are the card's (R12). The weekly read and the read over every platform
 * are asked only while the Overview tab shows (`overviewTab`).
 */

export interface CompetitorRead {
  /** The prompt rows of the scope: `loading` and `error` of the drawer's reads follow it. */
  status: 'idle' | 'loading' | 'ready' | 'refetching' | 'error';
  errorId: string | null;
  retry: () => void;
  summary: PromptsSummary | undefined;
  set: TrackedSet | null;
  platforms: CardPlatforms;
  leads: LeadRead | null;
  /** The competitors in the order of the gap card. */
  order: CompetitorLead[];
  /** The groups of each prompt, for the group strip and the badges. */
  groupsByPrompt: ReadonlyMap<string, readonly PromptGroup[]>;
  /** The groups (flat) are the page's own scope: the strip is left out when one group is chosen. */
  allGroups: boolean;
}

export function useCompetitorRead(): CompetitorRead {
  const { scope } = useOverview();
  const platforms = useCardPlatforms();
  const topics = useTopicSummary(SHAPE_OPTIONS['prompt-rows']);
  const set = useTrackedSet(topics.summary);
  const leads = useMemo(
    (): LeadRead | null =>
      topics.summary !== undefined && set !== null && platforms.codes.length > 0
        ? leadsOf(topics.summary, platforms.codes, set)
        : null,
    [topics.summary, set, platforms.codes],
  );
  const order = useMemo(() => competitorOrder(leads), [leads]);
  const groupsByPrompt = useMemo(() => {
    const held = new Map<string, PromptGroup[]>();
    for (const node of groupsOf(topics.nodes)) {
      for (const member of node.members ?? []) {
        held.set(member.prompt_id, [...(held.get(member.prompt_id) ?? []), { key: node.key, name: node.name }]);
      }
    }
    return held;
  }, [topics.nodes]);
  return {
    status: topics.phase,
    errorId: topics.errorId,
    retry: topics.retry,
    summary: topics.summary,
    set,
    platforms,
    leads,
    order,
    groupsByPrompt,
    allGroups: scope.topic === null,
  };
}

/** The tracked brand of the drawer, when it is a competitor of the set. */
export function competitorOf(set: TrackedSet | null, id: string): TrackedEntity | undefined {
  return set?.entities.find((entity) => entity.role === 'competitor' && entity.entityId === id);
}

/**
 * The weekly read of the scope (entity cells per week) for the trend, and with Compare on the window before it, whose
 * weeks come first as on the page's own trend. The previous window counts only while it is of the same scope.
 */
export function useWeeklyReads(subscribed: boolean): {
  current: Read<PromptsSummary>;
  previous: PromptsSummary | null;
} {
  const periods = useOverviewPeriods({ ...SHAPE_OPTIONS.weekly, subscribed });
  const previous = periods.paired && periods.previous?.data !== undefined ? periods.previous.data : null;
  return { current: periods.current, previous };
}

/** The platforms the project has on, whatever the page's Platform says: the By platform card lists them all. */
export function useEveryPlatformRead(subscribed: boolean): {
  read: Read<PromptsSummary>;
  codes: readonly EngineCode[];
} {
  const { workspaceId, project, scope, enabledEngines } = useOverview();
  const input = useMemo(
    () => ({
      project: { workspaceId, projectId: project.id },
      scope: { ...scope, engines: null },
      enabledEngines,
    }),
    [workspaceId, project.id, scope, enabledEngines],
  );
  const read = readSummary(input, { ...SHAPE_OPTIONS.totals, subscribed });
  const codes = useMemo(() => inCatalogOrder(askedEngines(input)), [input]);
  return { read, codes };
}
