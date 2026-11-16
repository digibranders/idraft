import type { components } from '@/lib/api/schema';

/** What the project's entity list says of one entity: its role and the color its charts draw it in. */
export type ProjectEntry = components['schemas']['ProjectEntity'];

/** The summary gives entity cells for at most this many tracked entities, so a 21st competitor would show no number. */
export const TRACKED_LIMIT = 20;

/** The colors of competitors: 1 is the own brand's, and a competitor past the sixth is drawn in the neutral "other". */
const COMPETITOR_COLORS = [2, 3, 4, 5, 6] as const;

/** The color a new competitor gets: the first of 2 to 6 no entity of the project holds, or `null` (neutral) past that. */
export function nextCompetitorColor(entries: readonly Pick<ProjectEntry, 'color_index'>[]): number | null {
  const taken = new Set(entries.map((entry) => entry.color_index));
  return COMPETITOR_COLORS.find((color) => !taken.has(color)) ?? null;
}

/** Whether the project follows as many entities as the summary can give cells for. */
export const atTrackedLimit = (tracked: number): boolean => tracked >= TRACKED_LIMIT;

/** A name as two brands compare it: ignoring case and the space around it. */
export const sameBrand = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
