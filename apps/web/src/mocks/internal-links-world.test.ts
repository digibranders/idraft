import { describe, expect, it } from 'vitest';

import {
  cancelCrawl,
  changeSettings,
  crawlsOf,
  EVENTUS,
  hasFinishedCrawl,
  linksWorld,
  requestCrawl,
  settingsOf,
} from './internal-links-world';

const FYNIX = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01';
const T0 = Date.parse('2026-11-17T09:00:00Z');
const start = (projectId = EVENTUS.project_id, now = T0) => {
  const started = requestCrawl(projectId, { hasWebsite: true, higherLimit: false, now });
  if (!started.ok) throw new Error(`the crawl was refused: ${started.code}`);
  return started.run;
};

describe('the crawls of the mock world', () => {
  it('has one finished crawl for the Eventus project and none for another', () => {
    expect(crawlsOf(EVENTUS.project_id)).toMatchObject([{ state: 'ready', is_latest: true }]);
    expect(hasFinishedCrawl(EVENTUS.project_id)).toBe(true);
    expect(crawlsOf(FYNIX)).toEqual([]);
    expect(hasFinishedCrawl(FYNIX)).toBe(false);
  });

  it('queues a crawl with the ceiling and the estimate the API gives, six decimals', () => {
    expect(start()).toMatchObject({
      state: 'queued',
      trigger: 'manual',
      ceiling: 2000,
      estimated_cost_usd: '0.300000',
      render_javascript: false,
      is_latest: false,
    });
  });

  it('follows the settings: rendering JavaScript costs ten times as much', () => {
    changeSettings(EVENTUS.project_id, { render_javascript: true });
    expect(start()).toMatchObject({ render_javascript: true, estimated_cost_usd: '3.000000' });
  });

  it('refuses a crawl without a website and a second crawl while one runs', () => {
    expect(requestCrawl(FYNIX, { hasWebsite: false, higherLimit: false })).toEqual({ ok: false, code: 'no_website' });
    const first = start();
    expect(requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: false, now: T0 })).toEqual({
      ok: false,
      code: 'crawl_in_progress',
      runId: first.run_id,
    });
  });

  it('takes the trigger of the caller, as a new project does', () => {
    const started = requestCrawl(FYNIX, { hasWebsite: true, higherLimit: false, trigger: 'website_added' });
    expect(started).toMatchObject({ ok: true, run: { trigger: 'website_added' } });
  });

  it('wants a crawl that stopped at its ceiling for a higher limit, and then crawls up to 4000 pages', () => {
    expect(requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: true })).toEqual({
      ok: false,
      code: 'no_stopped_crawl',
    });
    const [latest] = crawlsOf(EVENTUS.project_id);
    if (latest === undefined) throw new Error('no crawl');
    linksWorld().crawls.set(EVENTUS.project_id, [{ ...latest, state: 'stopped_at_ceiling' }]);
    const retried = requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: true, now: T0 });
    expect(retried).toMatchObject({
      ok: true,
      run: { trigger: 'ceiling_retry', ceiling: 4000, estimated_cost_usd: '0.600000' },
    });
  });

  it('queues a started crawl for 3 seconds, runs it until the 8th and then makes it the latest', () => {
    const run = start();
    expect(crawlsOf(EVENTUS.project_id, T0 + 1000)[0]).toMatchObject({ run_id: run.run_id, state: 'queued' });
    expect(crawlsOf(EVENTUS.project_id, T0 + 4000)[0]).toMatchObject({ run_id: run.run_id, state: 'crawling' });
    expect(crawlsOf(EVENTUS.project_id, T0 + 8000)[0]).toMatchObject({
      run_id: run.run_id,
      state: 'ready',
      is_latest: true,
    });
  });

  it('ends a queued crawl at once when it is cancelled, and refuses a second cancel', () => {
    const run = start();
    const cancelled = cancelCrawl(EVENTUS.project_id, run.run_id, T0);
    expect(cancelled).toMatchObject({ ok: true, run: { state: 'cancelled', finished_at: '2026-11-17T09:00:00.000Z' } });
    expect(cancelCrawl(EVENTUS.project_id, run.run_id, T0 + 10)).toEqual({
      ok: false,
      code: 'invalid_state_transition',
    });
    expect(crawlsOf(EVENTUS.project_id, T0 + 20)[0]).toMatchObject({ state: 'cancelled', is_latest: false });
  });

  it('asks a crawling crawl to stop: it answers crawling now and is cancelled a moment later', () => {
    const run = start();
    const asked = cancelCrawl(EVENTUS.project_id, run.run_id, T0 + 4000);
    expect(asked).toMatchObject({ ok: true, run: { state: 'crawling' } });
    expect(crawlsOf(EVENTUS.project_id, T0 + 4500)[0]).toMatchObject({ state: 'crawling' });
    expect(crawlsOf(EVENTUS.project_id, T0 + 6000)[0]).toMatchObject({ state: 'cancelled', is_latest: false });
    expect(cancelCrawl(EVENTUS.project_id, run.run_id, T0 + 6000)).toEqual({
      ok: false,
      code: 'invalid_state_transition',
    });
  });

  it('cannot cancel a finished crawl or one of another project', () => {
    const [finished] = crawlsOf(EVENTUS.project_id);
    if (finished === undefined) throw new Error('no crawl');
    expect(cancelCrawl(EVENTUS.project_id, finished.run_id)).toEqual({ ok: false, code: 'invalid_state_transition' });
    expect(cancelCrawl(FYNIX, finished.run_id)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('the internal links settings of the mock world', () => {
  it('keeps the settings of a project and changes only what is given', () => {
    expect(settingsOf(EVENTUS.project_id)).toEqual({
      schedule: 'weekly',
      render_javascript: false,
      allowed_subdomains: [],
    });
    expect(changeSettings(EVENTUS.project_id, { schedule: 'monthly' })).toEqual({
      schedule: 'monthly',
      render_javascript: false,
      allowed_subdomains: [],
    });
    expect(settingsOf(EVENTUS.project_id).schedule).toBe('monthly');
  });
});
