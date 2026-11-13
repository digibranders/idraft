import type { EngineCode, PromptSummaryRow } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

import type { Branded } from '../../scope/scope-model';

/**
 * The numbers of "Answers behind the numbers": how many prompts have enough valid answers on each engine to read a
 * rate. Pure. A prompt is counted once per engine in exactly one of three groups, so the groups add up to the
 * prompts in scope; no answer is unknown, never a miss.
 */

export interface EngineCoverage {
  engineCode: EngineCode;
  /** Prompts with `MIN_OBSERVATIONS` or more valid answers: a rate can be read. */
  enough: number;
  /** Prompts with 1 to 3 valid answers: counted, but no rate. */
  few: number;
  /** Prompts with no valid answer on the engine, or no cell for it. */
  none: number;
}

/** What the page says about branded prompts: how many it left out, or that it did not leave any out. */
export type BrandedCoverage =
  | { kind: 'leftOut'; count: number }
  /** The second read is absent or failed, so the count is not known. */
  | { kind: 'unknown' }
  | { kind: 'included' }
  | { kind: 'only' };

export interface CoverageFigures {
  /** The prompts in scope, once. */
  prompts: number;
  engines: EngineCoverage[];
  /** Prompts in no topic. */
  withoutTopic: number;
  branded: BrandedCoverage;
}

export interface CoverageInput {
  prompts: readonly PromptSummaryRow[];
  asked: readonly EngineCode[];
  branded: Branded;
  /** The prompts of the same scope with branded prompts included, once that read answered; `null` before. */
  withBranded: number | null;
}

function brandedOf({ branded, withBranded, prompts }: CoverageInput): BrandedCoverage {
  if (branded !== 'excluded') return { kind: branded };
  // Fewer prompts with branded included than without is two reads of two scopes, which is no difference
  return withBranded === null || withBranded < prompts.length
    ? { kind: 'unknown' }
    : { kind: 'leftOut', count: withBranded - prompts.length };
}

export function coverageOf(input: CoverageInput): CoverageFigures {
  const { prompts, asked } = input;
  const engines = asked.map((engineCode): EngineCoverage => {
    const valid = prompts.map(
      (prompt) => prompt.engines.find((entry) => entry.engine_code === engineCode)?.mentioned.denominator ?? 0,
    );
    const enough = valid.filter((count) => count >= MIN_OBSERVATIONS).length;
    const none = valid.filter((count) => count === 0).length;
    return { engineCode, enough, few: valid.length - enough - none, none };
  });
  return {
    prompts: prompts.length,
    engines,
    withoutTopic: prompts.filter((prompt) => prompt.topic_term_ids.length === 0).length,
    branded: brandedOf(input),
  };
}
