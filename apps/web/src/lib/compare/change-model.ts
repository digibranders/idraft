import type { EngineSummary } from '@/lib/api/types';
import type { MetricDeltaInput } from '@/lib/format';
import { cellFigure, type CellMetric } from '@/lib/rates/rate-model';
import { engineRates, type EngineRates, type RateReading, type StripPrompt } from '@/lib/rates/strip-model';
import { isDetectableChange } from '@/lib/stats';

/**
 * How a rate moved since the compared window (WP-19, decisions D3 to D5), as plain data: the points, whether the move
 * is larger than normal variation, and the counts of both sides so a screen can say what it rests on. Pure.
 *
 * Until the API sends its own verdict (`is_detectable`, BE-STATS-02) the test is the unpaired Newcombe interval on
 * the counts of the two windows (docs/17 section 6.2), so every change drawn from here is an interim one. A change
 * that cannot be tested says so with `detectable: null`; it is never coloured, and an unknown rate is never 0.
 */

/** Two rates on the 0 to 1 scale are one when they differ by no more than the float noise of the sums that made them. */
const SAME_RATE = 1e-9;

/** One window of a change: the rate and the answers behind it. */
export interface Side {
  /** The rate on the 0 to 1 scale. */
  value: number;
  /** The valid answers behind it; for share of voice, the valid answers that name a tracked brand. */
  answers: number;
  /** The answers that count; `null` for share of voice and where the count is not whole. */
  successes: number | null;
  /** The prompts a topic cell weights, or those a strip figure is the mean over; `null` for a prompt's cell and for an average. */
  prompts: number | null;
}

export interface RateChange {
  /** The rate now minus the rate before, on the 0 to 1 scale (`formatMetricDelta` writes it in points). */
  points: number;
  /** The unpaired test on the pooled answers of both windows; `null` where it cannot be told (see `rateChange`). */
  detectable: boolean | null;
  now: Side;
  before: Side;
  /** The engines the figures average: 1 for a single engine or a strip figure. More than 1 means the test ran on their answers pooled. */
  engines: number;
}

/** What a change needs of a rate: `RateReading`, plus the prompts a topic cell weights when it has them. */
export type RateChangeInput = RateReading & { readonly prompts?: number | null };

type Reading = RateChangeInput;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** Whether a reading shows a rate (`state` ok, with a value); named apart from `hasRate` of `lib/rates`, which reads a cell. */
const isRated = (reading: Reading): reading is Reading & { value: number } =>
  reading.state === 'ok' && reading.value !== null;

/** Whether the move is larger than normal variation: `null` for share of voice (no count of successes) and for counts that cannot be tested. */
function detectableOf(points: number, now: Reading, before: Reading, metric: CellMetric): boolean | null {
  if (metric === 'share_of_voice' || now.successes === null || before.successes === null) return null;
  if (now.answers <= 0 || before.answers <= 0) return null;
  const current = { k: now.successes, n: now.answers };
  const earlier = { k: before.successes, n: before.answers };
  // The points are the move of the weighted rates, the test reads the pooled answers: when the two do not move the
  // same way the test would answer another question than the points state, so no claim is made
  const pooled = current.k / current.n - earlier.k / earlier.n;
  const agree = Math.abs(pooled) > SAME_RATE ? points * pooled > 0 : Math.abs(points) <= SAME_RATE;
  return agree ? isDetectableChange(current, earlier) : null;
}

const sideOf = (reading: Reading & { value: number }): Side => ({
  value: reading.value,
  answers: reading.answers,
  successes: reading.successes,
  prompts: reading.prompts ?? null,
});

/**
 * The change from `before` to `now`, or `null` when either has no rate to show (under 4 valid answers, or none): a
 * rate that is not there is never read as 0, so a move from or to it is not drawn.
 */
export function rateChange(now: RateChangeInput, before: RateChangeInput, metric: CellMetric): RateChange | null {
  if (!isRated(now) || !isRated(before)) return null;
  const points = now.value - before.value;
  return {
    points,
    detectable: detectableOf(points, now, before, metric),
    now: sideOf(now),
    before: sideOf(before),
    engines: 1,
  };
}

