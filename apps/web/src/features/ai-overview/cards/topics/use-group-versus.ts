'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { isCountedMeasure } from './group-rows';
import { versusRows, type VersusRow } from './group-versus-model';
import type { UnavailablePlatform } from './heatmap-model';
import type { TopicData } from './model-types';
import { useAllGroupsSummary } from './use-topic-reads';
import { useOverview } from '../../overview-context';

/** The platform the API does not collect yet; it is in the groups cards as a column or a row that says so. */
export const AI_OVERVIEW_PLATFORM = 'google_ai_overview';

export interface GroupVersus {
  /** The read of every group on every platform with the all-groups total: the card's phase comes from it. */
  data: TopicData;
  rows: VersusRow[];
  unavailable: UnavailablePlatform[];
  counted: boolean;
}

/**
 * What the chosen group is set against (OV-GRP-12): the group's cells on every platform and the cells of all groups,
 * both from one read that ignores the page's Platform and Group (the card compares groups, not platforms). The group
 * is a row of that read, rolled up with the groups below it as the Group select counts it.
 */
export function useGroupVersus(live: boolean): GroupVersus {
  const t = useTranslations('aiOverview.topics.groups.versus');
  const shell = useTranslations('aiOverview.shell');
  const { scope } = useOverview();
  const measure = scope.metric;
  const data = useAllGroupsSummary({
    subscribed: live,
    include: ['total'],
    rows: 'topics',
    counts: measure === 'sov',
  });
  const average = t('average');
  const { nodes, engines, summary } = data;
  const rows = useMemo(() => {
    const group = nodes.flatMap((node) => [node, ...node.children]).find((node) => node.termId === scope.topic);
    return versusRows({
      platforms: engines,
      group: group?.engines,
      all: summary?.total?.engines,
      measure,
      averageLabel: average,
    });
  }, [nodes, engines, summary, scope.topic, measure, average]);
  const unavailable = useMemo(
    (): UnavailablePlatform[] => [{ code: AI_OVERVIEW_PLATFORM, label: shell('platformAiOverview') }],
    [shell],
  );
  return { data, rows, unavailable, counted: isCountedMeasure(measure) };
}
