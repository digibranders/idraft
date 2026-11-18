import { describe, expect, it } from 'vitest';

import { crawlView } from './crawl-reads';
import type { CrawlRun } from '@/lib/internal-links/types';

const run = (over: Partial<CrawlRun>): CrawlRun => ({
  run_id: 'r',
  trigger: 'schedule',
  state: 'ready',
  ceiling: 2000,
  pages_found: 40,
  pages_crawled: 40,
  sitemap_pages: 30,
  render_javascript: false,
  estimated_cost_usd: '0.300000',
  cost_usd: '0.300000',
  stop_reason: null,
  error_code: null,
  error_message: null,
  hints: [],
  is_latest: false,
  created_at: '2026-11-14T03:00:00Z',
  submitted_at: '2026-11-14T03:00:05Z',
  finished_at: '2026-11-14T03:12:00Z',
  requested_by: null,
  links_available: true,
  previous_run_id: null,
  enrich_state: 'done',
  ...over,
});

describe('crawlView (spec 9)', () => {
  it('needs a website first, and never reads crawls without one', () => {
    expect(crawlView(false, undefined, 'loading')).toEqual({ kind: 'no-website' });
  });

  it('waits, fails and says when there is no crawl at all', () => {
    expect(crawlView(true, undefined, 'loading')).toEqual({ kind: 'loading' });
    expect(crawlView(true, undefined, 'error')).toEqual({ kind: 'error' });
    expect(crawlView(true, [], 'ready')).toEqual({ kind: 'never' });
  });

  it('shows the first crawl in progress before any crawl has finished', () => {
    const first = run({ run_id: 'a', state: 'crawling', trigger: 'website_added', finished_at: null });
    expect(crawlView(true, [first], 'ready')).toEqual({ kind: 'first', run: first });
    const queued = run({ run_id: 'q', state: 'queued', finished_at: null });
    expect(crawlView(true, [queued], 'ready')).toEqual({ kind: 'first', run: queued });
  });

  it('shows a failed first crawl as its own state', () => {
    const failed = run({ state: 'failed', error_code: 'site_blocked' });
    expect(crawlView(true, [failed], 'ready')).toEqual({ kind: 'failed-first', run: failed });
  });

  it('treats a cancelled first crawl as no crawl at all, so Crawl now is offered again', () => {
    expect(crawlView(true, [run({ state: 'cancelled', finished_at: null })], 'ready')).toEqual({ kind: 'never' });
  });

  it('keeps the latest finished crawl and reports a newer running or failed one beside it', () => {
    const latest = run({ run_id: 'b', is_latest: true });
    const running = run({ run_id: 'c', state: 'crawling', finished_at: null });
    const failed = run({ run_id: 'd', state: 'failed', error_code: 'provider_error' });
    const cancelled = run({ run_id: 'e', state: 'cancelled' });
    expect(crawlView(true, [running, latest], 'ready')).toEqual({
      kind: 'ready',
      latest,
      active: running,
      failed: null,
    });
    expect(crawlView(true, [failed, latest], 'ready')).toEqual({ kind: 'ready', latest, active: null, failed });
    expect(crawlView(true, [latest, failed], 'ready')).toEqual({ kind: 'ready', latest, active: null, failed: null });
    expect(crawlView(true, [cancelled, latest], 'ready')).toEqual({
      kind: 'ready',
      latest,
      active: null,
      failed: null,
    });
  });

  it('does not know the state when the page is full and the latest crawl is not on it', () => {
    const failed = Array.from({ length: 3 }, (_, index) => run({ run_id: `f${String(index)}`, state: 'failed' }));
    expect(crawlView(true, failed, 'ready', true)).toEqual({ kind: 'unknown' });
    // The same rows with no more behind them are the whole history: a failed first crawl
    expect(crawlView(true, failed, 'ready', false)).toEqual({ kind: 'failed-first', run: failed[0] });
    // The latest on the page is the latest, however much more there is
    const latest = run({ run_id: 'l', is_latest: true });
    expect(crawlView(true, [...failed, latest], 'ready', true)).toMatchObject({ kind: 'ready', latest });
    // A crawl under way with more rows behind it is still a first crawl only if nothing older holds data
    expect(crawlView(true, [run({ state: 'crawling', finished_at: null })], 'ready', true)).toEqual({
      kind: 'unknown',
    });
  });

  it('keeps a crawl that stopped at its ceiling as the latest', () => {
    const latest = run({ state: 'stopped_at_ceiling', is_latest: true, pages_found: 2000 });
    expect(crawlView(true, [latest], 'ready')).toEqual({ kind: 'ready', latest, active: null, failed: null });
  });
});
