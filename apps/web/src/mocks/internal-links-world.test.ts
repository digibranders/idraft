import { describe, expect, it } from 'vitest';

import { changeSettings, crawlsOf, EVENTUS, hasFinishedCrawl, requestCrawl, settingsOf } from './internal-links-world';

const FYNIX = '0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01';

describe('the crawls of the mock world (types of pending-contract.ts, no route yet)', () => {
  it('has one finished crawl for the Eventus project and none for another', () => {
    expect(crawlsOf(EVENTUS.project_id)).toMatchObject([{ state: 'ready', is_latest: true }]);
    expect(hasFinishedCrawl(EVENTUS.project_id)).toBe(true);
    expect(crawlsOf(FYNIX)).toEqual([]);
    expect(hasFinishedCrawl(FYNIX)).toBe(false);
  });

  it('refuses a crawl without a website and a second crawl while one runs', () => {
    expect(requestCrawl(FYNIX, { hasWebsite: false, higherLimit: false })).toEqual({ ok: false, code: 'no_website' });
    const first = requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: false });
    expect(first).toMatchObject({ ok: true, run: { state: 'queued', trigger: 'manual', is_latest: false } });
    const second = requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: false });
    expect(second).toMatchObject({ ok: false, code: 'crawl_in_progress' });
  });

  it('runs a started crawl for 8 seconds and then makes it the latest', () => {
    const started = Date.parse('2026-11-17T09:00:00Z');
    const first = requestCrawl(EVENTUS.project_id, { hasWebsite: true, higherLimit: true, now: started });
    if (!first.ok) throw new Error('the crawl was refused');
    expect(first.run.trigger).toBe('ceiling_retry');
    expect(crawlsOf(EVENTUS.project_id, started + 1000)[0]).toMatchObject({ state: 'crawling' });
    expect(crawlsOf(EVENTUS.project_id, started + 8000)[0]).toMatchObject({ state: 'ready', is_latest: true });
  });

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
