import type { TopicSummaryRow } from '@/lib/api/types';
import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The choices of the Group select (preview commit 6f3e4a9c): All groups, then one flat list of groups (`groupTerms`),
 * in the tree's order, with no parent rows or notes. A topic below another is named by its path, so two topics of one
 * name differ. `groupChoices` of the whole tree names whatever a link chose, a topic above a group included.
 */

/** One row of the Group select. `termId` is `null` for All groups. */
export interface GroupChoice {
  termId: string | null;
  label: string;
}

export function groupChoices(tree: readonly NamedTerm[], allLabel: string): GroupChoice[] {
  return [
    { termId: null, label: allLabel },
    ...tree.map((term) => ({
      termId: term.termId,
      label: term.parentId === null ? term.name : term.path,
    })),
  ];
}

/**
 * The groups of the project: the topics that hold a prompt and have no topic with a prompt below them, in the tree's
 * order (the rule of the group cards, `groupsOf`). A topic with no prompt is not offered (choosing it would leave
 * the page empty), and a topic above a group is not a group of its own. The rows of the topic read roll a prompt up
 * to every topic above it, so a topic is above a group exactly when it is the parent of a topic that holds one.
 */
export function groupTerms(
  tree: readonly NamedTerm[],
  topics: readonly Pick<TopicSummaryRow, 'term_id' | 'prompt_count'>[],
): NamedTerm[] {
  const holding = new Set(topics.flatMap((row) => (row.term_id !== null && row.prompt_count > 0 ? [row.term_id] : [])));
  const above = new Set(
    tree.flatMap((term) => (holding.has(term.termId) && term.parentId !== null ? [term.parentId] : [])),
  );
  return tree.filter((term) => holding.has(term.termId) && !above.has(term.termId));
}

/**
 * The choice a topic id stands for. A topic the tree does not hold (deleted, or in a link from another project) is
 * named `unknownLabel`, never by its id: the id says nothing to a person, and choosing All groups is one click away.
 * While the trees are still loading the caller shows a placeholder instead and does not ask.
 */
export function chosenGroup(choices: readonly GroupChoice[], termId: string | null, unknownLabel: string): GroupChoice {
  const found = choices.find((choice) => choice.termId === termId);
  if (found !== undefined) return found;
  return termId === null ? (choices[0] ?? { termId: null, label: '' }) : { termId, label: unknownLabel };
}
