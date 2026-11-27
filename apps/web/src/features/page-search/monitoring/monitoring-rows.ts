import { HEALTH_ORDER } from '../health';
import type { PageCannibalization, PageQueries, TrackedPageRow, Verdict } from '../types';
import type { CsvCell, CsvTable } from '@/lib/csv/csv-write';
import { formatMetricDelta } from '@/lib/format';

/** What narrows the list: a tier id (`none` for Untiered, empty for all), a verdict (empty for all) and a search text. */
export interface RowFilters {
  tier: string;
  health: string;
  search: string;
}

/** The tier filter's value for the pages with no tier. */
export const UNTIERED_VALUE = 'none';

const matchesTier = (row: TrackedPageRow, tier: string): boolean =>
  tier === '' || (tier === UNTIERED_VALUE ? row.tier_id === null : row.tier_id === tier);

const matchesSearch = (row: TrackedPageRow, search: string): boolean => {
  const needle = search.trim().toLocaleLowerCase();
  return (
    needle === '' ||
    row.path.toLocaleLowerCase().includes(needle) ||
    (row.title ?? '').toLocaleLowerCase().includes(needle)
  );
};

/** The rows that pass the tier, the verdict and the search. A row with no health passes only an empty verdict filter. */
export function visibleRows(rows: readonly TrackedPageRow[], filters: RowFilters): TrackedPageRow[] {
  return rows.filter(
    (row) =>
      matchesTier(row, filters.tier) &&
      matchesSearch(row, filters.search) &&
      (filters.health === '' || row.health?.verdict === filters.health),
  );
}

/** The verdicts of the rows that pass the tier and the search (not the verdict filter), in filter order, none left at 0. */
export function healthCounts(
  rows: readonly TrackedPageRow[],
  filters: Pick<RowFilters, 'tier' | 'search'>,
): { verdict: Verdict; count: number }[] {
  const counts = new Map<Verdict, number>();
  for (const row of rows) {
    if (row.health === null || !matchesTier(row, filters.tier) || !matchesSearch(row, filters.search)) continue;
    counts.set(row.health.verdict, (counts.get(row.health.verdict) ?? 0) + 1);
  }
  return HEALTH_ORDER.filter((verdict) => counts.has(verdict)).map((verdict) => ({
    verdict,
    count: counts.get(verdict) ?? 0,
  }));
}

/**
 * The change in the number of queries against the compared period. More queries is good, so a growth is positive.
 * Nothing when there is no count, no count before, the value is capped (the real number is higher) or nothing changed.
 */
export function queriesChange(
  queries: PageQueries | null,
): { delta: number; text: string; tone: 'positive' | 'negative' } | null {
  if (queries === null || queries.previous === null || queries.capped) return null;
  const delta = queries.value - queries.previous;
  if (delta === 0) return null;
  const { text, tone } = formatMetricDelta({
    value: delta,
    unit: 'count',
    polarity: 'higher_is_better',
    isDetectable: true,
  });
  return { delta, text, tone: tone === 'negative' ? 'negative' : 'positive' };
}

export const queriesSortValue = (row: TrackedPageRow): number | null => row.queries?.value ?? null;

/** The column is drawn once the API fills the field for any row. */
export const showCannibalization = (rows: readonly TrackedPageRow[]): boolean =>
  rows.some((row) => row.cannibalization !== null && row.cannibalization !== undefined);

/** A likely verdict outweighs any number of the others, then the keywords decide; no value sorts last. */
export function cannibalizationSortValue(row: TrackedPageRow): number | null {
  const found = row.cannibalization;
  return found === null || found === undefined ? null : found.likely * 100 + found.keywords;
}

export type CannibalizationKind = 'likely' | 'coRanking' | 'unstable';

/** The parts of the count that are above zero, as `[count, kind]`, in the order the tooltip names them. */
export function cannibalizationParts(found: PageCannibalization): [number, CannibalizationKind][] {
  const parts: [number, CannibalizationKind][] = [
    [found.likely, 'likely'],
    [found.co_ranking, 'coRanking'],
    [found.unstable, 'unstable'],
  ];
  return parts.filter(([count]) => count > 0);
}

export interface CsvWords {
  headers: {
    page: string;
    tier: string;
    health: string;
    clicks: string;
    clicksBefore: string;
    impressions: string;
    impressionsBefore: string;
    ctr: string;
    ctrBefore: string;
    position: string;
    positionBefore: string;
    queries: string;
    queriesBefore: string;
    cannibalizationKeywords: string;
    likely: string;
    coRanking: string;
    unstable: string;
  };
  tier: (tierId: string | null) => string;
  health: (verdict: Verdict) => string;
}

const rounded = (value: number | null | undefined, places: number): number | null =>
  value === null || value === undefined ? null : Math.round(value * 10 ** places) / 10 ** places;

/** The rows as a CSV table: raw numbers, an empty cell where there is none, Cannibalization only when it is drawn. */
export function csvOf(rows: readonly TrackedPageRow[], words: CsvWords): CsvTable {
  const h = words.headers;
  const withCannibalization = showCannibalization(rows);
  const header = [
    h.page,
    h.tier,
    h.health,
    h.clicks,
    h.clicksBefore,
    h.impressions,
    h.impressionsBefore,
    h.ctr,
    h.ctrBefore,
    h.position,
    h.positionBefore,
    h.queries,
    h.queriesBefore,
    ...(withCannibalization ? [h.cannibalizationKeywords, h.likely, h.coRanking, h.unstable] : []),
  ];
  const lines = rows.map((row): CsvCell[] => {
    const queries = row.queries;
    const found = row.cannibalization;
    return [
      row.path,
      words.tier(row.tier_id),
      row.health === null ? null : words.health(row.health.verdict),
      row.current?.clicks ?? null,
      row.previous?.clicks ?? null,
      row.current?.impressions ?? null,
      row.previous?.impressions ?? null,
      rounded(row.current?.ctr, 4),
      rounded(row.previous?.ctr, 4),
      rounded(row.current?.position, 1),
      rounded(row.previous?.position, 1),
      queries === null ? null : queries.capped ? `${String(queries.value)}+` : queries.value,
      queries?.previous ?? null,
      ...(withCannibalization
        ? [found?.keywords ?? null, found?.likely ?? null, found?.co_ranking ?? null, found?.unstable ?? null]
        : []),
    ];
  });
  return { header, rows: lines };
}
