import { mentionFigureOf } from './entity-totals';
import { colorSlots } from './tracked-set';
import {
  UNREAD,
  type FoldedPoint,
  type PoolNote,
  type RankedWeek,
  type TrackedSet,
  type WeeklyEntityShare,
  type WeeklyMentionPoint,
  type WeeklyPoint,
  type WeeklyRead,
} from './types';
import type { PromptsSummary, WeekCells } from '@/lib/api/types';
import { rateState } from '@/lib/stats';

/**
 * The weekly points of the competitors family: share of voice by week (CH-19), mention rate by week (CH-06) and
 * the rank of each brand by week (CH-29). They read `total.engines[engine].series` (request shape `weekly`, D-12);
 * without it the weeks are `unread`. Pooling is the API's (C-11): a pooled point says which weeks it holds.
 */

/** The weekly points of one engine's total, oldest first; `null` when the read does not carry them. */
function seriesOf(summary: PromptsSummary, engineCode: string): WeekCells[] | null {
  const series = summary.total?.engines.find((engine) => engine.engine_code === engineCode)?.series;
  if (series === undefined || series === null) return null;
  return [...series].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

function poolOf(point: WeekCells): PoolNote | null {
  const pool = point.is_pooled ? point.pool : null;
  return pool === undefined || pool === null ? null : { weeks: pool.weeks, from: pool.window.from, to: pool.window.to };
}

/**
 * Share of voice of every tracked brand in each week. A point with fewer than 4 answers naming a tracked brand has
 * no value for any brand (`state` says so) but keeps the numerators, so a thin week can still be pooled. A brand
 * the point carries no cell for has no value rather than 0.
 */
export function weeklyShares(summary: PromptsSummary, engineCode: string, set: TrackedSet): WeeklyRead<WeeklyPoint> {
  const series = seriesOf(summary, engineCode);
  if (series === null) return UNREAD;
  return {
    status: 'read',
    points: series.map((point) => {
      const answers = point.share_of_voice.denominator;
      const state = rateState(answers);
      return {
        weekStart: point.week_start,
        answers,
        state,
        pool: poolOf(point),
        entities: set.entities.map((entity) => {
          const cell = point.entities?.find((candidate) => candidate.entity_id === entity.entityId);
          return {
            entityId: entity.entityId,
            numerator: cell?.share_of_voice.numerator ?? 0,
            value: cell !== undefined && state === 'ok' ? cell.share_of_voice.numerator / answers : null,
          };
        }),
      };
    }),
  };
}

/**
 * One point drawn in the palette: the brands with a slot in slot order, and the shares of those without one summed
 * into `other` ("Other tracked"), so the column still adds up to 1. `other` is `null` when no brand is folded, when
 * the point has no share, and when a folded brand has none.
 */
export function foldOthers(point: WeeklyPoint, set: TrackedSet): FoldedPoint {
  const slots = colorSlots(set);
  const drawn: WeeklyEntityShare[] = [];
  for (const entityId of slots.keys()) {
    const share = point.entities.find((entry) => entry.entityId === entityId);
    if (share !== undefined) drawn.push(share);
  }
  const folded = point.entities.filter((entry) => !slots.has(entry.entityId));
  const values = folded.map((entry) => entry.value);
  const other =
    folded.length === 0 || values.some((value) => value === null)
      ? null
      : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return {
    weekStart: point.weekStart,
    answers: point.answers,
    state: point.state,
    pool: point.pool,
    entities: drawn,
    other,
  };
}

/** The mention rate of every tracked brand in each week: `k` of `n` from the point's pooled counts. */
export function weeklyMention(
  summary: PromptsSummary,
  engineCode: string,
  set: TrackedSet,
): WeeklyRead<WeeklyMentionPoint> {
  const series = seriesOf(summary, engineCode);
  if (series === null) return UNREAD;
  return {
    status: 'read',
    points: series.map((point) => ({
      weekStart: point.week_start,
      pool: poolOf(point),
      entities: set.entities.map((entity) => {
        const figure = mentionFigureOf(
          point.entities?.find((candidate) => candidate.entity_id === entity.entityId)?.mentioned,
        );
        return { entityId: entity.entityId, state: figure.state, value: figure.value, k: figure.k, n: figure.n };
      }),
    })),
  };
}

/** Pooling the client does when the API pooled nothing: the trailing four weeks, clipped at the window start. */
const POOL_WEEKS = 4;
const EPSILON = 1e-9;

/** Competition ranking of shares: ties share the lower rank (1, 2, 2, 4). A brand without a share has no rank. */
function ranksOf(shares: readonly (number | null)[]): (number | null)[] {
  return shares.map((share) =>
    share === null ? null : 1 + shares.filter((other) => other !== null && other > share + EPSILON).length,
  );
}

/**
 * The rank of every brand in each week, by share of voice. When the API pooled any point (C-11) the points are
 * ranked as read. Otherwise each week is ranked on the pool of the trailing four weeks (fewer at the start of the
 * window), so one thin week does not reorder the brands. A week whose shares are of fewer than 4 answers naming a
 * tracked brand has no rank: a gap, never a last place.
 */
export function rankSeries(points: readonly WeeklyPoint[]): RankedWeek[] {
  const ordered = [...points].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const asRead = ordered.some((point) => point.pool !== null);
  return ordered.map((point, index) => {
    const window = asRead ? [point] : ordered.slice(Math.max(0, index - POOL_WEEKS + 1), index + 1);
    const answers = window.reduce((total, entry) => total + entry.answers, 0);
    const enough = rateState(answers) === 'ok';
    const entities = point.entities.map((entity) => {
      const numerator = window.reduce(
        (total, entry) =>
          total + (entry.entities.find((candidate) => candidate.entityId === entity.entityId)?.numerator ?? 0),
        0,
      );
      // As read, a brand with no value in a point (no cell) stays without a rank
      const share = asRead ? entity.value : enough ? numerator / answers : null;
      return { entityId: entity.entityId, share, numerator };
    });
    const ranks = ranksOf(entities.map((entity) => entity.share));
    return {
      weekStart: point.weekStart,
      answers,
      poolWeeks: asRead ? (point.pool?.weeks ?? null) : window.length,
      entities: entities.map((entity, position) => ({ ...entity, rank: ranks[position] ?? null })),
    };
  });
}
