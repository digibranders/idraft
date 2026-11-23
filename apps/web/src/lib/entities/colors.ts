/** The colours of competitors: 1 is the own brand's (23-application-patterns.md section 5.3), and past the sixth a brand is drawn neutral. */
export const COMPETITOR_COLORS = [2, 3, 4, 5, 6] as const;
export type CompetitorColor = (typeof COMPETITOR_COLORS)[number];

/** An entity's colour as a mark draws it: 1 to 6. */
export type EntityColor = 1 | CompetitorColor;

export const isCompetitorColor = (value: number | null | undefined): value is CompetitorColor =>
  COMPETITOR_COLORS.some((color) => color === value);

/** An entity's colour as a mark draws it: 1 to 6, or `null` past the sixth (and for a colour not read yet). */
export const entityColorOf = (value: number | null | undefined): EntityColor | null =>
  value === 1 || isCompetitorColor(value) ? value : null;

/** The colour a new competitor gets: the first of 2 to 6 no entity of the project holds, or `null` (neutral) past that. */
export function nextCompetitorColor(entries: readonly { color_index: number | null }[]): CompetitorColor | null {
  const taken = new Set(entries.map((entry) => entry.color_index));
  return COMPETITOR_COLORS.find((color) => !taken.has(color)) ?? null;
}

export interface ColorCandidate {
  id: string;
  /** The colour the project stored for it. */
  stored: number | null | undefined;
}

/**
 * The colour of each competitor that gets one: the one stored for it (2 to 6) when no earlier one holds it, and the
 * rest, in the order `fillOrder` gives (the order of `items` without one), take the first colour nobody holds. A
 * competitor left when the five are held is not in the result: the caller draws it neutral or leaves it out. No
 * two competitors share a colour.
 */
export function placeCompetitorColors<T extends ColorCandidate>(
  items: readonly T[],
  fillOrder?: (a: T, b: T) => number,
): Map<string, CompetitorColor> {
  const placed = new Map<string, CompetitorColor>();
  const held = new Set<CompetitorColor>();
  const unplaced: T[] = [];
  for (const item of items) {
    if (isCompetitorColor(item.stored) && !held.has(item.stored)) {
      held.add(item.stored);
      placed.set(item.id, item.stored);
    } else {
      unplaced.push(item);
    }
  }
  if (fillOrder !== undefined) unplaced.sort(fillOrder);
  for (const item of unplaced) {
    const free = COMPETITOR_COLORS.find((color) => !held.has(color));
    if (free === undefined) break;
    held.add(free);
    placed.set(item.id, free);
  }
  return placed;
}
