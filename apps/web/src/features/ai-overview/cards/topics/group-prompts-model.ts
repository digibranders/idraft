import { forMeasure } from './group-rows';
import type { PromptSummaryRow } from '@/lib/api/types';
import { averageRate, sortByKeys, type AverageRate } from '@/lib/rates/rate-model';

/**
 * The prompts of the chosen group (OV-GRP-09): each with its visibility, mention and citation rate, every one the equal
 * weight average of the platforms in scope that show a rate for the prompt (never the answers of two platforms pooled,
 * R3). A prompt none of whose platforms has 4 valid answers has no rate and is not listed. Plain data.
 */

export interface GroupPrompt {
  prompt: PromptSummaryRow;
  visibility: AverageRate;
  mention: AverageRate;
  citation: AverageRate;
}

/** The most prompts the card lists. */
export const MAX_GROUP_PROMPTS = 15;

export interface GroupPromptList {
  /** Every prompt with a rate, by mention rate, highest first. */
  ranked: GroupPrompt[];
  /** The prompts shown: the first `MAX_GROUP_PROMPTS`. */
  listed: GroupPrompt[];
  /** Prompts with no rate (too few valid answers on every platform in scope), counted and never listed. */
  left: number;
}

export function groupPrompts(prompts: readonly PromptSummaryRow[], codes: readonly string[]): GroupPromptList {
  const all = prompts.map((prompt): GroupPrompt => {
    const engines = forMeasure(prompt.engines, 'visibility');
    const cell = (metric: 'mentioned' | 'cited'): AverageRate =>
      averageRate(codes.map((code) => prompt.engines.find((cells) => cells.engine_code === code)?.[metric]));
    return {
      prompt,
      visibility: averageRate(codes.map((code) => engines.find((cells) => cells.engine_code === code)?.mentioned)),
      mention: cell('mentioned'),
      citation: cell('cited'),
    };
  });
  const rated = all.filter((row) => row.mention.state === 'ok');
  const ranked = sortByKeys(
    rated,
    [{ id: 'mention', desc: true }],
    (row) => row.mention.value,
    (row) => row.prompt.text,
  );
  return { ranked, listed: ranked.slice(0, MAX_GROUP_PROMPTS), left: all.length - rated.length };
}
