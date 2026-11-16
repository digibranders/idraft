import type { PromptSummaryRow } from '@/lib/api/types';
import { validAnswers } from '@/lib/rates/rate-model';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/** The most prompts the card lists. */
export const MAX_UNLINKED = 6;

export interface UnlinkedPrompt {
  id: string;
  text: string;
  /** The answers that mention the brand and cite none of its pages. */
  unlinked: number;
  /** The valid answers of the prompt on the platforms in scope. */
  answers: number;
}

/**
 * The prompts that mention the brand without citing it (OV-CIT-06): each prompt's answers on the platforms in scope,
 * counted as they are, with those that are "mentioned only" among them. A prompt needs at least `MIN_OBSERVATIONS`
 * valid answers and at least one unlinked mention to be listed; they are ranked by the share of their answers, then by
 * the answers behind it. The counts of the platforms are added as counts, never as rates (the share is the card's own
 * `unlinked` over `answers`, one denominator), and a platform with no valid answer adds none.
 */
export function unlinkedPrompts(
  prompts: readonly PromptSummaryRow[],
  codes: readonly string[],
  limit: number = MAX_UNLINKED,
): UnlinkedPrompt[] {
  return prompts
    .map((prompt): UnlinkedPrompt => {
      const engines = prompt.engines.filter((engine) => codes.includes(engine.engine_code));
      return {
        id: prompt.prompt_id,
        text: prompt.text,
        unlinked: engines.reduce((total, engine) => total + engine.outcomes.mentioned_only.numerator, 0),
        answers: engines.reduce((total, engine) => total + validAnswers(engine.mentioned), 0),
      };
    })
    .filter((entry) => entry.answers >= MIN_OBSERVATIONS && entry.unlinked > 0)
    .sort(
      (a, b) =>
        b.unlinked / b.answers - a.unlinked / a.answers || b.answers - a.answers || a.text.localeCompare(b.text),
    )
    .slice(0, limit);
}
