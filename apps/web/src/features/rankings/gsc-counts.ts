import type { TrackedKeywordRow } from '@/lib/api/types';

/** The column ids, which are the API's sort fields. */
export const GSC_CLICKS = 'gsc_clicks';
export const GSC_IMPRESSIONS = 'gsc_impressions';

/** What the Search Console block of a keyword row says about its numbers (`include=gsc`). */
export type GscMetric = 'clicks' | 'impressions';
export type GscState = 'ok' | 'pending' | 'not_connected';

type GscRow = Pick<TrackedKeywordRow, 'gsc' | 'device'>;

/** A row without the block, which the list sends only when asked, reads as waiting for it. */
export const gscStateOf = (row: GscRow): GscState => row.gsc?.state ?? 'pending';

/**
 * The 28-day count of a row on its own device: a number (0 is a count) while the project's property is read,
 * and null while the first pull runs or when Search Console is not connected.
 */
export function gscCount(row: GscRow, metric: GscMetric): number | null {
  if (gscStateOf(row) !== 'ok') return null;
  return row.gsc?.[metric]?.[row.device] ?? null;
}
