import type { PromptSummaryRow } from '@/lib/api/types';
import { validAnswers } from '@/lib/rates/rate-model';
import { equalWeightAverage, MIN_OBSERVATIONS } from '@/lib/stats';

/** The most prompts the card lists. */
export const MAX_UNLINKED = 6;

/** One platform's own count for a prompt: `k` of its `n` valid answers mention the brand and cite none of its pages. */
export interface PlatformCount {
  code: string;
  k: number;
  n: number;
}

export interface UnlinkedPrompt {
  id: string;
  text: string;
  /** The equal-weight average of the rates of the platforms in `counts`, 0 to 1: what the list is ranked on. */
  rate: number;
  /** The platforms that have a rate for this prompt (at least 4 valid answers), each with its own counts. */
  counts: PlatformCount[];
  /** The platforms in scope that answered this prompt with too few valid answers: no rate, left out of the average. */
  leftOut: string[];
}

/**
 * The prompts that mention the brand without citing it (OV-CIT-06), ranked per platform: each platform's rate is its
 * "mentioned only" answers over its own valid answers, and the prompt is ranked on the equal-weight average of the
 * platforms that have one (R3: no rate comes from counts pooled across platforms). A platform with fewer than
 * `MIN_OBSERVATIONS` valid answers for the prompt has no rate, takes no part in the average and is named in `leftOut`.
 * A prompt is listed when at least one platform has a rate and the average is above 0; ties go to the prompt with
 * more valid answers on its platforms, then A to Z. With one platform in scope this is that platform's own rate.
 */
export function unlinkedPrompts(
  prompts: readonly PromptSummaryRow[],
  codes: readonly string[],
  limit: number = MAX_UNLINKED,
): UnlinkedPrompt[] {
  return prompts
    .flatMap((prompt): { entry: UnlinkedPrompt; answers: number }[] => {
      const cells = prompt.engines.filter((engine) => codes.includes(engine.engine_code));
      const counts = cells.flatMap((engine): PlatformCount[] => {
        const n = validAnswers(engine.mentioned);
        return n >= MIN_OBSERVATIONS
          ? [{ code: engine.engine_code, k: engine.outcomes.mentioned_only.numerator, n }]
          : [];
      });
      const { value } = equalWeightAverage(counts.map((count) => count.k / count.n));
      if (value === null || value <= 0) return [];
      const rated = new Set(counts.map((count) => count.code));
      const leftOut = cells.map((engine) => engine.engine_code).filter((code) => !rated.has(code));
      const answers = counts.reduce((total, count) => total + count.n, 0);
      return [{ entry: { id: prompt.prompt_id, text: prompt.text, rate: value, counts, leftOut }, answers }];
    })
    .sort((a, b) => b.entry.rate - a.entry.rate || b.answers - a.answers || a.entry.text.localeCompare(b.entry.text))
    .map(({ entry }) => entry)
    .slice(0, limit);
}
