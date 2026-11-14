import type { EngineCounts, PromptPairs } from './prompt-pairs';
import type { EngineCode } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * "What moved the rate" (CH-13) as plain data: the exact decomposition of the change in one engine's rate between the
 * window before and this one (WP-34 plan section 3.5). Pure.
 *
 * `R0` and `R1` are the strip's prompt weighted rates (the mean of the prompts' own rates over the prompts with a
 * valid answer), passed in so that the card's ends are the strip's numbers (R12). Let `C` be the prompts with a valid
 * answer in both windows. Then `R1 - R0 = mean_C(r1 - r0) + remainder`, where the remainder is
 * `(R1 - mean_C(r1)) - (R0 - mean_C(r0))`: the part that comes from the prompt set having changed. `mean_C(r1 - r0)`
 * splits by prompt, each part being the sum of its prompts' `(r1 - r0) / |C|`:
 *
 * - rose / fell: prompts of `C` with 4 or more valid answers in both windows whose rate went up / down;
 * - too few answers: prompts of `C` with fewer than 4 valid answers in either window, signed;
 * - unchanged prompts contribute 0.
 *
 * So `start + rose + fell + tooFew + setChanged = end`, up to float rounding, whatever the prompts are.
 * For the citation metric a prompt's answers are those of the citation cell (`citedValid`).
 */

export type WaterfallMetric = 'mentioned' | 'cited';

export type BarId = 'start' | 'rose' | 'fell' | 'tooFew' | 'setChanged' | 'end';

/** The prompt with the largest change inside one part, for the tooltip. */
export interface TopPrompt {
  text: string;
  /** Its own change in rate, on the 0 to 1 scale (not its share of the total). */
  points: number;
}

export interface WaterfallBar {
  id: BarId;
  /** The rate for `start` and `end`; the signed contribution to the change for the others (0 to 1 scale). */
  value: number;
  /** Where the bar starts and ends on the rate axis: the ends rise from 0, a contribution floats from the running total. */
  from: number;
  to: number;
  /** The prompts the bar is made of: those with an answer for the ends, those in the part for a contribution. */
  prompts: number;
  /** The pooled answers behind a rate (`start` and `end` only). */
  answers: { k: number; n: number } | null;
  top: TopPrompt | null;
}

export type WaterfallModel =
  | { state: 'unknown' }
  | {
      state: 'ok';
      bars: WaterfallBar[];
      /** Prompts with a valid answer now and none before, and the reverse. */
      added: number;
      left: number;
    };

export interface WaterfallInput {
  /** The two windows joined by prompt; `null` while the window before is not read or the comparison is off. */
  pairs: PromptPairs | null;
  engine: EngineCode;
  metric: WaterfallMetric;
  /** The rate of the window before; `null` when it has no rate to show (under 4 valid answers). */
  start: number | null;
  /** The rate of this window; `null` as above. */
  end: number | null;
}

interface Side {
  k: number;
  n: number;
  rate: number;
}

/** One prompt's counts of the metric, or `null` when it has no valid answer: it is not in that window's prompt set. */
function sideOf(counts: EngineCounts | null, metric: WaterfallMetric): Side | null {
  if (counts === null) return null;
  const n = metric === 'mentioned' ? counts.valid : counts.citedValid;
  const k = metric === 'mentioned' ? counts.mentioned : counts.cited;
  return n >= 1 ? { k, n, rate: k / n } : null;
}

interface Change {
  text: string;
  points: number;
}

