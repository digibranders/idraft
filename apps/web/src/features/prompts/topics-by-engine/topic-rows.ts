import { groupsOfSummary, searchGroups } from '@/features/prompts/group-model';
import type { TopicDescendants } from '@/features/prompts/prompt-model';
import type { EngineSummary, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The groups of the page as plain heads, for the heat map, the By platform export and the phone list: one flat level
 * (`groupsOf`, the rule of the Groups table and of the Overview's group cards), each with its platform cells, in the
 * order of the tree. The same rows the Groups table draws.
 */
export interface TopicHead {
  /** The term id. */
  key: string;
  name: string;
  promptCount: number;
  engines: readonly EngineSummary[];
  /** The prompts the group holds; `null` when the trees do not hold the group yet, so its prompts cannot be told. */
  members: readonly PromptSummaryRow[] | null;
}

export interface TopicHeadsArgs {
  /** The topic and prompt rows of the summary; `undefined` while it loads. */
  summary: { topics: readonly TopicSummaryRow[]; prompts: readonly PromptSummaryRow[] } | undefined;
  tree: readonly NamedTerm[];
  descendants: TopicDescendants;
  /** With `filtering`, the topics the filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  filtering: boolean;
  /** Finds a group by its name or by the text of one of its prompts; `null` or empty narrows nothing. */
  search: string | null;
  locale: string;
}

export function topicHeads({
  summary,
  tree,
  descendants,
  kept,
  filtering,
  search,
  locale,
}: TopicHeadsArgs): TopicHead[] {
  if (summary === undefined) return [];
  const groups = groupsOfSummary({ summary, tree, descendants, kept, filtering, codes: [] });
  return searchGroups(groups, search ?? '', locale).map(({ group }) => ({
    key: group.key,
    name: group.name,
    promptCount: group.promptCount,
    engines: group.engines,
    members: group.members,
  }));
}
