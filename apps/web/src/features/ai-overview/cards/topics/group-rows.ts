import type { TopicNode } from './model-types';
import { groupsOf } from './topic-nodes';
import { topicEngineRows, type TopicEngineRow } from './topic-rows';
import type { ScopeMetric } from '../../scope/scope-model';
import type { EngineSummary, PromptSummaryRow } from '@/lib/api/types';
import type { CellMetric } from '@/lib/rates/rate-model';
import { visibilityCell } from '@/lib/rates/visibility-model';

/**
 * The rows of the groups cards (preview commit 6f3e4a9c: one flat level of groups, no parent rows). A group is a topic
 * with no topic below it that has a row; the topics above are not rows of their own. Plain data: the cards give the
 * words. The measure is the page's `metric` key.
 */

/** The cell of an engine summary each measure reads. Visibility is read from the outcome cells (see `forMeasure`). */
export const CELL_OF_MEASURE: Readonly<Record<ScopeMetric, CellMetric>> = {
  visibility: 'mentioned',
  mention: 'mentioned',
  citation: 'cited',
  sov: 'share_of_voice',
};

/** A rate is a count of answers unless the measure is share of voice, which counts the answers that name a brand. */
export const isCountedMeasure = (measure: ScopeMetric): boolean => measure !== 'sov';

/**
 * The engines' cells as `CELL_OF_MEASURE[measure]` reads them. Visibility is the sum of the three outcome cells that
 * are not "neither" (`visibilityCell`), put where the mention cell is, so every rate function of the topics cards
 * (value, average, state) reads it as it reads a mention rate, with the counts of the same answers.
 */
export const forMeasure = (engines: readonly EngineSummary[], measure: ScopeMetric): readonly EngineSummary[] =>
  measure === 'visibility'
    ? engines.map((engine) => ({ ...engine, mentioned: visibilityCell(engine.outcomes) }))
    : engines;

/** The groups of the nodes, in the order of the vocabulary tree, each with its value on every platform and their average. */
export function groupRows(
  nodes: readonly TopicNode[],
  codes: readonly string[],
  measure: ScopeMetric,
): TopicEngineRow[] {
  const groups = groupsOf(nodes).map((node) => ({ ...node, engines: forMeasure(node.engines, measure) }));
  return topicEngineRows(groups, codes, CELL_OF_MEASURE[measure]);
}

/**
 * How many prompts of the groups are in more than one group, and how many are in none that is a row (no group, or only
 * a group that has groups below it). `null` while the prompt rows are not read. A prompt in two groups counts in both,
 * which is why the rows need not add up to the total.
 */
export function groupCoverage(
  prompts: readonly PromptSummaryRow[],
  nodes: readonly TopicNode[],
): { overlapping: number; outside: number } {
  const held = new Map<string, number>();
  for (const node of groupsOf(nodes)) {
    for (const member of node.members ?? []) held.set(member.prompt_id, (held.get(member.prompt_id) ?? 0) + 1);
  }
  const counts = prompts.map((prompt) => held.get(prompt.prompt_id) ?? 0);
  return {
    overlapping: counts.filter((count) => count > 1).length,
    outside: counts.filter((count) => count === 0).length,
  };
}
