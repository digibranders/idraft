/**
 * The selection of Topics & Prompts (parity spec G26, G47). What is chosen is a set of prompt ids, as Rankings' By
 * group view chooses keywords: a prompt row is its prompt, and a topic row stands for the prompts the topic holds
 * (a parent's include those of its topics below; a prompt under several topics is one prompt). Each row is drawn
 * from that set, so the same choice reads right whichever rows are open, sorted or searched.
 */

/** The prompt ids each row of the table stands for, by row id; a row without prompts has an empty list. */
export type RowPrompts = ReadonlyMap<string, readonly string[]>;

export interface RowSelection {
  /** The rows whose prompts are all chosen. */
  selectedIds: Set<string>;
  /** The rows with some of their prompts chosen. */
  indeterminateIds: Set<string>;
}

/** The rows a choice selects, and those it selects in part. A row without prompts is never selected. */
export function rowSelection(chosen: ReadonlySet<string>, rows: RowPrompts): RowSelection {
  const selectedIds = new Set<string>();
  const indeterminateIds = new Set<string>();
  for (const [rowId, ids] of rows) {
    const count = ids.filter((id) => chosen.has(id)).length;
    if (count === 0) continue;
    (count === ids.length ? selectedIds : indeterminateIds).add(rowId);
  }
  return { selectedIds, indeterminateIds };
}

/**
 * The prompts chosen after the table changed its selected rows from `previous` to `next`: a row that was ticked
 * adds its prompts, one that was unticked takes them away. Prompts chosen through rows that are not in the table
 * now stay chosen.
 */
export function applyRowChange(
  chosen: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  rows: RowPrompts,
): Set<string> {
  const result = new Set(chosen);
  for (const rowId of next) if (!previous.has(rowId)) for (const id of rows.get(rowId) ?? []) result.add(id);
  for (const rowId of previous) if (!next.has(rowId)) for (const id of rows.get(rowId) ?? []) result.delete(id);
  return result;
}

/** The prompts behind the rows, each once, in the order of the rows. */
export const promptIdsOf = (rowIds: readonly string[], rows: RowPrompts): string[] => [
  ...new Set(rowIds.flatMap((rowId) => rows.get(rowId) ?? [])),
];

/** A topic with the prompts it holds and the topics listed under it. */
export interface TopicIds {
  ids: readonly string[];
  children: readonly { ids: readonly string[] }[];
}

const filled = (ids: readonly string[], chosen: ReadonlySet<string>): boolean =>
  ids.length > 0 && ids.every((id) => chosen.has(id));

/**
 * The topics a choice counts: those whose prompts are all chosen, except the topics below a parent that is itself
 * all chosen, which it stands for. Ticking a parent is one topic, however many it holds.
 */
export function topicsChosen(tree: readonly TopicIds[], chosen: ReadonlySet<string>): number {
  let count = 0;
  for (const topic of tree) {
    if (filled(topic.ids, chosen)) count += 1;
    else count += topic.children.filter((child) => filled(child.ids, chosen)).length;
  }
  return count;
}
