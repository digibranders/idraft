/**
 * The selection of the Prompts page (parity spec G26, G47). What is chosen is a set of prompt ids, as Rankings' By
 * group view chooses keywords: a prompt row is its prompt, and a group row on the Groups tab stands for the prompts
 * the group holds (a prompt in several groups is one prompt, so groups that share it show it chosen together). Each
 * row is drawn from that set, so the same choice reads right whichever rows are open, sorted or searched.
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

/**
 * What the chosen prompts were chosen from: the choice is dropped for good when this changes (the project, the tab,
 * the topic filter, the country, the Branded filter), as Rankings drops its choice when its filters change. A sort,
 * a search and opening topics change none of it.
 */
export const selectionKeyOf = (scope: {
  projectId: string;
  tab: string;
  country: string | null;
  topicIds: readonly string[];
  includeBranded: boolean;
  /** The Branded filter is `Only`: the branded prompts alone, which is another choice from `Included`. */
  brandedOnly: boolean;
}): string =>
  JSON.stringify([
    scope.projectId,
    scope.tab,
    scope.country,
    [...scope.topicIds].sort(),
    scope.includeBranded,
    scope.brandedOnly,
  ]);

/** The prompts behind the rows, each once, in the order of the rows. */
export const promptIdsOf = (rowIds: readonly string[], rows: RowPrompts): string[] => [
  ...new Set(rowIds.flatMap((rowId) => rows.get(rowId) ?? [])),
];

/**
 * The groups a choice counts: those with a prompt whose prompts are all chosen. `groups` holds the prompt ids of each
 * group. A prompt in two groups is chosen for both, so a group whose prompts another group holds is counted with it.
 */
export function groupsChosen(groups: readonly (readonly string[])[], chosen: ReadonlySet<string>): number {
  return groups.filter((ids) => ids.length > 0 && ids.every((id) => chosen.has(id))).length;
}