/** One engine's cell as a rate with the prompts it weights, as the tables read it. */
function readingOf(engine: EngineSummary, metric: CellMetric): Reading {
  // Share of voice is one answer one weight and has no `pooled`: the prompts are those of the same engine's Mentioned
  const weighting = metric === 'share_of_voice' ? engine.mentioned : engine[metric];
  return { ...cellFigure(engine, metric), prompts: weighting.pooled != null ? weighting.denominator : null };
}

/** The engine's window over the compared window as an engine of its own, or `undefined` when it has no `previous`. */
const previousOf = (engine: EngineSummary | undefined): EngineSummary | undefined =>
  engine?.previous == null ? undefined : { ...engine.previous, engine_code: engine.engine_code };

/** How one engine of a row moved since the compared window; `null` when the row has none of it, or either side has no rate. */
export function engineChangeOf(
  cells: readonly EngineSummary[] | undefined,
  code: string,
  metric: CellMetric,
): RateChange | null {
  const engine = cells?.find((cell) => cell.engine_code === code);
  const previous = previousOf(engine);
  if (engine === undefined || previous === undefined) return null;
  return rateChange(readingOf(engine, metric), readingOf(previous, metric), metric);
}

/**
 * How the equal weight average over the engines `codes` moved (the Mention rate column, D4). Only an engine that has a
 * rate in BOTH windows takes part, on both sides, so the engine set is the same; `engines` says how many. The test runs
 * on those engines' answers pooled, so a screen must say "pooled"; one engine gives that engine's own change.
 */
export function averageChangeOf(
  cells: readonly EngineSummary[] | undefined,
  codes: readonly string[],
  metric: CellMetric,
): RateChange | null {
  // A repeated code is one engine, so it cannot count twice in the pooled answers
  const taking = [...new Set(codes)].flatMap((code) => {
    const engine = cells?.find((cell) => cell.engine_code === code);
    const previous = previousOf(engine);
    if (engine === undefined || previous === undefined) return [];
    const now = readingOf(engine, metric);
    const before = readingOf(previous, metric);
    return isRated(now) && isRated(before) ? [{ now, before }] : [];
  });
  const [first] = taking;
  if (first === undefined) return null;
  if (taking.length === 1) return rateChange(first.now, first.before, metric);

  // One count that is not whole leaves the pooled count unknown, so the change is not tested rather than guessed
  const together = (readings: readonly (Reading & { value: number })[]): Reading & { value: number } => ({
    state: 'ok',
    value: sum(readings.map((reading) => reading.value)) / readings.length,
    answers: sum(readings.map((reading) => reading.answers)),
    successes: readings.every((reading) => reading.successes !== null)
      ? sum(readings.map((reading) => reading.successes ?? 0))
      : null,
    reason: null,
    prompts: null,
  });
  const change = rateChange(
    together(taking.map((entry) => entry.now)),
    together(taking.map((entry) => entry.before)),
    metric,
  );
  return change === null ? null : { ...change, engines: taking.length };
}

const STRIP_KEYS = {
  mentioned: 'mentioned',
  cited: 'cited',
  share_of_voice: 'shareOfVoice',
} as const satisfies Record<CellMetric, keyof EngineRates>;

/**
 * How the strip's figure of an engine moved (D5): the prompt weighted rate over the prompts' `previous` cells, minus the
 * figure the chip shows over their cells now. A prompt whose engine has no `previous` has no part in the earlier figure;
 * each side counts its own prompts (`prompts` of each side say how many).
 */
export function stripChangeOf(prompts: readonly StripPrompt[], code: string, metric: CellMetric): RateChange | null {
  const earlier: StripPrompt[] = prompts.map((prompt) => ({
    topic_term_ids: prompt.topic_term_ids,
    engines: prompt.engines.flatMap((engine) => {
      const previous = engine.engine_code === code ? previousOf(engine) : undefined;
      return previous === undefined ? [] : [previous];
    }),
  }));
  const key = STRIP_KEYS[metric];
  return rateChange(engineRates(prompts, code)[key], engineRates(earlier, code)[key], metric);
}

/** What `Delta` and `DeltaCell` take: the points, and the test's verdict as the only source of colour. */
export function deltaInput(change: RateChange | null): MetricDeltaInput {
  return {
    value: change?.points ?? null,
    unit: 'points',
    polarity: 'higher_is_better',
    isDetectable: change?.detectable ?? null,
  };
}
