import type { CrawlRun } from './types';

const HAS_DATA = new Set<string>(['ready', 'stopped_at_ceiling']);

/** Crawls a person can open in the screens: those with data, newest first (the list comes newest first). */
export const pickableCrawls = (runs: readonly CrawlRun[]): CrawlRun[] =>
  runs.filter((item) => HAS_DATA.has(item.state));

/** The crawl the screens show: the one in the address when it has data, otherwise the latest. */
export function chosenCrawl(runs: readonly CrawlRun[], run: string | null): CrawlRun | null {
  const pickable = pickableCrawls(runs);
  const wanted = run === null ? undefined : pickable.find((item) => item.run_id === run);
  return wanted ?? pickable.find((item) => item.is_latest) ?? pickable[0] ?? null;
}

/** Whether the address shows a crawl that is not the latest ("Older crawl", "Back to latest"). */
export function isOlder(runs: readonly CrawlRun[], run: string | null): boolean {
  const chosen = chosenCrawl(runs, run);
  return chosen !== null && !chosen.is_latest;
}

export interface CrawlInView {
  crawl: CrawlRun | null;
  /** What every read sends as `run`: `null` for the latest crawl (reads and cache keys stay as they were). */
  run: string | null;
  older: boolean;
  /** False for a crawl past the last four: its link level reads answer `410 links_dropped`. */
  linksAvailable: boolean;
  /** The address names a crawl that is not in the list (or has no data): the reads fall back to the latest. */
  unknown: boolean;
}

/** The crawl the screens read, from the crawl list and the `run` of the address. */
export function crawlInView(runs: readonly CrawlRun[], wanted: string | null): CrawlInView {
  const crawl = chosenCrawl(runs, wanted);
  const older = crawl !== null && !crawl.is_latest;
  return {
    crawl,
    run: older ? crawl.run_id : null,
    older,
    linksAvailable: crawl?.links_available ?? true,
    unknown: wanted !== null && crawl?.run_id !== wanted,
  };
}
