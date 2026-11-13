import { engineValue, type EngineValue } from './engine-values';
import type { PromptSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { averageRate, type AverageRate, type CellMetric } from '@/lib/rates/rate-model';

/** What a prompt is, engine by engine: its own cell per asked engine and the average over those with a rate. */
export interface PromptEngineRow {
  prompt: PromptSummaryRow;
  /** One per asked engine, in the order of `codes`. A prompt's cell has whole counts and weights no prompts. */
  values: EngineValue[];
  /** Over the engines with a rate only; `engines` says how many took part. */
  average: AverageRate;
  lastValidAt: string | null;
  /** The place of the prompt's first topic the tree holds ("SEO / Technical SEO"); `null` when it has none or the tree does not. */
  path: string | null;
}

export function promptEngineRows(
  prompts: readonly PromptSummaryRow[],
  codes: readonly string[],
  metric: CellMetric,
  tree: readonly NamedTerm[],
): PromptEngineRow[] {
  const pathOf = new Map(tree.map((term) => [term.termId, term.path]));
  return prompts.map((prompt) => ({
    prompt,
    values: codes.map((code) => engineValue(prompt.engines, code, metric)),
    average: averageRate(codes.map((code) => prompt.engines.find((cells) => cells.engine_code === code)?.[metric])),
    lastValidAt: prompt.last_valid_at,
    path: prompt.topic_term_ids.map((id) => pathOf.get(id)).find((path) => path !== undefined) ?? null,
  }));
}
