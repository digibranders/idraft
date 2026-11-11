/** The two views of the Keywords page: one row per group, or one row per keyword. */
export type KeywordsView = 'groups' | 'flat';

/** The columns a group row has no figure for: the sums and counts stop at what a total can say. */
export const HIDDEN_IN_GROUPS: readonly string[] = [
  'serp_features',
  'keyword_difficulty',
  'intent',
  'trend',
  'tags',
  'group',
];

const COMPETITOR_PREFIX = 'competitor_';

/** Whether By group leaves a column out. */
export const hiddenInGroups = (id: string): boolean =>
  HIDDEN_IN_GROUPS.includes(id) || id.startsWith(COMPETITOR_PREFIX);

/** The columns the table offers in a view, in their order. */
export function columnsForView(allIds: readonly string[], view: KeywordsView): string[] {
  return view === 'groups' ? allIds.filter((id) => !hiddenInGroups(id)) : [...allIds];
}

/**
 * The explicit column list the table is given in a view. `null` stays `null`: the table then shows the
 * defaults of the columns it was given, which are the view's own.
 */
export function visibleForView(urlCols: readonly string[] | null, view: KeywordsView): string[] | null {
  if (urlCols === null) return null;
  return view === 'groups' ? urlCols.filter((id) => !hiddenInGroups(id)) : [...urlCols];
}

/**
 * The list to keep in the URL when the person edits the column chooser. In By group the chooser cannot show
 * the columns that view hides, so they are carried over from what the flat view had (`flatDefaults` when the
 * URL named none), each next to the column that preceded it: editing columns there does not lose KD, Intent,
 * SERP features, Trend, Tags or a competitor in the flat view. A reset (`null`) resets both.
 */
export function mergeHidden(
  urlCols: readonly string[] | null,
  next: readonly string[] | null,
  flatDefaults: readonly string[],
  view: KeywordsView,
): string[] | null {
  if (next === null) return null;
  if (view === 'flat') return [...next];
  const previous = urlCols ?? flatDefaults;
  const merged = [...next];
  previous.forEach((id, index) => {
    if (!hiddenInGroups(id) || merged.includes(id)) return;
    const anchor = previous
      .slice(0, index)
      .reverse()
      .find((before) => merged.includes(before));
    merged.splice(anchor === undefined ? 1 : merged.indexOf(anchor) + 1, 0, id);
  });
  return merged;
}
