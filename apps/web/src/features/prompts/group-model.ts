import { mostMentionedFirst, topicMembers, topicRowKept, type TopicDescendants } from './prompt-model';
import { buildTopicTree, groupsOf } from './topic-tree';
import type { EngineSummary, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The rows of the Groups tab as plain data (PR-TOPICS-01, 06, 09): one flat level of groups, each with the prompts it
 * holds. The numbers of a group are the API's topic row (prompt weighted per platform, `engines`), never a stored copy.
 */

/** A group of the Groups tab. */
export interface Group {
  /** The term id. */
  key: string;
  name: string;
  /** The API's count of the prompts the group holds. */
  promptCount: number;
  engines: readonly EngineSummary[];
  /** Its prompts, most mentioned first over the platforms in view; `null` while the trees do not hold the group. */
  members: readonly PromptSummaryRow[] | null;
}

export interface GroupsOfSummary {
  summary: { topics: readonly TopicSummaryRow[]; prompts: readonly PromptSummaryRow[] };
  /** The terms of the topic vocabularies' trees: which topic sits under which, so only the groups are rows. */
  tree: readonly NamedTerm[];
  descendants: TopicDescendants;
  /** With `filtering`, the topics the group filter keeps: the chosen ones and those below them. */
  kept: ReadonlySet<string>;
  filtering: boolean;
  /** The platforms in view: the order of a group's prompts follows their mention rates. */
  codes: readonly string[];
}

/**
 * The groups of the summary, in the order of the tree: the topics with a prompt that have no topic with a prompt
 * below them (`groupsOf`), narrowed to the group filter. A prompt in two groups is in both and a prompt given only a
 * parent that has groups below is in none, so the rows may overlap and may not hold every prompt (`groupCoverage`).
 */
export function groupsOfSummary({ summary, tree, descendants, kept, filtering, codes }: GroupsOfSummary): Group[] {
  const branches = buildTopicTree(summary.topics, tree, (termId) => !filtering || topicRowKept(termId, kept));
  return groupsOf(branches).flatMap((row): Group[] => {
    if (row.term_id === null) return [];
    const members = topicMembers(row.term_id, summary.prompts, descendants);
    return [
      {
        key: row.term_id,
        name: row.name ?? '',
        promptCount: row.prompt_count,
        engines: row.engines,
        members: members === null ? null : mostMentionedFirst(members, codes),
      },
    ];
  });
}

/** A group the search keeps, with the prompts it then lists. */
export interface FoundGroup {
  group: Group;
  listed: readonly PromptSummaryRow[];
}

/**
 * The groups the search keeps (case-insensitive substring of the trimmed text). A group whose name matches keeps all of
 * its prompts; otherwise it stays with only the prompts whose text matches; the others are hidden. A group whose
 * prompts cannot be told yet (`members` null) stays only when its name matches.
 */
export function searchGroups(groups: readonly Group[], search: string, locale: string): FoundGroup[] {
  const query = search.trim().toLocaleLowerCase(locale);
  return groups.flatMap((group): FoundGroup[] => {
    const members = group.members ?? [];
    if (query === '' || group.name.toLocaleLowerCase(locale).includes(query)) return [{ group, listed: members }];
    const listed = members.filter((member) => member.text.toLocaleLowerCase(locale).includes(query));
    return listed.length === 0 ? [] : [{ group, listed }];
  });
}

/**
 * How many of the prompts in scope are in more than one group, and how many are in none: the rows may overlap, so they
 * do not add up to the prompts in view. The prompts without a group count as outside.
 */
export function groupCoverage(
  prompts: readonly Pick<PromptSummaryRow, 'prompt_id'>[],
  groups: readonly Pick<Group, 'members'>[],
): { overlapping: number; outside: number } {
  const held = new Map<string, number>();
  for (const group of groups) {
    for (const member of group.members ?? []) held.set(member.prompt_id, (held.get(member.prompt_id) ?? 0) + 1);
  }
  const counts = prompts.map((prompt) => held.get(prompt.prompt_id) ?? 0);
  return {
    overlapping: counts.filter((count) => count > 1).length,
    outside: counts.filter((count) => count === 0).length,
  };
}

/** The distinct prompt ids the listed groups hold, each once: the footer's prompt count. */
export const distinctPrompts = (found: readonly FoundGroup[]): number =>
  new Set(found.flatMap(({ listed }) => listed.map((member) => member.prompt_id))).size;
