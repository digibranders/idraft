import type { ReactNode } from 'react';

import type { MetricStripGroup, MetricStripItem } from '@/components/app/metric/metric-strip';
import { formatInteger, formatPercent, formatPointsDelta } from '@/lib/format';

/** The ids of the strip's items and groups, and the file names of the charts' downloads. Not visible text. */
export const STRIP_GROUP = 'strip';
export const ID = {
  tracked: 'tracked',
  own: 'own',
  leader: 'leader',
  gap: 'gap',
  mentions: 'mentions',
  sov: 'sov',
  platform: 'platform',
  lost: 'lost',
  keywords: 'keywords',
  top10: 'top10',
  behind: 'behind',
  rank: 'rank',
  ahead: 'ahead',
  mover: 'mover',
  strongest: 'strongest',
  mostLost: 'mostLost',
  average: 'average',
} as const;
export const FILE = {
  sovByCompetitor: 'share-of-voice-by-competitor',
  mentionsByCompetitor: 'mention-rate-by-competitor',
  sovTrend: 'share-of-voice-trend',
  sovChange: 'share-of-voice-change',
  mentionsByPlatform: 'mention-rate-by-platform',
  citationsSplit: 'citation-share-split',
  keywordsTop10: 'keywords-in-top-10',
  rankDistribution: 'rank-distribution',
} as const;
export const COLUMN = {
  name: 'name',
  value: 'value',
  change: 'change',
  prompt: 'prompt',
  lost: 'lost',
  of: 'of',
  ahead: 'ahead',
} as const;

export const stripOf = (items: readonly MetricStripItem[]): MetricStripGroup[] => [{ id: STRIP_GROUP, items }];

/** A rate: the empty mark reads as unknown, not as a zero. */
export function rateItem(
  id: string,
  label: string,
  value: number | null,
  delta: ReactNode,
  context?: string,
): MetricStripItem {
  return {
    id,
    label,
    value: formatPercent(value),
    unknown: value === null ? { kind: 'insufficient' } : null,
    delta,
    context: context ?? null,
  };
}

/** A count; `null` is a read that has not answered. */
export function countItem(id: string, label: string, value: number | null, context?: string | null): MetricStripItem {
  return {
    id,
    label,
    value: formatInteger(value),
    unknown: value === null ? { kind: 'pending' } : null,
    context: context ?? null,
  };
}

/** A short figure that is not a rate or a count: a rank, "#2". */
export function valueItem(id: string, label: string, value: string | null, context?: string | null): MetricStripItem {
  return {
    id,
    label,
    value: value ?? formatPercent(null),
    unknown: value === null ? { kind: 'insufficient' } : null,
    context: context ?? null,
  };
}

/** A word that is the answer (a name), not a figure. */
export function textItem(id: string, label: string, value: string | null, context?: string | null): MetricStripItem {
  return {
    id,
    label,
    value: value ?? formatPercent(null),
    text: true,
    unknown: value === null ? { kind: 'insufficient' } : null,
    context: context ?? null,
  };
}

/** A gap in ratio points between two rates, with who is ahead as context. */
export function gapItem(id: string, label: string, gap: number | null, context?: string | null): MetricStripItem {
  return {
    id,
    label,
    value: formatPointsDelta(gap),
    unknown: gap === null ? { kind: 'insufficient' } : null,
    context: gap === null ? null : (context ?? null),
  };
}

/** The gap of two possibly unknown rates. */
export const gapOf = (own: number | null | undefined, other: number | null | undefined): number | null =>
  own === null || own === undefined || other === null || other === undefined ? null : own - other;

/** The name of a chart's download: the tab and the chart. */
export const fileOf = (kind: string, part: 'by-competitor' | 'by-platform' | 'trend'): string => `${kind}-${part}`;
