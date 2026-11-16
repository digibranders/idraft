import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The choices of the Group select (preview commit 6f3e4a9c): All groups, then every topic of the project's topic
 * vocabularies as one flat list, in the tree's order, with no parent rows or notes. A topic below another is named by
 * its path, so two topics of one name differ.
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
 * The choice a topic id stands for. A topic the tree does not hold (deleted, or in a link from another project) is
 * named `unknownLabel`, never by its id: the id says nothing to a person, and choosing All groups is one click away.
 * While the trees are still loading the caller shows a placeholder instead and does not ask.
 */
export function chosenGroup(choices: readonly GroupChoice[], termId: string | null, unknownLabel: string): GroupChoice {
  const found = choices.find((choice) => choice.termId === termId);
  if (found !== undefined) return found;
  return termId === null ? (choices[0] ?? { termId: null, label: '' }) : { termId, label: unknownLabel };
}
