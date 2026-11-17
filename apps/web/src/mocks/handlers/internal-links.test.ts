import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS } from '../internal-links-world';
import { mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = `${W}/projects/${EVENTUS.project_id}`;
const ROWS = z.object({
  data: z.array(z.object({ path: z.string(), url_id: z.string(), tier: z.object({ code: z.string() }).nullable() })),
});
const TIERS = z.object({
  data: z.array(z.object({ tier_id: z.string(), code: z.string(), page_count: z.number() })),
});

describe('the internal links mock API', () => {
  it('lists the latest crawl pages, with rule and manual tiers', async () => {
    const answer = await mockBrowser('editor').call(
      'GET',
      `${P}/internal-links/pages?scope=editorial&sort=path&limit=100`,
    );
    expect(answer.status).toBe(200);
    const rows = ROWS.parse(answer.body).data;
    expect(rows.find((row) => row.path === '/pricing')?.tier?.code).toBe('T1');
    expect(rows.find((row) => row.path === '/services/vapt')?.tier?.code).toBe('T1');
    expect(rows.find((row) => row.path === '/blog/soc-vs-mdr')?.tier?.code).toBe('T3');
  });

  it('answers ids as strings and takes them as numbers', async () => {
    const browser = mockBrowser('editor');
    const tiers = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const t4 = tiers.find((tier) => tier.code === 'T4')?.tier_id;
    const set = await browser.call('PUT', `${P}/pages/tiers`, { url_ids: [111], tier_id: t4 });
    expect(set.body).toEqual({ data: { matched: 1, changed: 1 } });
    const blog = ROWS.parse((await browser.call('GET', `${P}/internal-links/pages?q=%2Fblog&sort=path&limit=100`)).body)
      .data[0];
    expect(blog).toEqual(
      expect.objectContaining({ path: '/blog', url_id: '111', tier: expect.objectContaining({ code: 'T4' }) }),
    );
    const detail = await browser.call('GET', `${P}/internal-links/pages/111?scope=editorial`);
    expect(detail.status).toBe(200);
  });

  it('selects pages by filter, and a body with neither ids nor filter is refused', async () => {
    const browser = mockBrowser('editor');
    const tiers = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const t4 = tiers.find((tier) => tier.code === 'T4')?.tier_id;
    const set = await browser.call('PUT', `${P}/pages/tiers`, { filter: { status: ['4xx'] }, tier_id: t4 });
    expect(set.body).toEqual({ data: { matched: 1, changed: 1 } });
    expect((await browser.call('PUT', `${P}/pages/tiers`, { tier_id: t4 })).status).toBe(422);
  });

  it('answers one journey step with the other scopes counted for the group cards', async () => {
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${P}/internal-links/neighbors?url_id=101&direction=out&scope=editorial&limit=50`,
    );
    const body = z
      .object({
        data: z.array(z.object({ path: z.string() })),
        meta: z.object({
          total: z.number(),
          other_scopes: z.array(z.object({ scope: z.string(), pages: z.number() })),
        }),
      })
      .parse(answer.body);
    expect(body.data.map((row) => row.path)).toEqual([
      '/services/managed-detection-and-response',
      '/services/soc-as-a-service',
    ]);
    expect(body.meta.other_scopes).toEqual([{ scope: 'template', pages: 5 }]);
  });

  it('answers no_crawl for a project never crawled', async () => {
    const fynix = `${W}/projects/0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01`;
    const answer = await mockBrowser('editor').call('GET', `${fynix}/internal-links/worklists`);
    expect(answer.status).toBe(404);
    expect(answer.code).toBe('no_crawl');
  });

  it('refuses a ninth tier and a tier in use, as the API does', async () => {
    const browser = mockBrowser('admin');
    for (let index = 0; index < 4; index += 1) {
      expect(
        (await browser.call('POST', `${W}/page-tiers`, { name: `Extra ${String(index)}`, description: '' })).status,
      ).toBe(201);
    }
    expect((await browser.call('POST', `${W}/page-tiers`, { name: 'Ninth', description: '' })).code).toBe('tier_limit');
    const first = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data[0];
    const used = await browser.call('DELETE', `${W}/page-tiers/${first?.tier_id ?? ''}`);
    expect(used.code).toBe('tier_in_use');
  });

  it('checks the CSV import and applies nothing while a line has an error', async () => {
    const browser = mockBrowser('editor');
    const bad = await browser.call('POST', `${P}/pages/tiers/import`, { csv: 'url,tier\n/pricing,T4\n/about,T9\n' });
    expect(bad.body).toMatchObject({
      data: { applied: false, errors: [{ line: 3, code: 'unknown_tier' }] },
    });
    const pricing = ROWS.parse((await browser.call('GET', `${P}/internal-links/pages?q=%2Fpricing&limit=100`)).body)
      .data[0];
    expect(pricing?.tier?.code).toBe('T1');
    const good = await browser.call('POST', `${P}/pages/tiers/import`, { csv: 'url,tier\n/pricing,T4\n/nowhere,T2\n' });
    expect(good.body).toMatchObject({ data: { applied: true, accepted: 1, pending: [{ line: 3, url: '/nowhere' }] } });
  });

  it('keeps equity out of the CSV downloads', async () => {
    const browser = mockBrowser('viewer');
    const pages = await browser.call('GET', `${P}/internal-links/pages?format=csv`);
    const links = await browser.call('GET', `${P}/internal-links/edges?format=csv`);
    expect(pages.status).toBe(200);
    expect(pages.body.text).toEqual(expect.stringContaining('linking_pages'));
    expect(links.body.text).toEqual(expect.stringContaining('source_url'));
    expect(JSON.stringify([pages.body, links.body]).toLowerCase()).not.toContain('equity');
  });
});
