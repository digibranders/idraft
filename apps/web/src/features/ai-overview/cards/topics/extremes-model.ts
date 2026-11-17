import type { TopicEngineRow } from './topic-rows';
import type { ScopeMetric } from '../../scope/scope-model';
import { safeText, type CsvCell } from '@/lib/csv/csv-write';

/**
 * The strongest and weakest groups (OV-GRP-13): the groups ranked by their equal weight average over the platforms
 * that show a rate (never by pooled counts, R3). Plain data: the card gives the words.
 */

/** A group with a rate, and the rate it is ranked by. */
export interface RankedGroup {
  row: TopicEngineRow;
  value: number;
}

/** Groups with a rate needed before any is called strongest or weakest. */
export const MIN_GROUPS_TO_RANK = 4;
/** From this many groups with a rate each list shows 5; fewer show 3. */
const MANY_GROUPS = 12;

/** The columns of the card's export block: data names, not words for a person. */
export const EXTREMES_EXPORT_HEADER = ['group', 'prompts', 'rate_percent', 'platforms', 'status'] as const;

export const extremesFileName = (measure: ScopeMetric): string => `strongest-weakest-groups-${measure}`;

export interface Extremes {
  /** The highest rates, best first. */
  strongest: RankedGroup[];
  /** The lowest rates, lowest first. A group is never in both lists. */
  weakest: RankedGroup[];
  /** The groups with a rate. */
  rated: number;
  /** At least `MIN_GROUPS_TO_RANK` groups have a rate. */
  enough: boolean;
  /** Every group with its average, ranked ones first, for the table and the export. */
  all: TopicEngineRow[];
}

const rateOf = (row: TopicEngineRow): number | null => (row.average.state === 'ok' ? row.average.value : null);

/** Higher rate first; a tie goes to the group that holds more prompts, then to the name. */
const byRate = (a: RankedGroup, b: RankedGroup): number =>
  b.value - a.value ||
  b.row.node.promptCount - a.row.node.promptCount ||
  a.row.node.name.localeCompare(b.row.node.name);

/**
 * Each list shows 3 groups, or 5 from 12 groups with a rate, and never more than half of them, so a group does not
 * stand on both sides.
 */
export function extremesOf(rows: readonly TopicEngineRow[]): Extremes {
  const ranked = rows
    .flatMap((row) => {
      const value = rateOf(row);
      return value === null ? [] : [{ row, value }];
    })
    .sort(byRate);
  const enough = ranked.length >= MIN_GROUPS_TO_RANK;
  const count = enough ? Math.min(ranked.length >= MANY_GROUPS ? 5 : 3, Math.floor(ranked.length / 2)) : 0;
  const unranked = rows.filter((row) => rateOf(row) === null);
  return {
    strongest: ranked.slice(0, count),
    weakest: ranked.slice(ranked.length - count).reverse(),
    rated: ranked.length,
    enough,
    all: [...ranked.map((entry) => entry.row), ...unranked],
  };
}

/** One group as the export writes it: an unknown rate is an empty cell and its status says why, never 0. */
export function extremesExportRow(row: TopicEngineRow): CsvCell[] {
  const value = rateOf(row);
  return [
    safeText(row.node.path.join(' / ')),
    row.node.promptCount,
    value === null ? null : Math.round(value * 10000) / 100,
    row.average.engines,
    row.average.state,
  ];
}
