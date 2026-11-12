import type { NamedTerm } from '@/lib/keywords/taxonomy-reads';

/**
 * The Topics tab as a tree of two levels (parity spec D-3): a top level topic and the topics directly under it.
 * The API sends a row for every topic that has prompts and for every topic above one, each rolled up over the
 * topics below it, so a row is read as given and a topic is listed once: under its parent when the parent has a
 * row, at the top level otherwise. A topic below the second level has no row of its own; its prompts and numbers
 * are in its second level topic already.
 */

/** A top level topic and the topics directly under it. */
export interface TopicBranch<T> {
  row: T;
  children: T[];
}

/** The topic rows, a child once as well as its parent: the count the footer gives. */
export const countTopicRows = (branches: readonly TopicBranch<unknown>[]): number =>
  branches.reduce((sum, branch) => sum + 1 + branch.children.length, 0);

/**
 * The summary's topic rows as a two level tree, in the order given. `tree` is the vocabularies' topic terms; a
 * row whose topic it does not hold (not read yet, or the row of no topic) is a top level row. `keep` tells which
 * rows a topic filter leaves (the chosen topics and those below them); a kept row below the second level stands
 * for its second level topic, and a child whose parent is not kept is shown at the top level, so a filter never
 * leaves an empty table.
 */
export function buildTopicTree<T extends { term_id: string | null }>(
  rows: readonly T[],
  tree: readonly NamedTerm[],
  keep: (termId: string | null) => boolean = () => true,
): TopicBranch<T>[] {
  const parents = new Map(tree.map((term) => [term.termId, term.parentId]));
  /** The topic and the topics above it, the top one first; `null` when the trees do not hold the topic. */
  const chainOf = (termId: string): string[] | null => {
    if (!parents.has(termId)) return null;
    const chain: string[] = [];
    for (
      let at: string | null | undefined = termId;
      at !== null && at !== undefined && !chain.includes(at);
      at = parents.get(at)
    ) {
      chain.unshift(at);
    }
    return chain;
  };
  const rowOf = new Map<string, T>();
  for (const row of rows) if (row.term_id !== null) rowOf.set(row.term_id, row);
  // The rows shown, each once, with the topic above them: a row below the second level shows as its second level topic
  const shown = new Map<T, string[] | null>();
  for (const row of rows) {
    if (!keep(row.term_id)) continue;
    const chain = row.term_id === null ? null : chainOf(row.term_id);
    if (chain === null || chain.length <= 2) {
      shown.set(row, chain);
      continue;
    }
    const second = rowOf.get(chain[1] ?? '');
    if (second !== undefined) shown.set(second, chain.slice(0, 2));
  }
  // A child goes under its parent when the parent is shown; otherwise it stands at the top level
  const placed = [...shown].map(([row, chain]) => {
    const parent = chain?.length === 2 ? rowOf.get(chain[0] ?? '') : undefined;
    return { row, parent: parent !== undefined && shown.has(parent) ? parent : undefined };
  });
  const branches = new Map<T, TopicBranch<T>>(
    placed.filter(({ parent }) => parent === undefined).map(({ row }) => [row, { row, children: [] }]),
  );
  for (const { row, parent } of placed) if (parent !== undefined) branches.get(parent)?.children.push(row);
  return [...branches.values()];
}

/** The tree in the order `order` gives the rows of a level: the top level among itself, each topic's children among theirs. */
export function sortTopicTree<T>(
  branches: readonly TopicBranch<T>[],
  order: (rows: readonly T[]) => T[],
): TopicBranch<T>[] {
  const byRow = new Map(branches.map((branch) => [branch.row, branch]));
  return order(branches.map((branch) => branch.row)).flatMap((row) => {
    const branch = byRow.get(row);
    return branch === undefined ? [] : [{ row, children: order(branch.children) }];
  });
}
