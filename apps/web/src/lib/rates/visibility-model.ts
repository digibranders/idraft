import { cellFigure } from './rate-model';
import { weightedFigure, type RateFigure, type RateReading, type StripPrompt } from './strip-model';
import type { EngineSummary, MetricCell } from '@/lib/api/types';
import { equalWeightAverage } from '@/lib/stats';

/**
 * AI Visibility (spec 2026-11-16-ai-overview-redesign-design.md D1 and D2): the share of valid answers that name
 * or cite the brand, that is 100% minus "neither". It is a plain rate with its counts, never a score. A platform's
 * value comes from the sum of the three outcome cells that are not "neither"; "All platforms" is the equal-weight
 * average of the platforms' values (docs/16 rule 2, R3), never a ratio of pooled counts.
 */

/** `ok`: a rate over enough valid answers. `insufficient`: fewer than `MIN_OBSERVATIONS`. `unknown`: no valid answer, which is not 0%. */
export type VisibilityState = 'ok' | 'insufficient' | 'unknown';

/**
 * The visibility cell of an engine's four outcomes: the numerators of "named and cited", "named only" and "cited
 * only" added up over the denominator they share. A prompt weighted cell (a topic's) keeps its `pooled` counts.
 */
export function visibilityCell(outcomes: EngineSummary['outcomes']): MetricCell {
  const { mentioned_and_cited: both, mentioned_only: named, cited_only: cited } = outcomes;
  const numerator = both.numerator + named.numerator + cited.numerator;
  const denominator = both.denominator;
  const pooled =
    both.pooled != null && named.pooled != null && cited.pooled != null
      ? {
          successes: both.pooled.successes + named.pooled.successes + cited.pooled.successes,
          trials: both.pooled.trials,
        }
      : null;
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
    n_observations: both.n_observations,
    pooled,
  };
}

/** The visibility of one engine's cells (a prompt's or a topic's), as `cellFigure` reads a rate; no cells is no answers. */
export function visibilityOfEngine(engine: EngineSummary | undefined): RateReading {
  return cellFigure(engine && { ...engine, mentioned: visibilityCell(engine.outcomes) }, 'mentioned');
}

/**
 * The visibility of one platform over the prompts in scope, prompt weighted like the strip's mention rate: the mean
 * of each prompt's own rate over the prompts with a valid answer, with the pooled answers behind it.
 */
export function visibilityOfPrompts(prompts: readonly StripPrompt[], code: string): RateFigure {
  return weightedFigure(
    prompts.flatMap((prompt) => {
      const engine = prompt.engines.find((cells) => cells.engine_code === code);
      return engine === undefined ? [] : [visibilityCell(engine.outcomes)];
    }),
  );
}

/** One platform's visibility with the counts behind it, in the form the headline and the trend read. */
export interface PlatformVisibility {
  code: string;
  state: VisibilityState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The valid answers behind the figure. */
  answers: number;
  /** The valid answers that name or cite the brand; `null` when the cells do not hold whole counts. */
  successes: number | null;
}

const stateOf = (reading: RateReading): VisibilityState =>
  reading.state === 'none' ? 'unknown' : reading.state === 'ok' ? 'ok' : 'insufficient';

export function platformVisibility(code: string, reading: RateReading): PlatformVisibility {
  return {
    code,
    state: stateOf(reading),
    value: reading.state === 'ok' ? reading.value : null,
    answers: reading.answers,
    successes: reading.state === 'ok' ? reading.successes : null,
  };
}

/** The data of "All platforms": the average, and what its label "avg of N" names. */
export interface VisibilityAverage {
  state: VisibilityState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The platforms that took part: the N of "avg of N". */
  used: number;
  /** Their codes, in the order given. A platform without a rate of its own is left out, not counted as 0. */
  names: readonly string[];
  /** How many platforms were asked for, so the label can say "2 of 3". */
  of: number;
  /** The valid answers of the platforms that took part (all of them when none did: the largest platform's, which an insufficient figure says). */
  answers: number;
}

/**
 * The equal-weight average of the platforms' visibility, each platform counting once whatever its answers
 * (docs/16 rule 2). Only a platform with a rate of its own takes part. When none does the average is
 * `insufficient` if some platform had answers, else `unknown`.
 */
export function averageVisibility(platforms: readonly PlatformVisibility[]): VisibilityAverage {
  const rated = platforms.filter((platform) => platform.state === 'ok');
  const { value, used } = equalWeightAverage(rated.map((platform) => platform.value));
  if (used === 0) {
    const largest = Math.max(0, ...platforms.map((platform) => platform.answers));
    const state = platforms.some((platform) => platform.state === 'insufficient') ? 'insufficient' : 'unknown';
    return { state, value: null, used: 0, names: [], of: platforms.length, answers: largest };
  }
  return {
    state: 'ok',
    value,
    used,
    names: rated.map((platform) => platform.code),
    of: platforms.length,
    answers: rated.reduce((total, platform) => total + platform.answers, 0),
  };
}
