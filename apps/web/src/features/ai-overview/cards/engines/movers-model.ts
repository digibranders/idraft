import { hasEnoughAnswers, rateOf, type EngineCounts, type PromptPairs } from './prompt-pairs';
import type { EngineCode } from '@/lib/api/types';
import { differenceInterval, isDetectableChange, type Interval } from '@/lib/stats';

/**
 * The prompt movers (CH-09) as plain data: which prompts gained or lost the most mention rate on one engine, between
 * the window and the one before. Pure: the card puts words and colours to them.
 *
 * A prompt is judged on its own answers in each window. One with fewer than `MIN_OBSERVATIONS` valid answers in
 * either window has no rate to compare and is left out (and counted); one asked in a single window is not a mover. The
 * two windows are unpaired, so the interval is the one of the difference of two pooled counts and the verdict is
 * `isDetectableChange`, as the strip's.
 */

export type MoverDirection = 'both' | 'up' | 'down';

/** One prompt in one window: `k` of `n` valid answers name the brand, and the rate they make. */
export interface MoverSide {
  k: number;
  n: number;
  rate: number;
}

export interface Mover {
  promptId: string;
  text: string;
  now: MoverSide;
  before: MoverSide;
  /** The rate now minus the rate before, on the 0 to 1 scale. */
  points: number;
  /** The 95 percent interval of that difference, on the same scale. */
  interval: Interval;
  /** Larger than normal variation; `null` where it cannot be told. Colour only when `true`. */
  detectable: boolean | null;
}

/**
 * - `noPrevious`: nothing to compare with (no pairs, or the engine has no answer in the window before).
 * - `nonePaired`: no prompt has 4 or more valid answers in both windows; `leftOut` prompts were asked in both.
 * - `noneMoved`: prompts were compared and none changed in the direction asked.
 * - `ok`: `movers` are the rows to draw (the Rows cap applied), `moved` is how many moved in the direction asked.
 */
export type MoversModel =
  | { state: 'noPrevious' }
  | { state: 'nonePaired'; leftOut: number }
  | { state: 'noneMoved'; leftOut: number; compared: number }
  | { state: 'ok'; movers: Mover[]; moved: number; compared: number; leftOut: number };

export interface MoversInput {
  /** The two windows joined by prompt; `null` while the window before is not read or the comparison is off. */
  pairs: PromptPairs | null;
  engine: EngineCode;
  direction: MoverDirection;
  /** The Rows option: how many movers to draw. */
  rows: number;
}

/** Two rates that differ by no more than the float noise of the division did not move. */
const SAME_RATE = 1e-12;

/** A window where the engine answered at all, valid or not: an answer that was not valid is still an answer. */
const answered = (counts: EngineCounts | null): boolean => counts !== null && counts.observations > 0;

function sideOf(counts: EngineCounts): MoverSide {
  // `hasEnoughAnswers` was checked: the rate is there
  return { k: counts.mentioned, n: counts.valid, rate: rateOf(counts.mentioned, counts.valid) ?? 0 };
}

export function buildMovers({ pairs, engine, direction, rows }: MoversInput): MoversModel {
  if (pairs === null) return { state: 'noPrevious' };
  const pairsOfEngine = pairs.prompts.flatMap((prompt) => {
    const pair = prompt.engines[engine];
    return pair === undefined ? [] : [{ prompt, pair }];
  });
  if (!pairsOfEngine.some(({ pair }) => answered(pair.before))) return { state: 'noPrevious' };

  // Only a prompt asked in both windows can be compared; one the engine never answered is not "left out"
  const asked = pairsOfEngine.filter(
    ({ prompt, pair }) => prompt.presence === 'both' && (answered(pair.now) || answered(pair.before)),
  );
  const comparable = asked.flatMap(({ prompt, pair }) =>
    hasEnoughAnswers(pair.now) && hasEnoughAnswers(pair.before) ? [{ prompt, now: pair.now, before: pair.before }] : [],
  );
  const leftOut = asked.length - comparable.length;
  if (comparable.length === 0) return { state: 'nonePaired', leftOut };

  const ordered = comparable
    .map(({ prompt, now, before }): Mover => {
      const nowSide = sideOf(now);
      const beforeSide = sideOf(before);
      const counts = { k: nowSide.k, n: nowSide.n };
      const earlier = { k: beforeSide.k, n: beforeSide.n };
      // Both have 4 or more valid answers, so there is an interval
      const interval = differenceInterval(counts, earlier) ?? { low: 0, high: 0 };
      return {
        promptId: prompt.promptId,
        text: prompt.text,
        now: nowSide,
        before: beforeSide,
        points: nowSide.rate - beforeSide.rate,
        interval,
        detectable: isDetectableChange(counts, earlier),
      };
    })
    .filter((mover) => Math.abs(mover.points) > SAME_RATE)
    .sort((a, b) => {
      // Sizes that differ by float noise only are a tie, which reads in text order
      const size = Math.abs(b.points) - Math.abs(a.points);
      return Math.abs(size) > SAME_RATE ? size : a.text.localeCompare(b.text) || a.promptId.localeCompare(b.promptId);
    });
  const moving = ordered.filter(
    (mover) => direction === 'both' || (direction === 'up' ? mover.points > 0 : mover.points < 0),
  );
  if (moving.length === 0) return { state: 'noneMoved', leftOut, compared: comparable.length };
  return { state: 'ok', movers: moving.slice(0, rows), moved: moving.length, compared: comparable.length, leftOut };
}