/** The largest change by size, a tie reading in text order; `null` for no prompt. */
function largest(changes: readonly Change[], pick: (change: Change) => number): TopPrompt | null {
  let best: Change | null = null;
  for (const change of changes) {
    if (best === null) best = change;
    else {
      const gap = pick(change) - pick(best);
      if (gap > 1e-12 || (Math.abs(gap) <= 1e-12 && change.text.localeCompare(best.text) < 0)) best = change;
    }
  }
  return best === null ? null : { text: best.text, points: best.points };
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

export function buildWaterfall({ pairs, engine, metric, start, end }: WaterfallInput): WaterfallModel {
  if (pairs === null || start === null || end === null) return { state: 'unknown' };
  const sides = pairs.prompts.flatMap((prompt) => {
    const pair = prompt.engines[engine];
    const now = pair === undefined ? null : sideOf(pair.now, metric);
    const before = pair === undefined ? null : sideOf(pair.before, metric);
    return now === null && before === null ? [] : [{ text: prompt.text, now, before }];
  });
  const inNow = sides.flatMap((entry) => (entry.now === null ? [] : [entry.now]));
  const inBefore = sides.flatMap((entry) => (entry.before === null ? [] : [entry.before]));
  const common = sides.flatMap(({ text, now, before }) =>
    now === null || before === null ? [] : [{ text, now, before }],
  );

  const rose: Change[] = [];
  const fell: Change[] = [];
  const tooFew: Change[] = [];
  for (const { text, now, before } of common) {
    const points = now.rate - before.rate;
    if (now.n < MIN_OBSERVATIONS || before.n < MIN_OBSERVATIONS) tooFew.push({ text, points });
    else if (points > 0) rose.push({ text, points });
    else if (points < 0) fell.push({ text, points });
  }
  // Each part is its prompts' change over the prompts of both windows; with no such prompt every change is the set's
  const share = (changes: readonly Change[]): number =>
    common.length === 0 ? 0 : sum(changes.map((change) => change.points)) / common.length;
  const mean = (values: readonly number[]): number => sum(values) / values.length;
  const setChanged =
    common.length === 0
      ? end - start
      : end - mean(common.map(({ now }) => now.rate)) - (start - mean(common.map(({ before }) => before.rate)));

  const roseValue = share(rose);
  const fellValue = share(fell);
  const tooFewValue = share(tooFew);
  const pooled = (list: readonly Side[]): { k: number; n: number } => ({
    k: sum(list.map((side) => side.k)),
    n: sum(list.map((side) => side.n)),
  });
  const steps: readonly { id: BarId; value: number; prompts: number; top: TopPrompt | null }[] = [
    { id: 'rose', value: roseValue, prompts: rose.length, top: largest(rose, (change) => change.points) },
    { id: 'fell', value: fellValue, prompts: fell.length, top: largest(fell, (change) => -change.points) },
    {
      id: 'tooFew',
      value: tooFewValue,
      prompts: tooFew.length,
      top: largest(tooFew, (change) => Math.abs(change.points)),
    },
    {
      id: 'setChanged',
      value: setChanged,
      prompts: inNow.length + inBefore.length - 2 * common.length,
      top: null,
    },
  ];
  let running = start;
  const floating = steps.map((step): WaterfallBar => {
    const from = running;
    running += step.value;
    return { ...step, from, to: running, answers: null };
  });
  return {
    state: 'ok',
    bars: [
      { id: 'start', value: start, from: 0, to: start, prompts: inBefore.length, answers: pooled(inBefore), top: null },
      ...floating,
      { id: 'end', value: end, from: 0, to: end, prompts: inNow.length, answers: pooled(inNow), top: null },
    ],
    added: inNow.length - common.length,
    left: inBefore.length - common.length,
  };
}

/** The smallest axis: a tenth. */
const MIN_SPAN = 0.1;

/**
 * The rate axis of the bars: from the lowest point any bar reaches (0 at least) to the highest, widened to tenths so
 * that the labels of a grid would be round and every bar is inside the track.
 */
export function waterfallDomain(bars: readonly WaterfallBar[]): readonly [low: number, high: number] {
  const points = [0, ...bars.flatMap((bar) => [bar.from, bar.to])];
  // The small offsets keep 0.3 * 10 = 3.0000000000000004 from rounding up to 0.4
  const low = Math.floor(Math.min(...points) * 10 + 1e-9) / 10;
  const high = Math.max(Math.ceil(Math.max(...points) * 10 - 1e-9) / 10, low + MIN_SPAN);
  return [low, high];
}
