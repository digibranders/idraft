import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { engineRates, type RateFigure, type StripPrompt } from '@/lib/rates/strip-model';

/**
 * The numbers of "Named and cited, by engine" (CH-03). Pure: the card puts words and colours to them.
 *
 * One denominator per number (R12): every share is the strip's own arithmetic (`engineRates`) over the same prompt
 * rows, so "named and cited" here is the strip's number for the same scope. Each prompt counts once (the mean of the
 * prompts' own shares), and the legend carries the pooled answer counts behind them.
 */

/** The four outcomes of an answer, in the fixed order of the bar: a segment keeps its place whatever the data. */
export const OUTCOME_PARTS = ['mentioned_and_cited', 'mentioned_only', 'cited_only', 'neither'] as const;
export type OutcomePart = (typeof OUTCOME_PARTS)[number];

/** The strip's figure of each outcome of one engine: the outcome cell read as a `mentioned` cell, as the aggregates do. */
export function outcomeFigures(prompts: readonly StripPrompt[], code: EngineCode): Record<OutcomePart, RateFigure> {
  const figureOf = (part: OutcomePart): RateFigure =>
    engineRates(
      prompts.map((prompt) => ({
        topic_term_ids: prompt.topic_term_ids,
        engines: prompt.engines
          .filter((engine) => engine.engine_code === code)
          .map((engine) => ({ ...engine, mentioned: engine.outcomes[part] })),
      })),
      code,
    ).mentioned;
  return {
    mentioned_and_cited: figureOf('mentioned_and_cited'),
    mentioned_only: figureOf('mentioned_only'),
    cited_only: figureOf('cited_only'),
    neither: figureOf('neither'),
  };
}

/** A rate as a percent number to two places, for a file: the float noise of 0.3125 * 100 does not reach it. */
export const percentNumber = (rate: number): number => Math.round(rate * 10000) / 100;

/** One outcome's share (0 to 1) of the prompts' valid answers, and the pooled answers that have it. */
export interface OutcomeShare {
  part: OutcomePart;
  share: number;
  k: number;
}

/**
 * - `ok`: four shares that add up to 1, over `answers` pooled valid answers on `prompts` prompts.
 * - `insufficient`: fewer valid answers than a rate needs: no share, the answers are said.
 * - `none`: no valid answer: no bar, and not a share of 0.
 */
export type EngineOutcome =
  | { engineCode: EngineCode; state: 'ok'; answers: number; prompts: number; shares: OutcomeShare[] }
  | { engineCode: EngineCode; state: 'insufficient'; answers: number }
  | { engineCode: EngineCode; state: 'none' };

/** The outcome mix of each engine in `asked`, in that order. Engines are never pooled. */
export function outcomeMix(prompts: readonly PromptSummaryRow[], asked: readonly EngineCode[]): EngineOutcome[] {
  return asked.map((engineCode): EngineOutcome => {
    const figures = outcomeFigures(prompts, engineCode);
    // The four outcomes of an answer are exhaustive, so they share one denominator: any of them judges the state
    const { state, answers, prompts: counted } = figures.mentioned_and_cited;
    if (state === 'none') return { engineCode, state };
    if (state === 'insufficient') return { engineCode, state, answers };
    const shares = OUTCOME_PARTS.map((part): OutcomeShare => {
      const { value, successes } = figures[part];
      // `ok` has a value and a count on every part; a part that lacks one would be a bar drawn from nothing
      if (value === null || successes === null) throw new Error(`The ${part} outcome of ${engineCode} has no count`);
      return { part, share: value, k: successes };
    });
    return { engineCode, state, answers, prompts: counted, shares };
  });
}
