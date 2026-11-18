import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS, setCrawlsEnabled } from '../internal-links-world';
import { mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = `${W}/projects/${EVENTUS.project_id}`;
const RUN = z.object({ run_id: z.string(), state: z.string(), trigger: z.string() });
const RUNS = z.object({ data: z.array(RUN), page: z.object({ has_more: z.boolean() }) });
const ONE = z.object({ data: RUN });
const PROJECT = z.object({ data: z.object({ project_id: z.string() }) });

// The mock crawl moves with the clock (queued for 3 s, then crawling): the clock stands still, so a request
// right after another sees a queued crawl however slow the machine is
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T09:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the crawl routes of the mock API', () => {
  it('lists the crawls of a project, newest first', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/link-crawls?limit=10`);
    expect(answer.status).toBe(200);
    const runs = RUNS.parse(answer.body);
    expect(runs.data).toHaveLength(5);
    expect(runs.data.every((run) => run.state === 'ready')).toBe(true);
    expect(runs.page.has_more).toBe(false);
  });

  it('starts a crawl, and answers the one under way to a second request', async () => {
    const browser = mockBrowser('editor');
    const started = await browser.call('POST', `${P}/link-crawls`, {});
    expect(started.status).toBe(202);
    const run = ONE.parse(started.body).data;
    expect(run).toMatchObject({ state: 'queued', trigger: 'manual' });
    const again = await browser.call('POST', `${P}/link-crawls`, {});
    expect(again.status).toBe(409);
    expect(again.code).toBe('crawl_in_progress');
    expect(again.body.run_id).toBe(run.run_id);
    const listed = RUNS.parse((await browser.call('GET', `${P}/link-crawls`)).body);
    expect(listed.data.map((row) => row.run_id)).toContain(run.run_id);
  });

  it('answers 503 crawls_disabled while crawls are off: nothing is queued, a viewer or stranger is refused first', async () => {
    setCrawlsEnabled(false);
    const editor = mockBrowser('editor');
    const refused = await editor.call('POST', `${P}/link-crawls`, {});
    expect(refused.status).toBe(503);
    expect(refused.code).toBe('crawls_disabled');
    expect(refused.body.title).toBe('Site crawls are not switched on yet');
    // Before the other checks, as the API does: a higher limit with no stopped crawl is not a 422 here
    expect((await editor.call('POST', `${P}/link-crawls`, { higher_limit: true })).code).toBe('crawls_disabled');
    expect((await mockBrowser('viewer').call('POST', `${P}/link-crawls`, {})).status).toBe(403);
    const stranger = `${W}/projects/0192e4a0-9000-7000-8000-0000000000ff/link-crawls`;
    expect((await editor.call('POST', stranger, {})).status).toBe(404);
    // Reading still works, and nothing was queued
    const listed = RUNS.parse((await editor.call('GET', `${P}/link-crawls`)).body).data;
    expect(listed).toHaveLength(5);
    expect(listed.every((run) => run.state === 'ready')).toBe(true);
    setCrawlsEnabled(true);
    expect((await editor.call('POST', `${P}/link-crawls`, {})).status).toBe(202);
  });

  it('creates a mapped project and queues no crawl while crawls are off', async () => {
    setCrawlsEnabled(false);
    const browser = mockBrowser('owner');
    const body = { name: 'Mapped', slug: 'mapped-off', primary_domain: 'example.com', map_internal_links: true };
    const created = await browser.call('POST', `${W}/projects`, body);
    expect(created.status).toBe(201);
    const id = PROJECT.parse(created.body).data.project_id;
    expect(RUNS.parse((await browser.call('GET', `${W}/projects/${id}/link-crawls`)).body).data).toEqual([]);
  });

  it('lets a viewer read crawls but not start or cancel one', async () => {
    const viewer = mockBrowser('viewer');
    expect((await viewer.call('POST', `${P}/link-crawls`, {})).status).toBe(403);
    const [finished] = RUNS.parse((await viewer.call('GET', `${P}/link-crawls`)).body).data;
    expect((await viewer.call('POST', `${P}/link-crawls/${finished?.run_id ?? ''}/cancel`)).status).toBe(403);
    expect((await viewer.call('GET', `${P}/link-crawls/${finished?.run_id ?? ''}`)).status).toBe(200);
  });

  it('refuses an unknown query, and a body with an unknown member', async () => {
    const browser = mockBrowser('editor');
    expect((await browser.call('GET', `${P}/link-crawls?state=ready`)).status).toBe(422);
    expect((await browser.call('POST', `${P}/link-crawls`, { force: true })).status).toBe(422);
  });

  it('refuses a higher limit while no crawl stopped at its ceiling', async () => {
    const answer = await mockBrowser('editor').call('POST', `${P}/link-crawls`, { higher_limit: true });
    expect(answer.status).toBe(422);
    expect(answer.code).toBe('validation_failed');
    expect(JSON.stringify(answer.body)).toContain('no_stopped_crawl');
  });

  it('reads one crawl, and answers not_found for one it does not have', async () => {
    const browser = mockBrowser('viewer');
    const [finished] = RUNS.parse((await browser.call('GET', `${P}/link-crawls`)).body).data;
    const one = await browser.call('GET', `${P}/link-crawls/${finished?.run_id ?? ''}`);
    expect(ONE.parse(one.body).data.run_id).toBe(finished?.run_id);
    const missing = await browser.call('GET', `${P}/link-crawls/0192e4a0-9000-7000-8000-0000000000ff`);
    expect(missing.code).toBe('not_found');
    const other = `${W}/projects/0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01/link-crawls/${finished?.run_id ?? ''}`;
    expect((await browser.call('GET', other)).status).toBe(404);
  });

  it('cancels a queued crawl at once, and refuses to cancel it twice or to cancel a finished one', async () => {
    const browser = mockBrowser('editor');
    const run = ONE.parse((await browser.call('POST', `${P}/link-crawls`, {})).body).data;
    const cancelled = await browser.call('POST', `${P}/link-crawls/${run.run_id}/cancel`);
    expect(ONE.parse(cancelled.body).data).toMatchObject({ run_id: run.run_id, state: 'cancelled' });
    const again = await browser.call('POST', `${P}/link-crawls/${run.run_id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.code).toBe('invalid_state_transition');
    const [, finished] = RUNS.parse((await browser.call('GET', `${P}/link-crawls`)).body).data;
    expect((await browser.call('POST', `${P}/link-crawls/${finished?.run_id ?? ''}/cancel`)).code).toBe(
      'invalid_state_transition',
    );
  });

  it('answers no_website for a project without a website, and queues the first crawl of a mapped new project', async () => {
    const browser = mockBrowser('owner');
    const bare = PROJECT.parse((await browser.call('POST', `${W}/projects`, { name: 'Bare', slug: 'bare-site' })).body)
      .data.project_id;
    const refused = await browser.call('POST', `${W}/projects/${bare}/link-crawls`, {});
    expect(refused.status).toBe(422);
    expect(refused.code).toBe('no_website');

    const site = { name: 'Mapped', primary_domain: 'example.com' };
    const mapped = PROJECT.parse(
      (await browser.call('POST', `${W}/projects`, { ...site, slug: 'mapped-site', map_internal_links: true })).body,
    ).data.project_id;
    const plain = PROJECT.parse((await browser.call('POST', `${W}/projects`, { ...site, slug: 'plain-site' })).body)
      .data.project_id;
    const ticked = RUNS.parse((await browser.call('GET', `${W}/projects/${mapped}/link-crawls`)).body).data;
    expect(ticked).toMatchObject([{ state: 'queued', trigger: 'website_added' }]);
    expect(RUNS.parse((await browser.call('GET', `${W}/projects/${plain}/link-crawls`)).body).data).toEqual([]);

    const noSite = PROJECT.parse(
      (await browser.call('POST', `${W}/projects`, { name: 'No site', slug: 'no-site', map_internal_links: true }))
        .body,
    ).data.project_id;
    expect(RUNS.parse((await browser.call('GET', `${W}/projects/${noSite}/link-crawls`)).body).data).toEqual([]);
  });
});

