/** The codes a site answers with to refuse a crawler; the API counts them as "blocked", not as errors (plan 08). */
const BLOCKED_STATUSES: readonly number[] = [401, 403, 429];

export function isBlockedStatus(status: number | null): boolean {
  return status !== null && BLOCKED_STATUSES.includes(status);
}

/** "Read 940 of 1,000 pages", the pages the crawl could read out of those it reached; `null` when nothing was refused. */
export function readPages(crawled: number, blocked: number | null): { read: number; crawled: number } | null {
  if (blocked === null || blocked <= 0) return null;
  return { read: Math.max(0, crawled - blocked), crawled };
}
