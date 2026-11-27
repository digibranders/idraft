import { newestContentRun, type HistoryVersion } from './page-history';

/** Which timeline rows are open for each page, kept while the drawer steps from page to page. */
const openByPage = new Map<string, ReadonlySet<string>>();

/** The rows open for a page: what the person left, or just the newest content change the first time. */
export function openRows(urlId: string, versions: readonly HistoryVersion[]): ReadonlySet<string> {
  const kept = openByPage.get(urlId);
  if (kept !== undefined) return kept;
  const newest = newestContentRun(versions);
  return new Set(newest === null ? [] : [newest]);
}

/** Remembers the rows open for a page. */
export function keepOpenRows(urlId: string, rows: ReadonlySet<string>): void {
  openByPage.set(urlId, rows);
}

/** For tests: forget every page. */
export function forgetOpenRows(): void {
  openByPage.clear();
}
