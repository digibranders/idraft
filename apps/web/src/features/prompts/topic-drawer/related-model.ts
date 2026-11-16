import { groupsOfSummary } from '@/features/prompts/group-model';
import type { TopicDescendants } from '@/features/prompts/prompt-model';
import type { MetricCell, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';
import { averageRate, hasRate, type AverageRate } from '@/lib/rates/rate-model';

/**
 * The groups beside a group (PR-DRAWER-14): there are no parent groups, so the Related card lists the other groups
 * of the scope, the ones with most prompts first.
 */

/** The most groups the Related tab lists. */
export const MAX_RELATED = 5;

export interface Sibling {
  key: string;
  name: string;
  promptCount: number;
  /** The equal weight average of the platforms' Mentioned rates; `state` says when there is none. */
  mention: AverageRate;
  /** The Mentioned cell of each platform that shows a rate and so takes part in the average, in the order of the platforms. */
  counting: { code: string; cell: MetricCell }[];
}

/**
 * The groups other than `key` that the summary has, most prompts first (a tie by name), at most `MAX_RELATED`. `null`
 * while the summary is not read.
 */
export function otherGroups(
  key: string,
  summary: { topics: readonly TopicSummaryRow[]; prompts: readonly PromptSummaryRow[] } | undefined,
  tree: readonly NamedTerm[],
  descendants: TopicDescendants,
  codes: readonly string[],
): Sibling[] | null {
  if (summary === undefined) return null;
  return groupsOfSummary({ summary, tree, descendants, kept: new Set(), filtering: false, codes: [] })
    .filter((group) => group.key !== key)
    .map((group): Sibling => {
      const cells = codes.map((code) => ({
        code,
        cell: group.engines.find((engine) => engine.engine_code === code)?.mentioned,
      }));
      return {
        key: group.key,
        name: group.name,
        promptCount: group.promptCount,
        mention: averageRate(cells.map((entry) => entry.cell)),
        counting: cells.flatMap(({ code, cell }) => (cell !== undefined && hasRate(cell) ? [{ code, cell }] : [])),
      };
    })
    .sort((a, b) => b.promptCount - a.promptCount || a.name.localeCompare(b.name))
    .slice(0, MAX_RELATED);
}
