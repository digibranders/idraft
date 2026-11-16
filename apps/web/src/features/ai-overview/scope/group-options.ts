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
 * The choice a topic id stands for. A topic the tree does not hold (a link's topic while the trees load, or one that
 * was deleted) has no name to show yet, so it reads as All groups on the button and is kept in the address.
 */
export function chosenGroup(choices: readonly GroupChoice[], termId: string | null): GroupChoice {
  const all = choices[0] ?? { termId: null, label: '' };
  return choices.find((choice) => choice.termId === termId) ?? all;
}
