'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { trackedSetQuery } from './tracked-set-query';
import type { SummaryOptions } from '../../../data/overview-queries';
import type { OverviewPeriods, ReadOptions } from '../../../data/use-overview-reads';
import { useOverview, useOverviewPeriods } from '../../../overview-context';
import { trackedSetOf } from '../model/tracked-set';
import type { TrackedSet } from '../model/types';
import type { PromptsSummary } from '@/lib/api/types';

/**
 * The reads of the competitors family (WP-35 plan section 3.1, D-12). Four request shapes cover the eight cards;
 * a shape is one request however many cards use it (they share the query key), and the previous window is the same
 * shape read again, so the mock needs no `compare`. When `ai/competitors` is real only this file and the model change.
 *
 * - `prompt-rows`: every prompt row with its entity cells, for Lost to a competitor and Opportunities.
 * - `totals`: the one-row total and the entity cells, no row lists, for the bars and the table.
 * - `pairs`: the totals and the co-mention pair counts.
 * - `weekly`: the totals and a point per week with its entity cells.
 */
export type ReadShape = 'prompt-rows' | 'totals' | 'pairs' | 'weekly';

export const SHAPE_OPTIONS: Readonly<Record<ReadShape, SummaryOptions>> = {
  'prompt-rows': { include: ['entities', 'total'] },
  totals: { include: ['entities', 'total'], rows: 'none' },
  pairs: { include: ['co_mentions', 'entities', 'total'], rows: 'none' },
  weekly: { include: ['entities', 'series', 'total'], rows: 'none' },
};

/**
 * The summary of the window and, with the comparison on, of the window before it, for one shape. A card passes the
 * `live` of its `CardProps` as `subscribed`: while it is false (customize mode) neither window is asked.
 */
export function useCompetitorReads(shape: ReadShape, options: ReadOptions = {}): OverviewPeriods {
  return useOverviewPeriods({ ...SHAPE_OPTIONS[shape], ...options });
}

/**
 * The tracked set of a summary: who is in it comes from the summary, the colour slot and the day each brand joined
 * from the entities read. `null` until the summary is in. While the entities read loads, and when it failed, the
 * brands have no slot and no date: a failed entities read is never an error of the card, the card draws on with the
 * next free slots and a footnote without dates.
 */
export function useTrackedSet(summary: PromptsSummary | undefined): TrackedSet | null {
  const { workspaceId, project } = useOverview();
  const entities = useQuery(trackedSetQuery({ workspaceId, projectId: project.id }));
  const rows = entities.data?.data ?? null;
  return useMemo(() => (summary === undefined ? null : trackedSetOf(summary, rows)), [summary, rows]);
}
