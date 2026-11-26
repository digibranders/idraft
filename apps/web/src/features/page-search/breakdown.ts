import type { BreakdownDimension, BreakdownRow, MetricKey } from './types';

/**
 * How much a row changed in a metric, in the unit its formatter reads: a count difference for clicks and impressions,
 * a ratio difference for CTR (`formatPointsDelta` makes points of it) and, for the position, previous minus current,
 * so a positive number is always an improvement. `null` when either side is missing.
 */
export function changeOf(row: BreakdownRow, metric: MetricKey): number | null {
  const { current, previous } = row;
  if (current === null || previous === null) return null;
  switch (metric) {
    case 'clicks':
    case 'impressions':
      return current[metric] - previous[metric];
    case 'ctr':
      return current.ctr === null || previous.ctr === null ? null : current.ctr - previous.ctr;
    case 'position':
      return current.position === null || previous.position === null ? null : previous.position - current.position;
  }
}

/** The biggest change first, whatever its sign; rows without a change last; ties by the clicks of the period. */
export function sortRows(rows: readonly BreakdownRow[], metric: MetricKey): BreakdownRow[] {
  const keyed = rows.map((row) => ({ row, change: changeOf(row, metric) }));
  keyed.sort((a, b) => {
    if (a.change === null || b.change === null) {
      if (a.change === b.change) return (b.row.current?.clicks ?? 0) - (a.row.current?.clicks ?? 0);
      return a.change === null ? 1 : -1;
    }
    return Math.abs(b.change) - Math.abs(a.change) || (b.row.current?.clicks ?? 0) - (a.row.current?.clicks ?? 0);
  });
  return keyed.map(({ row }) => row);
}

const DEVICES: ReadonlySet<string> = new Set(['DESKTOP', 'MOBILE', 'TABLET']);

/** What names a row: text to show as it is, or a key under `pageSearch` for the caller to translate. */
export type RowName = { kind: 'text'; text: string } | { kind: 'message'; key: `devices.${string}` };

/**
 * The name of a row. A query is its text. A country is the API's three-letter code looked up in `countryNames`
 * (code to name, built by the caller), the code itself when it is not there. A device is a message key.
 */
export function nameOf(dimension: BreakdownDimension, key: string, countryNames: ReadonlyMap<string, string>): RowName {
  if (dimension === 'country') return { kind: 'text', text: countryNames.get(key) ?? key };
  if (dimension === 'device' && DEVICES.has(key)) return { kind: 'message', key: `devices.${key}` };
  return { kind: 'text', text: key };
}
