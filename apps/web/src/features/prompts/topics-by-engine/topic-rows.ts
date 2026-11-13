import { NO_TOPIC, topicMembers, topicRowKept, type TopicDescendants } from '@/features/prompts/prompt-model';
import { buildTopicTree } from '@/features/prompts/topic-tree';
import type { EngineSummary, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The topic tree of the page as plain heads, for the heat map, the By engine export and the phone list (WB-TPE-07, 16
 * and 17): a top level topic with the topics listed under it, each with its engine cells. The same rows the Topics table
 * draws (`TopicsTable` builds its own, for its own purposes), in the order the API gave them, "No topic" last.
 */
export interface TopicHead {
  /** The term id, or `__none` for the prompts without a topic. */
  key: string;
  name: string;
  /** The names from the top level topic to this one, joined by " / ": "SEO / Technical SEO". */
  path: string;
  /** The name of the topic above it; `null` for a top level topic. */
  parent: string | null;
  promptCount: number;
  engines: readonly EngineSummary[];
  /** The prompts the topic holds; `null` when the trees do not hold the topic yet, so its prompts cannot be told. */
  members: readonly PromptSummaryRow[] | null;
  /** The topics listed under it; a topic below the second level is in its second level topic (see `topic-tree.ts`). */
  children: TopicHead[];
}

export interface TopicHeadsArgs {
  /** The topic and prompt rows of the summary; `undefined` while it loads. */
  summary: { topics: readonly TopicSummaryRow[]; prompts: readonly PromptSummaryRow[] } | undefined;
  tree: readonly NamedTerm[];
  descendants: TopicDescendants;
  /** With `filtering`, the topics the filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  filtering: boolean;
  /** Finds a topic by its name or by the text of one of its prompts; `null` or empty narrows nothing. */
  search: string | null;
  locale: string;
  /** The name of the row of the prompts without a topic. */
  noTopicName: string;
}

export function topicHeads({
  summary,
  tree,
  descendants,
  kept,
  filtering,
  search,
  locale,
  noTopicName,
}: TopicHeadsArgs): TopicHead[] {
  if (summary === undefined) return [];
  const query = (search ?? '').trim().toLocaleLowerCase(locale);
  const headOf = (topic: TopicSummaryRow, parent: TopicHead | null): TopicHead => {
    const name = topic.name ?? noTopicName;
    return {
      key: topic.term_id ?? NO_TOPIC,
      name,
      path: parent === null ? name : `${parent.path} / ${name}`,
      parent: parent === null ? null : parent.name,
      promptCount: topic.prompt_count,
      engines: topic.engines,
      members: topicMembers(topic.term_id, summary.prompts, descendants),
      children: [],
    };
  };
  const nameMatches = (head: TopicHead): boolean => head.name.toLocaleLowerCase(locale).includes(query);
  const matches = (head: TopicHead): boolean =>
    query === '' ||
    nameMatches(head) ||
    (head.members ?? []).some((member) => member.text.toLocaleLowerCase(locale).includes(query));
  const heads = buildTopicTree(summary.topics, tree, (termId) => !filtering || topicRowKept(termId, kept)).flatMap(
    ({ row, children }): TopicHead[] => {
      const parent = headOf(row, null);
      const below = children.map((child) => headOf(child, parent));
      // A topic below is found by its own name even when the parent's is not: the parent stays to hold it
      if (!matches(parent) && !below.some(nameMatches)) return [];
      // A parent found by its own name keeps all of its topics; otherwise those the search finds
      return [{ ...parent, children: nameMatches(parent) ? below : below.filter(matches) }];
    },
  );
  // The prompts without a topic are no topic: they come after every one
  return [...heads.filter((head) => head.key !== NO_TOPIC), ...heads.filter((head) => head.key === NO_TOPIC)];
}
