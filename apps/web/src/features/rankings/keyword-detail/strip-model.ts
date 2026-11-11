import type { DetailState } from './detail-state';
import { rankStats } from '../rank-history/rank-stats';
import type { AioHistoryItem, RankHistory, TrackedKeywordState } from '@/lib/api/types';
import { aioDisplay, rowChangeDisplay, rankDisplay, type AioDisplay, type ChangeDisplay } from '@/lib/format';

/**
 * What the six cells of the metric strip show (24-page-templates.md section 9.4). The model decides and
 * returns codes and numbers, never words; the component words them. A figure whose source did not load, or
 * that has nothing to count, is `unavailable` (n/a), never a zero.
 */

export interface StripInput {
  state: DetailState;
  tracked: TrackedKeywordState;
  /** The page's history of the window; `undefined` while it loads or when its read failed. */
  history: RankHistory | undefined;
  /** The AI Overview checks of the window; `undefined` while they load or when their read failed. */
  aio: readonly AioHistoryItem[] | undefined;
}

export type RankStripCell =
  | { kind: 'pending' }
  | { kind: 'failed' }
  | {
      kind: 'value';
      rank: number;
      /** The keyword is stale: `observedAt` is the last good check. */
      stale: boolean;
      /** Checks after the one shown have failed. */
      failing: boolean;
      observedAt: string;
      change: ChangeDisplay;
    }
  | {
      kind: 'beyond';
      depth: number;
      stale: boolean;
      failing: boolean;
      observedAt: string | null;
      change: ChangeDisplay;
    };

export interface AioCounts {
  /** Checks with an AI Overview. */
  present: number;
  /** Checks that could be read: with one or without. */
  of: number;
}

export interface StripCells {
  rank: RankStripCell;
  /** All time, from the keyword, not from the window. */
  best: { kind: 'value'; rank: number; at: string | null } | { kind: 'none' } | { kind: 'unavailable' };
  /** The API's average of the window, over `ranked` of `checks` checks. */
  average:
    | { kind: 'value'; value: number; ranked: number; checks: number }
    | { kind: 'none'; checks: number }
    | { kind: 'unavailable' };
  topTen: { kind: 'value'; days: number; of: number } | { kind: 'unavailable' };
  /** What the table cell shows, from the keyword; `counts` from the window's checks, null when they are not there. */
  aio: { display: AioDisplay; counts: AioCounts | null };
}

const READABLE = new Set<AioHistoryItem['ai_overview_state']>(['absent', 'present_cited', 'present_not_cited']);
const PRESENT = new Set<AioHistoryItem['ai_overview_state']>(['present_cited', 'present_not_cited']);

/** The checks whose AI Overview could be read, and how many of them had one. A check that could not be read says nothing. */
export function aioCounts(items: readonly AioHistoryItem[]): AioCounts {
  return {
    present: items.filter((item) => PRESENT.has(item.ai_overview_state)).length,
    of: items.filter((item) => READABLE.has(item.ai_overview_state)).length,
  };
}

/** The rank cell by the keyword's state: a pending or failed keyword shows no number, whatever the raw cell carries. */
function rankCell({ state, tracked }: StripInput): RankStripCell {
  if (state.kind === 'pending') return { kind: 'pending' };
  if (state.kind === 'failed') return { kind: 'failed' };
  const display = rankDisplay(tracked.current, state.kind === 'stale', tracked.consecutive_failures);
  switch (display.kind) {
    case 'pending':
      return { kind: 'pending' };
    case 'failed':
      return { kind: 'failed' };
    case 'ranked':
      return {
        kind: 'value',
        rank: display.rank,
        stale: display.stale,
        failing: display.failing,
        observedAt: display.observedAt,
        change: rowChangeDisplay(tracked.current, tracked.change),
      };
    case 'beyond':
      return {
        kind: 'beyond',
        depth: display.depth,
        stale: display.stale,
        failing: display.failing,
        observedAt: display.observedAt,
        change: rowChangeDisplay(tracked.current, tracked.change),
      };
  }
}

export function stripCells(input: StripInput): StripCells {
  const { tracked, history, aio } = input;
  const rank = rankCell(input);
  // A keyword with no good check has no rank facts to show, whatever else the reads carry
  const checked = rank.kind !== 'pending' && rank.kind !== 'failed';
  const series = history?.series ?? [];
  const own = series.find((entry) => entry.entity.role === 'own') ?? series[0];
  const stats = history === undefined || own === undefined || !checked ? null : rankStats(own.points);
  const average = history?.summary.average_rank?.value ?? null;

  return {
    rank,
    best: !checked
      ? { kind: 'unavailable' }
      : tracked.best_rank === null
        ? { kind: 'none' }
        : { kind: 'value', rank: tracked.best_rank, at: tracked.best_rank_at },
    average:
      stats === null || stats.checks === 0
        ? { kind: 'unavailable' }
        : average === null
          ? { kind: 'none', checks: stats.checks }
          : { kind: 'value', value: average, ranked: stats.ranked, checks: stats.checks },
    topTen:
      stats === null || stats.daysChecked === 0
        ? { kind: 'unavailable' }
        : { kind: 'value', days: stats.topTenDays, of: stats.daysChecked },
    aio: {
      display:
        rank.kind === 'pending'
          ? { kind: 'pending' }
          : rank.kind === 'failed'
            ? { kind: 'unknown' }
            : aioDisplay(tracked.aio, tracked.current.state),
      counts: aio === undefined ? null : aioCounts(aio),
    },
  };
}
