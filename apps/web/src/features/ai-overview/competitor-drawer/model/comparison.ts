import { entityTotals } from '../../cards/competitors/model/entity-totals';
import type { EngineEntityTotals, EntityFigures, TrackedSet } from '../../cards/competitors/model/types';
import type { PromptsSummary } from '@/lib/api/types';
import type { RateState } from '@/lib/stats';

/**
 * You against one competitor over the platforms of the page scope (OV-DRW-10 and OV-DRW-12). The same definitions as
 * the competitor cards: each platform has its own figures from `entityTotals`, and All platforms is the equal-weight
 * average of the platforms where both brands have a rate (R3), never a ratio of pooled counts. A brand without a rate
 * on any platform has `value: null`, which is not 0 (R6).
 */

/** One brand's figure for one measure. */
export interface Figure {
  /** 0 to 1; `null` when no platform gives both brands a rate. */
  value: number | null;
  /** One platform only: the valid answers (mention rate) or the answers that mention a tracked brand (share of voice). */
  answers: number | null;
  /** One platform only, mention rate only: the answers that mention the brand. */
  successes: number | null;
}

export interface Pair {
  own: Figure;
  rival: Figure;
  /** The platforms both brands have a rate on: the N of "average of N platforms". */
  platforms: number;
}

export interface Comparison {
  mention: Pair;
  share: Pair;
}

const NONE: Figure = { value: null, answers: null, successes: null };

interface Reading {
  state: RateState;
  value: number | null;
  answers: number;
  successes: number | null;
}

const mentionOf = (figures: EntityFigures): Reading => ({
  state: figures.mention.state,
  value: figures.mention.value,
  answers: figures.mention.n,
  successes: figures.mention.k,
});

const shareOf = (figures: EntityFigures): Reading => ({
  state: figures.share.state,
  value: figures.share.value,
  answers: figures.share.answers,
  successes: null,
});

const brand = (totals: EngineEntityTotals, id: string | null, role: 'own' | 'competitor'): EntityFigures | undefined =>
  totals.entities.find((figures) => (id === null ? figures.entity.role === role : figures.entity.entityId === id));

const rated = (reading: Reading): reading is Reading & { value: number } =>
  reading.state === 'ok' && reading.value !== null;

const mean = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0) / values.length;

function pairOf(
  platforms: readonly EngineEntityTotals[],
  rivalId: string,
  read: (figures: EntityFigures) => Reading,
  average: boolean,
): Pair {
  const used = platforms.flatMap((totals) => {
    const own = brand(totals, null, 'own');
    const rival = brand(totals, rivalId, 'competitor');
    if (own === undefined || rival === undefined) return [];
    const sides = { own: read(own), rival: read(rival) };
    return rated(sides.own) && rated(sides.rival) ? [{ own: sides.own, rival: sides.rival }] : [];
  });
  if (used.length === 0) return { own: NONE, rival: NONE, platforms: 0 };
  const single = !average && used.length === 1 ? used[0] : undefined;
  const figure = (side: 'own' | 'rival'): Figure => ({
    value: mean(used.map((entry) => entry[side].value)),
    answers: single?.[side].answers ?? null,
    successes: single?.[side].successes ?? null,
  });
  return { own: figure('own'), rival: figure('rival'), platforms: used.length };
}

/**
 * Mention rate and share of voice of you and one competitor over `codes`. `average` is true for All platforms. `null`
 * when the summary carries no entity cells for any of the platforms (it was not asked for them).
 */
export function compareInScope(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
  rivalId: string,
  average: boolean,
): Comparison | null {
  const platforms = codes
    .map((code) => entityTotals(summary, code, set))
    .filter((totals): totals is EngineEntityTotals => totals.status === 'read');
  if (platforms.length === 0) return null;
  return {
    mention: pairOf(platforms, rivalId, mentionOf, average),
    share: pairOf(platforms, rivalId, shareOf, average),
  };
}

/** One row of the By platform card: both mention rates, `null` where a brand has under 4 valid answers. */
export interface PlatformRow {
  code: string;
  own: number | null;
  rival: number | null;
}

/** Every platform in `codes`, each on its own figures; a platform the summary does not carry is left out. */
export function platformRows(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
  rivalId: string,
): PlatformRow[] {
  return codes.flatMap((code): PlatformRow[] => {
    const totals = entityTotals(summary, code, set);
    if (totals.status !== 'read') return [];
    const own = brand(totals, null, 'own');
    const rival = brand(totals, rivalId, 'competitor');
    const valueOf = (figures: EntityFigures | undefined): number | null => {
      const reading = figures === undefined ? undefined : mentionOf(figures);
      return reading !== undefined && rated(reading) ? reading.value : null;
    };
    return [{ code, own: valueOf(own), rival: valueOf(rival) }];
  });
}

/** Your value minus theirs, 0 to 1 scale; `null` when either is missing. */
export const gapOf = (own: number | null, rival: number | null): number | null =>
  own === null || rival === null ? null : own - rival;
