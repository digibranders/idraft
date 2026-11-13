import { engineValue } from '@/features/prompts/topics-by-engine/engine-values';
import type { PromptSummaryRow } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';

/**
 * The prompts behind one engine of a topic (WB-TPE-12): those the engine has answered at all (an answer counts here
 * whether or not it was valid, so a prompt whose answers were all refused is still listed, with no rate), ordered by the
 * chosen metric on that engine, high to low. A prompt without a rate (too few valid answers, or none) comes after every one
 * that has one, and a tie goes to the text. The list given is not changed.
 */
export function promptsBehindCell(
  prompts: readonly PromptSummaryRow[],
  engineCode: string,
  metric: CellMetric,
): PromptSummaryRow[] {
  const ranked = prompts
    .filter(
      (prompt) => (prompt.engines.find((cells) => cells.engine_code === engineCode)?.mentioned.n_observations ?? 0) > 0,
    )
    .map((prompt) => ({ prompt, rate: engineValue(prompt.engines, engineCode, metric).value }));
  ranked.sort((a, b) => {
    if (a.rate !== null && b.rate !== null && a.rate !== b.rate) return b.rate - a.rate;
    if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
    return a.prompt.text.localeCompare(b.prompt.text);
  });
  return ranked.map(({ prompt }) => prompt);
}
