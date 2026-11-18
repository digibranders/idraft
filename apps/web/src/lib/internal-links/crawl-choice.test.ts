import { describe, expect, it } from 'vitest';

import { chosenCrawl, crawlInView, isOlder, pickableCrawls } from './crawl-choice';
import type { CrawlRun } from './types';

const run = (id: string, over: Partial<CrawlRun> = {}): CrawlRun =>
  ({ run_id: id, state: 'ready', is_latest: false, links_available: true, ...over }) as CrawlRun;

describe('crawl choice', () => {
  const runs = [
    run('c4', { is_latest: true }),
    run('c3'),
    run('c2', { links_available: false }),
    run('c1', { state: 'failed' }),
  ];

  it('lists only crawls with data, newest first', () => {
    expect(pickableCrawls(runs).map((item) => item.run_id)).toEqual(['c4', 'c3', 'c2']);
  });

  it('chooses the crawl in the address when it has data, and the latest otherwise', () => {
    expect(chosenCrawl(runs, 'c3')?.run_id).toBe('c3');
    expect(chosenCrawl(runs, 'c1')?.run_id).toBe('c4');
    expect(chosenCrawl(runs, null)?.run_id).toBe('c4');
    expect(chosenCrawl([], null)).toBeNull();
  });

  it('says a crawl is older when it is not the latest', () => {
    expect(isOlder(runs, 'c3')).toBe(true);
    expect(isOlder(runs, null)).toBe(false);
    expect(isOlder(runs, 'c4')).toBe(false);
  });
});

describe('the crawl in view', () => {
  const runs = [run('c4', { is_latest: true }), run('c3'), run('c2', { links_available: false })];

  it('reads the latest with no run to send when the address names none', () => {
    expect(crawlInView(runs, null)).toMatchObject({ run: null, older: false, linksAvailable: true, unknown: false });
  });

  it('sends no run for the latest crawl named in the address either, so its reads keep one cache key', () => {
    expect(crawlInView(runs, 'c4')).toMatchObject({ run: null, older: false, unknown: false });
  });

  it('sends the id of an older crawl and says whether its links are kept', () => {
    expect(crawlInView(runs, 'c3')).toMatchObject({ run: 'c3', older: true, linksAvailable: true });
    expect(crawlInView(runs, 'c2')).toMatchObject({ run: 'c2', older: true, linksAvailable: false });
  });

  it('falls back to the latest and flags a crawl that is not in the list, never widening a read', () => {
    expect(crawlInView(runs, 'gone')).toMatchObject({ run: null, older: false, unknown: true });
    expect(crawlInView(runs, null).unknown).toBe(false);
  });

  it('reads nothing when no crawl has data', () => {
    expect(crawlInView([], null)).toMatchObject({ crawl: null, run: null, older: false, unknown: false });
  });
});
