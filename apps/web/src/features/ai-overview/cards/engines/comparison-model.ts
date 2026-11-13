import type { EngineAggregate, OverviewAggregates, Change } from '../../data/aggregates';
import { changeDomain, type ChangeDomain } from '@/components/app/chart/interval-bar';
import type { EngineCode } from '@/lib/api/types';
import type { RateFigure } from '@/lib/rates/strip-model';
import { differenceInterval, type Interval } from '@/lib/stats';

/**
 * "This period vs the last" (CH-10) as plain data: for each engine that is asked, the rate of one metric now and in
 * the window before, with the counts behind both, and how it moved. Every figure is the strip's own
 * (`buildAggregates`), so the card and the strip agree for the same scope (R12).
 *
 * Mention and citation carry the 95 percent interval of the change in the pooled answers; share of voice has none (it
 * has no count of successes), so its row is words with the numbers (plan decision D5). A change is detectable only
 * as the aggregates say.
 */

export type ComparisonMetric = 'mention' | 'citation' | 'share_of_voice';

/** One window of one engine: the rate and the answers behind it. */
export interface RateSide {
  value: number;
  /** The valid answers; for share of voice, those that name a brand. */
  answers: number;
  /** The answers that count; `null` for share of voice. */
  successes: number | null;
  /** The prompts the rate is the mean over, each counted once. */
  prompts: number;
}

/**
 * - `compare`: both windows have a rate. `interval` is `null` for share of voice.
 * - `thin`: an answer exists in each window but fewer than a rate needs in one of them (the answers are said).
 * - `none`: one window has no valid answer at all.
 */
export type ComparisonRow = { engineCode: EngineCode; label: string } & (
  | {
      state: 'compare';
      now: RateSide;
      before: RateSide;
      /** The rate now minus the rate before, on the 0 to 1 scale. */
      points: number;
      interval: Interval | null;
      detectable: boolean | null;
    }
  | { state: 'thin'; now: number; before: number }
  | { state: 'none' }
);

type Figure = 'mentioned' | 'cited' | 'shareOfVoice';

const FIGURE = {
  mention: 'mentioned',
  citation: 'cited',
  share_of_voice: 'shareOfVoice',
} as const satisfies Record<ComparisonMetric, Figure>;

const sideOf = (figure: RateFigure, value: number): RateSide => ({
  value,
  answers: figure.answers,
  successes: figure.successes,
  prompts: figure.prompts,
});

function rowOf(engine: EngineAggregate, metric: ComparisonMetric): ComparisonRow {
  const base = { engineCode: engine.engineCode, label: engine.label };
  const key = FIGURE[metric];
  const now = engine[key];
  const before = engine.previous?.[key] ?? null;
  if (before === null || now.state === 'none' || before.state === 'none') return { ...base, state: 'none' };
  if (now.state === 'insufficient' || before.state === 'insufficient') {
    return { ...base, state: 'thin', now: now.answers, before: before.answers };
  }
  if (now.value === null || before.value === null) return { ...base, state: 'none' };
  const change: Change = engine.change[key];
  return {
    ...base,
    state: 'compare',
    now: sideOf(now, now.value),
    before: sideOf(before, before.value),
    points: change.delta ?? now.value - before.value,
    // Share of voice has no count of successes, so no interval
    interval:
      now.successes === null || before.successes === null
        ? null
        : differenceInterval({ k: now.successes, n: now.answers }, { k: before.successes, n: before.answers }),
    detectable: change.detectable,
  };
}

/** A row for each engine that is asked, in the order of the catalog. */
export function buildComparison({
  aggregates,
  metric,
}: {
  aggregates: OverviewAggregates;
  metric: ComparisonMetric;
}): ComparisonRow[] {
  return aggregates.engines.filter((engine) => engine.asked).map((engine) => rowOf(engine, metric));
}

/** The smallest rate domain: a tenth. */
const MIN_RATE_DOMAIN = 0.1;

/**
 * The two axes of the dumbbells: the rates on `[0, the next tenth above the highest rate]`, and the change on a domain
 * that covers every interval and every change drawn (an interval the domain does not cover would be clamped to the
 * track edge with no mark to say so).
 */
export function comparisonDomains(rows: readonly ComparisonRow[]): { rate: ChangeDomain; change: ChangeDomain } {
  const drawn = rows.flatMap((row) =>
    row.state === 'compare' && row.interval !== null ? [{ row, interval: row.interval }] : [],
  );
  const highest = Math.max(0, ...drawn.flatMap(({ row }) => [row.now.value, row.before.value]));
  return {
    // The small subtraction keeps 0.7000000000000001 from rounding up to 0.8
    rate: [0, Math.max(MIN_RATE_DOMAIN, Math.ceil(highest * 10 - 1e-9) / 10)],
    change: changeDomain(
      drawn.map(({ row, interval }) => ({
        estimate: row.points,
        low: Math.min(interval.low, row.points),
        high: Math.max(interval.high, row.points),
      })),
    ),
  };
}
