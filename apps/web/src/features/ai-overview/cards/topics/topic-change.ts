import type { TopicNode } from './model-types';
import type { EngineSummary, PromptSummaryRow } from '@/lib/api/types';
import { engineChangeOf, type RateChange } from '@/lib/compare/change-model';
import type { CellMetric } from '@/lib/rates/rate-model';

/**
 * The join of the Overview's two windows (plan section 2.5). The change functions of WP-19 read a cell's `previous`;
 * the Overview reads the previous window as a response of its own, so the cells of the window before are laid onto
 * the current cells as their `previous` and the exact arithmetic of the Topics tab applies.
 */

/**
 * The current cells with `previous` set to the cells of the same engine in `before`. An engine that `before` does not
 * have gets none (no data is not a rate of 0); with no `before` at all the cells are returned as they are.
 */
export function attachPrevious(
  now: readonly EngineSummary[],
  before: readonly EngineSummary[] | undefined,
): EngineSummary[] {
  if (before === undefined) return [...now];
  return now.map((cells) => {
    const earlier = before.find((entry) => entry.engine_code === cells.engine_code);
    return {
      ...cells,
      previous:
        earlier === undefined
          ? null
          : {
              mentioned: earlier.mentioned,
              cited: earlier.cited,
              share_of_voice: earlier.share_of_voice,
              outcomes: earlier.outcomes,
            },
    };
  });
}

/**
 * How one engine of a topic moved from the window before to the current one; `null` when the topic is not in the
 * window before, or either side has no rate to show (under 4 valid answers, or none): a move from or to a rate
 * that is not there is never drawn as 0.
 */
export function topicChange(
  node: TopicNode,
  before: TopicNode | undefined,
  code: string,
  metric: CellMetric,
): RateChange | null {
  if (before === undefined) return null;
  return engineChangeOf(attachPrevious(node.engines, before.engines), code, metric);
}

/**
 * How many prompts are in both windows and how many are in the current one ("15 of 17 prompts in both windows");
 * `null` when either window's prompt rows are not there.
 */
export function commonPrompts(
  now: readonly PromptSummaryRow[] | null,
  before: readonly PromptSummaryRow[] | null,
): { both: number; now: number } | null {
  if (now === null || before === null) return null;
  const earlier = new Set(before.map((prompt) => prompt.prompt_id));
  return { both: now.filter((prompt) => earlier.has(prompt.prompt_id)).length, now: now.length };
}
