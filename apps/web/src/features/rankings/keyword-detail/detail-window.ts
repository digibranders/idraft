/** The windows of the page's chart, strip and histories: the five the rank history route takes. */
export const WINDOW_KEYS = ['7d', '30d', '90d', '180d', '365d'] as const;
export type DetailWindow = (typeof WINDOW_KEYS)[number];
export const WINDOWS = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 } as const satisfies Record<
  DetailWindow,
  number
>;
export const DEFAULT_WINDOW: DetailWindow = '90d';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The API's name of a window: `last_30d`. */
export function apiWindow(win: DetailWindow): `last_${(typeof WINDOWS)[DetailWindow]}d` {
  return `last_${WINDOWS[win]}d`;
}

/**
 * The first and last local day of a window ending on `today` (a `YYYY-MM-DD` day in the project's time
 * zone), both included. UTC arithmetic on the ISO day, so no time zone of this machine can shift it.
 */
export function windowDates(win: DetailWindow, today: string): { from: string; to: string } {
  const end = Date.parse(`${today}T00:00:00Z`);
  const from = new Date(end - (WINDOWS[win] - 1) * DAY_MS).toISOString().slice(0, 10);
  return { from, to: today };
}

/** How many days a window holds, both ends included: 2026-10-27 to 2026-11-02 is 7. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}