const SETTINGS = z.object({
  data: z.object({
    seo: z.object({ default_device: z.string() }).optional(),
    internal_links: z.object({
      schedule: z.string(),
      render_javascript: z.boolean(),
      allowed_subdomains: z.array(z.string()),
    }),
  }),
});

describe('the internal links part of the project settings', () => {
  it('defaults to weekly without JavaScript', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/settings`);
    expect(SETTINGS.parse(answer.body).data.internal_links).toEqual({
      schedule: 'weekly',
      render_javascript: false,
      allowed_subdomains: [],
    });
  });

  it('changes the internal links part and keeps the seo part, and one patch can change both', async () => {
    const browser = mockBrowser('editor');
    await browser.call('PATCH', `${P}/settings`, { seo: { default_device: 'mobile' } });
    const links = await browser.call('PATCH', `${P}/settings`, {
      internal_links: { schedule: 'monthly', allowed_subdomains: ['Blog.EventusSecurity.com'] },
    });
    expect(SETTINGS.parse(links.body).data).toMatchObject({
      seo: { default_device: 'mobile' },
      internal_links: {
        schedule: 'monthly',
        render_javascript: false,
        allowed_subdomains: ['blog.eventussecurity.com'],
      },
    });
    const both = await browser.call('PATCH', `${P}/settings`, {
      seo: { default_device: 'both' },
      internal_links: { render_javascript: true },
    });
    expect(SETTINGS.parse(both.body).data).toMatchObject({
      seo: { default_device: 'both' },
      internal_links: { schedule: 'monthly', render_javascript: true },
    });
    expect(SETTINGS.parse((await browser.call('GET', `${P}/settings`)).body).data.internal_links.schedule).toBe(
      'monthly',
    );
  });

  it('keeps each allowed host once, in lower case, and takes the site with its www form', async () => {
    const browser = mockBrowser('editor');
    const answer = await browser.call('PATCH', `${P}/settings`, {
      internal_links: {
        allowed_subdomains: [
          'Blog.EventusSecurity.com',
          'blog.eventussecurity.com',
          'WWW.eventussecurity.com',
          'eventussecurity.com',
        ],
      },
    });
    expect(SETTINGS.parse(answer.body).data.internal_links.allowed_subdomains).toEqual([
      'blog.eventussecurity.com',
      'www.eventussecurity.com',
      'eventussecurity.com',
    ]);
  });

  it('names the field and the code of a host that is not on the site, once for all of them', async () => {
    const browser = mockBrowser('editor');
    const answer = await browser.call('PATCH', `${P}/settings`, {
      internal_links: { allowed_subdomains: ['blog.other.com', 'noteventussecurity.com', 'shop.eventussecurity.com'] },
    });
    expect([answer.status, answer.code]).toEqual([422, 'validation_failed']);
    expect(answer.body.errors).toEqual([
      expect.objectContaining({ path: 'internal_links.allowed_subdomains', code: 'not_a_site_host' }),
    ]);
    expect(JSON.stringify(answer.body)).toContain('blog.other.com, noteventussecurity.com');
  });

  it('refuses what the API refuses', async () => {
    const browser = mockBrowser('editor');
    const bad: unknown[] = [
      {},
      { seo: null },
      { internal_links: null },
      { internal_links: {} },
      { internal_links: { schedule: null } },
      { internal_links: { schedule: 'daily' } },
      { internal_links: { render_javascript: 'sometimes' } },
      { internal_links: { allowed_subdomains: ['a b'] } },
      { internal_links: { allowed_subdomains: [''] } },
      {
        internal_links: {
          allowed_subdomains: Array.from({ length: 11 }, (_, n) => `s${String(n)}.eventussecurity.com`),
        },
      },
      { internal_links: { allowed_subdomains: ['blog.other.com'] } },
      { internal_links: { allowed_subdomains: ['noteventussecurity.com'] } },
      { internal_links: { cadence: 'weekly' } },
    ];
    for (const body of bad) {
      const answer = await browser.call('PATCH', `${P}/settings`, body);
      expect([JSON.stringify(body), answer.status, answer.code]).toEqual([
        JSON.stringify(body),
        422,
        'validation_failed',
      ]);
    }
  });

  it('lets a viewer read the settings and not change them', async () => {
    const answer = await mockBrowser('viewer').call('PATCH', `${P}/settings`, { internal_links: { schedule: 'off' } });
    expect(answer.status).toBe(403);
  });

  it('still takes the seo part alone', async () => {
    const answer = await mockBrowser('editor').call('PATCH', `${P}/settings`, { seo: { default_device: 'both' } });
    expect(answer.status).toBe(200);
  });
});
