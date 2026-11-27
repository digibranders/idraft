import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { PAGE_VIEWS } from '../internal-links-inventory';
import { setNoteFileLimit } from '../internal-links-notes';
import { EVENTUS, HISTORY_RUN_IDS, setLinksScenario } from '../internal-links-world';
import { mockBrowser } from '@/test/mock-api';
import type { PageView } from '@/lib/internal-links/types';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = `${W}/projects/${EVENTUS.project_id}`;
const ROWS = z.object({
  data: z.array(z.object({ path: z.string(), url_id: z.string(), tier: z.object({ code: z.string() }).nullable() })),
});
const GRAPH = z.object({ data: z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }) });
const TIERS = z.object({
  data: z.array(z.object({ tier_id: z.string(), code: z.string(), page_count: z.number() })),
});

describe('the internal links mock API', () => {
  it('answers the link graph of the latest crawl, with the auto-generated links only when asked', async () => {
    const browser = mockBrowser('viewer');
    const editorial = await browser.call('GET', `${P}/internal-links/graph?max_pages=3000`);
    const all = await browser.call('GET', `${P}/internal-links/graph?include_auto=true&max_pages=3000`);

    expect(editorial.status).toBe(200);
    expect(GRAPH.parse(editorial.body).data.nodes).toHaveLength(15);
    expect(GRAPH.parse(editorial.body).data.edges).toHaveLength(13);
    expect(GRAPH.parse(all.body).data.edges).toHaveLength(15);
  });

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

  it('answers ids as strings and takes them as strings, leaving out an id the crawl does not hold', async () => {
    const browser = mockBrowser('editor');
    const tiers = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const t4 = tiers.find((tier) => tier.code === 'T4')?.tier_id;
    const set = await browser.call('PUT', `${P}/pages/tiers`, {
      url_ids: ['111', '9223372036854775807'],
      tier_id: t4,
    });
    expect(set.body).toEqual({ data: { matched: 1, changed: 1 } });
    const blog = ROWS.parse((await browser.call('GET', `${P}/internal-links/pages?q=%2Fblog&sort=path&limit=100`)).body)
      .data[0];
    expect(blog).toEqual(
      expect.objectContaining({ path: '/blog', url_id: '111', tier: expect.objectContaining({ code: 'T4' }) }),
    );
    const detail = await browser.call('GET', `${P}/internal-links/pages/111?scope=editorial`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ links_available: true });
  });

  it('refuses a request id that is not a positive int64 digit string, as the API does', async () => {
    const browser = mockBrowser('editor');
    const tiers = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const t4 = tiers.find((tier) => tier.code === 'T4')?.tier_id;
    for (const bad of ['0', '01', '-1', 'abc', ' 7', '', '1.5', '9223372036854775808']) {
      const body = { url_ids: [bad], tier_id: t4 };
      expect([bad, (await browser.call('PUT', `${P}/pages/tiers`, body)).code]).toEqual([bad, 'validation_failed']);
      const path = `${P}/internal-links/pages/${encodeURIComponent(bad)}`;
      if (bad !== '') expect([bad, (await browser.call('GET', path)).status]).toEqual([bad, 422]);
    }
    const edges = await browser.call('GET', `${P}/internal-links/edges?filter[source]=9223372036854775807`);
    expect(edges.status).toBe(200);
    expect((await browser.call('GET', `${P}/internal-links/edges?filter[target]=0`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/internal-links/neighbors?url_id=007&direction=in`)).status).toBe(422);
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
    const site = 'https://eventussecurity.com';
    const bad = await browser.call('POST', `${P}/pages/tiers/import`, {
      csv: `url,tier\n${site}/pricing,T4\n${site}/about,T9\n`,
    });
    expect(bad.body).toMatchObject({
      data: { applied: false, errors: [{ line: 3, code: 'unknown_tier' }] },
    });
    // The header is needed, a path is not an address, and another site is not this one
    const headerless = await browser.call('POST', `${P}/pages/tiers/import`, { csv: `${site}/pricing,T4\n` });
    expect(headerless.body).toMatchObject({ data: { applied: false, errors: [{ line: 1, code: 'missing_column' }] } });
    const odd = await browser.call('POST', `${P}/pages/tiers/import`, {
      csv: `url,tier\n/pricing,T4\nhttps://other.example/x,T4\n`,
    });
    expect(odd.body).toMatchObject({
      data: {
        applied: false,
        errors: [
          { line: 2, code: 'invalid_url' },
          { line: 3, code: 'other_site' },
        ],
      },
    });
    const pricing = ROWS.parse((await browser.call('GET', `${P}/internal-links/pages?q=%2Fpricing&limit=100`)).body)
      .data[0];
    expect(pricing?.tier?.code).toBe('T1');
    const good = await browser.call('POST', `${P}/pages/tiers/import`, {
      csv: `url,tier\n${site}/pricing,T4\n${site}/nowhere,none\n`,
    });
    // `accepted` counts the row that waits for a crawl too, as the API does
    expect(good.body).toMatchObject({
      data: { applied: true, accepted: 2, pending: [{ line: 3, url: `${site}/nowhere` }] },
    });
  });

  it('checks a rule path with the API grammar, and the 500 rule cap, with the reason in errors', async () => {
    const browser = mockBrowser('editor');
    const tier = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data[0];
    const tier_id = tier?.tier_id ?? '';
    const refused = async (match_type: string, value: string): Promise<unknown> => {
      const answer = await browser.call('POST', `${P}/tier-rules`, { match_type, value, tier_id });
      expect(answer.status).toBe(422);
      return answer.body;
    };
    expect(await refused('prefix', 'pricing')).toMatchObject({
      errors: [{ path: 'value', code: 'starts_with_slash' }],
    });
    expect(await refused('exact', '/a*')).toMatchObject({ errors: [{ path: 'value', code: 'star_in_exact' }] });
    expect(await refused('prefix', '/a*')).toMatchObject({ errors: [{ path: 'value', code: 'star_in_prefix' }] });
    expect(await refused('pattern', `/${'a*'.repeat(11)}`)).toMatchObject({
      errors: [{ path: 'value', code: 'too_many_stars' }],
    });
    // The detail is the generic count, the reason is in the field error, as the API sends it
    const bad = await browser.call('POST', `${P}/tier-rules`, { match_type: 'exact', value: 'x', tier_id });
    expect(bad.body).toMatchObject({ errors: [{ message: 'A rule matches a path, which starts with `/`.' }] });
    // A patch is checked against the type the rule ends with
    const rules = z.object({ data: z.array(z.object({ rule_id: z.string(), match_type: z.string() })) });
    const first = rules
      .parse((await browser.call('GET', `${P}/tier-rules`)).body)
      .data.find((rule) => rule.match_type === 'prefix');
    const patched = await browser.call('PATCH', `${P}/tier-rules/${first?.rule_id ?? ''}`, { value: '/x*' });
    expect(patched.status).toBe(422);

    for (let count = 2; count < 500; count += 1) {
      expect(
        (await browser.call('POST', `${P}/tier-rules`, { match_type: 'exact', value: `/p${String(count)}`, tier_id }))
          .status,
      ).toBe(201);
    }
    const over = await browser.call('POST', `${P}/tier-rules`, { match_type: 'exact', value: '/over', tier_id });
    expect(over.body).toMatchObject({
      errors: [{ path: 'position', code: 'rule_limit', message: 'At most 500 rules.' }],
    });
  });

  it('takes the site and its www form in an import, and refuses other hosts as other_site', async () => {
    const browser = mockBrowser('editor');
    const csv = [
      'url,tier',
      'https://www.eventussecurity.com/pricing,T1',
      'http://eventussecurity.com/about,T3',
      'https://blog.eventussecurity.com/x,T1',
      'https://other.example/x,T1',
    ].join('\n');
    const answer = await browser.call('POST', `${P}/pages/tiers/import`, { csv });
    expect(answer.body).toMatchObject({
      data: {
        applied: false,
        errors: [
          { line: 4, code: 'other_site' },
          { line: 5, code: 'other_site' },
        ],
      },
    });
  });

  it('answers a request body over 1 MB with 413 before reading it', async () => {
    const answer = await mockBrowser('editor').call('POST', `${P}/pages/tiers/import`, {
      csv: `url,tier\n${'😀'.repeat(300_000)}`,
    });
    expect(answer.status).toBe(413);
  });

  it('answers the CSV downloads with the server columns in the server order, and no equity', async () => {
    const browser = mockBrowser('viewer');
    const pages = await browser.call('GET', `${P}/internal-links/pages?format=csv`);
    const links = await browser.call('GET', `${P}/internal-links/edges?format=csv`);
    expect(pages.status).toBe(200);
    expect(pages.headers.get('content-type')).toContain('text/csv');
    const pageLines = String(pages.body.text).trimEnd().split('\n');
    const linkLines = String(links.body.text).trimEnd().split('\n');
    // _PAGE_CSV_HEADER and _EDGE_CSV_HEADER of backend/src/idraft/api/internal_links/reads.py
    expect(pageLines[0]).toBe(
      'url,path,title,tier,status_code,indexable,click_depth,linking_pages,linking_pages_all,outlinks,in_sitemap,top_anchor,flags',
    );
    expect(linkLines[0]).toBe(
      'source_url,source_tier,target_url,target_tier,anchor,placement,scope,rel,target_status,target_indexable,occurrences',
    );
    expect(pageLines.length).toBeGreaterThan(1);
    expect(linkLines.length).toBeGreaterThan(1);
    expect(JSON.stringify([pages.body, links.body]).toLowerCase()).not.toContain('equity');
    // The tier is its label, as the server writes it, and a row has as many cells as the header
    expect(pageLines.find((line) => line.startsWith('https://eventussecurity.com/pricing,'))).toContain(
      ',T1 Money pages,',
    );
    for (const line of pageLines.slice(1)) expect(line.split(',').length).toBeGreaterThanOrEqual(13);
  });

  it('refuses a move_to that is the tier itself, or no tier of the workspace, before moving anything', async () => {
    const browser = mockBrowser('admin');
    const [first] = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    const id = first?.tier_id ?? '';
    const self = await browser.call('DELETE', `${W}/page-tiers/${id}?move_to=${id}`);
    expect([self.status, self.code]).toEqual([422, 'validation_failed']);
    expect(JSON.stringify(self.body)).toContain('move_to_self');
    const stranger = await browser.call('DELETE', `${W}/page-tiers/${id}?move_to=0192e4a0-2000-7000-8000-0000000000ff`);
    expect([stranger.status, stranger.code]).toEqual([404, 'not_found']);
    const after = TIERS.parse((await browser.call('GET', `${W}/page-tiers`)).body).data;
    expect(after.map((tier) => tier.tier_id)).toContain(id);
    expect(after[0]?.page_count).toBe(first?.page_count);
    // Moving to Untiered or to another tier still works
    expect((await browser.call('DELETE', `${W}/page-tiers/${id}?move_to=none`)).status).toBe(204);
  });

  it('applies the tier name and description rules of the API to create and rename', async () => {
    const browser = mockBrowser('admin');
    const tier = (name: unknown, description: unknown = '') =>
      browser.call('POST', `${W}/page-tiers`, { name, description });
    expect((await tier('   ')).code).toBe('validation_failed');
    expect((await tier('x'.repeat(61))).code).toBe('validation_failed');
    expect((await tier('Ok', 'y'.repeat(201))).code).toBe('validation_failed');
    expect((await tier('Bad\u0007name')).code).toBe('validation_failed');
    expect((await tier(7)).code).toBe('validation_failed');
    const made = await tier('  Landing pages  ', '  Paid landing pages  ');
    expect(made.body).toMatchObject({ data: { name: 'Landing pages', description: 'Paid landing pages' } });
    const id = z.object({ data: z.object({ tier_id: z.string() }) }).parse(made.body).data.tier_id;
    const patch = (body: unknown) => browser.call('PATCH', `${W}/page-tiers/${id}`, body);
    expect((await patch({})).code).toBe('validation_failed');
    expect((await patch({ name: null })).code).toBe('validation_failed');
    expect((await patch({ name: '' })).code).toBe('validation_failed');
    expect((await patch({ description: 'z'.repeat(201) })).code).toBe('validation_failed');
    expect((await patch({ colour: 'red' })).code).toBe('validation_failed');
    expect((await patch({ name: ' Pages ', description: '' })).body).toMatchObject({
      data: { name: 'Pages', description: '' },
    });
  });
});

const L = `${P}/internal-links`;
const OVERVIEW = z.object({
  data: z.object({
    status: z.object({
      live: z.number(),
      variant: z.number(),
      redirected: z.number(),
      client_error: z.number(),
      server_error: z.number(),
      blocked: z.number(),
      other: z.number(),
    }),
    indexable: z.number(),
    not_indexable: z.number(),
    reachable: z.number(),
    unreachable: z.number(),
    sitemap: z.object({
      indexable_in_sitemap: z.number().nullable(),
      indexable_missing: z.number().nullable(),
      listed_not_live: z.number().nullable(),
      listed_not_indexable: z.number().nullable(),
    }),
  }),
});
const TOTAL = z.object({ meta: z.object({ total: z.number() }) });
const SEARCH = z.object({
  data: z.object({
    state: z.string(),
    clicks: z.number().nullable(),
    days: z.array(z.object({ date: z.string(), clicks: z.number(), impressions: z.number() })),
  }),
});
const IMPRESSIONS = z.object({
  data: z.array(z.object({ path: z.string() })),
});

describe('the Pages overview, views and page reads of the mock API', () => {
  it('gives every view the number the overview shows for it', async () => {
    const browser = mockBrowser('viewer');
    const { data } = OVERVIEW.parse((await browser.call('GET', `${L}/overview`)).body);
    const expected: Record<PageView, number | null> = {
      live: data.status.live,
      indexable: data.indexable,
      not_indexable: data.not_indexable,
      redirects: data.status.redirected,
      errors: data.status.client_error + data.status.server_error,
      client_errors: data.status.client_error,
      server_errors: data.status.server_error,
      blocked: data.status.blocked,
      other: data.status.other,
      variants: data.status.variant,
      in_sitemap_indexable: data.sitemap.indexable_in_sitemap,
      not_in_sitemap: data.sitemap.indexable_missing,
      sitemap_not_live: data.sitemap.listed_not_live,
      sitemap_not_indexable: data.sitemap.listed_not_indexable,
      reachable: data.reachable,
      unreachable: data.unreachable,
    };
    for (const view of PAGE_VIEWS) {
      const answer = await browser.call('GET', `${L}/pages?filter[view]=${view}&limit=200`);
      expect([view, TOTAL.parse(answer.body).meta.total]).toEqual([view, expected[view]]);
    }
  });

  it('narrows the list by folder and by depth', async () => {
    const browser = mockBrowser('viewer');
    const folder = await browser.call('GET', `${L}/pages?filter[folder]=${encodeURIComponent('/blog/')}&limit=200`);
    expect(ROWS.parse(folder.body).data.map((row) => row.path)).toEqual([
      '/blog/soc-vs-mdr',
      '/blog/threat-report-2022',
      '/blog/vapt-checklist',
      '/blog/what-is-a-soc',
    ]);
    const top = await browser.call('GET', `${L}/pages?filter[folder]=${encodeURIComponent('/')}&limit=200`);
    expect(ROWS.parse(top.body).data.map((row) => row.path)).toContain('/blog');
    const zero = await browser.call('GET', `${L}/pages?filter[depth]=0&limit=200`);
    expect(ROWS.parse(zero.body).data.map((row) => row.path)).toEqual(['/']);
    expect((await browser.call('GET', `${L}/pages?filter[depth]=7`)).status).toBe(422);
  });

  it('refuses a view beside a worklist, and a view that is none', async () => {
    const browser = mockBrowser('viewer');
    expect((await browser.call('GET', `${L}/pages?filter[view]=live&filter[worklist]=orphans`)).status).toBe(422);
    expect((await browser.call('GET', `${L}/pages?filter[view]=nothing`)).status).toBe(422);
  });

  it('sorts by impressions, most first', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${L}/pages?sort=-impressions&limit=3`);
    expect(IMPRESSIONS.parse(answer.body).data.map((row) => row.path)).toEqual([
      '/blog/what-is-a-soc',
      '/',
      '/services/soc-as-a-service',
    ]);
  });

  it('answers the search of a page over 28 days that add up to its clicks', async () => {
    const answer = SEARCH.parse((await mockBrowser('viewer').call('GET', `${L}/pages/103/search`)).body).data;
    expect(answer.state).toBe('ok');
    expect(answer.days).toHaveLength(28);
    expect(answer.days.reduce((sum, day) => sum + day.clicks, 0)).toBe(answer.clicks);
  });

  it('answers the search as pending when Search Console has nothing yet', async () => {
    setLinksScenario({ gsc: 'pending' });
    const answer = SEARCH.parse((await mockBrowser('viewer').call('GET', `${L}/pages/103/search`)).body).data;
    expect(answer).toMatchObject({ state: 'pending', clicks: null, days: [] });
  });

  it('answers the outline of the latest crawl whatever crawl the screen shows, and 404 for an unknown page', async () => {
    const browser = mockBrowser('viewer');
    const latest = await browser.call('GET', `${L}/pages/102/outline`);
    expect(latest.body).toMatchObject({ data: { state: 'ok', run_id: HISTORY_RUN_IDS[0] } });
    expect((await browser.call('GET', `${L}/pages/9999/outline`)).status).toBe(404);
  });

  it('answers the history of a page, newest version first and ending in its first crawl, and 404 for an unknown page', async () => {
    const browser = mockBrowser('viewer');
    const answer = (await browser.call('GET', `${L}/pages/102/history`)).body as {
      data: { readable: boolean; versions: { kind: string; run_id: string }[]; first_seen: string };
    };
    expect(answer.data.readable).toBe(true);
    const kinds = answer.data.versions.map((version) => version.kind);
    expect(kinds.at(-1)).toBe('first');
    expect(kinds).toContain('content');
    expect(answer.data.versions.map((version) => version.run_id)).toEqual(
      expect.arrayContaining([HISTORY_RUN_IDS[0], HISTORY_RUN_IDS.at(-1)]),
    );
    expect((await browser.call('GET', `${L}/pages/9999/history`)).status).toBe(404);
  });

  it('answers 404 on the new routes to a member of another workspace', async () => {
    const browser = mockBrowser('viewer');
    const stranger = `/api/v1/workspaces/0192d1a8-0000-7000-8000-00000000dead/projects/${EVENTUS.project_id}/internal-links`;
    for (const tail of ['overview', 'pages/102/search', 'pages/102/outline']) {
      expect([tail, (await browser.call('GET', `${stranger}/${tail}`)).status]).toEqual([tail, 404]);
    }
  });
});

const NOTE = z.object({
  id: z.string(),
  body: z.string(),
  author: z.object({ id: z.string(), name: z.string() }),
  edited_at: z.string().nullable(),
  can_edit: z.boolean(),
  can_delete: z.boolean(),
});
const NOTES = z.object({
  data: z.array(NOTE),
  meta: z.object({ total: z.number(), limit: z.number(), has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
const NOTES_PATH = `${L}/pages/108/notes`;
const UNKNOWN_NOTE = '0192e4a0-0000-7000-8000-000000000000';

describe('the notes routes of the mock API', () => {
  const countOf = async (browser: ReturnType<typeof mockBrowser>): Promise<number | undefined> => {
    const detail = await browser.call('GET', `${L}/pages/108?scope=editorial`);
    return z.object({ data: z.object({ notes_count: z.number() }) }).parse(detail.body).data.notes_count;
  };

  it('lists the notes newest first, with what the caller may do, and pages them by cursor', async () => {
    const editor = mockBrowser('editor');
    const all = NOTES.parse((await editor.call('GET', NOTES_PATH)).body);
    expect(all.meta).toMatchObject({ total: 3, has_more: false, next_cursor: null });
    expect(all.data.some((note) => note.can_edit)).toBe(true);
    const viewer = NOTES.parse((await mockBrowser('viewer').call('GET', NOTES_PATH)).body);
    expect(viewer.data.every((note) => !note.can_edit && !note.can_delete)).toBe(true);

    const first = NOTES.parse((await editor.call('GET', `${NOTES_PATH}?limit=2`)).body);
    expect(first.data.map((note) => note.id)).toEqual(all.data.slice(0, 2).map((note) => note.id));
    expect(first.meta).toMatchObject({ limit: 2, has_more: true, total: 3 });
    const second = NOTES.parse(
      (await editor.call('GET', `${NOTES_PATH}?limit=2&cursor=${first.meta.next_cursor ?? ''}`)).body,
    );
    expect(second.data.map((note) => note.id)).toEqual(all.data.slice(2).map((note) => note.id));
    expect(second.meta.has_more).toBe(false);
    expect((await editor.call('GET', `${NOTES_PATH}?limit=0`)).status).toBe(422);
    expect((await editor.call('GET', `${NOTES_PATH}?limit=101`)).status).toBe(422);
  });

  it('adds a note with 201, trimmed, and the page detail count follows', async () => {
    const editor = mockBrowser('editor');
    expect(await countOf(editor)).toBe(3);
    const made = await editor.call('POST', NOTES_PATH, { body: '  Checked the title.  ' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ data: { body: 'Checked the title.', can_edit: true, can_delete: true } });
    expect(await countOf(editor)).toBe(4);
    expect(NOTES.parse((await editor.call('GET', NOTES_PATH)).body).data[0]?.body).toBe('Checked the title.');
  });

  it('stores the mentions of a note with the path of a page, and refuses an unknown target with the field named', async () => {
    const editor = mockBrowser('editor');
    const page = { type: 'page', label: '@/pricing', target: '108' };
    const made = await editor.call('POST', NOTES_PATH, { body: 'See @/pricing', mentions: [page] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ data: { mentions: [{ ...page, path: '/pricing' }] } });

    const refused = await editor.call('POST', NOTES_PATH, {
      body: 'See @/gone',
      mentions: [{ type: 'page', label: '@/gone', target: '999999' }],
    });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('mentions[0].target');
    expect(JSON.stringify(refused.body)).toContain('mention_target_unknown');
  });

  it('refuses a write by a viewer with 403 and a bad body with 422', async () => {
    expect((await mockBrowser('viewer').call('POST', NOTES_PATH, { body: 'x' })).status).toBe(403);
    const editor = mockBrowser('editor');
    for (const body of [{ body: '   ' }, { body: 'a'.repeat(2001) }, {}, { body: 'x', extra: 1 }]) {
      expect([JSON.stringify(body).slice(0, 20), (await editor.call('POST', NOTES_PATH, body)).status]).toEqual([
        JSON.stringify(body).slice(0, 20),
        422,
      ]);
    }
  });

  it('lets only the author change a note, with 200, and answers 404 for what is not there', async () => {
    const editor = mockBrowser('editor');
    const mine = NOTES.parse((await editor.call('GET', NOTES_PATH)).body).data.find((note) => note.can_edit);
    if (mine === undefined) throw new Error('no note of the editor');
    const changed = await editor.call('PATCH', `${NOTES_PATH}/${mine.id}`, { body: 'Rewritten' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ data: { body: 'Rewritten' } });
    expect(await editor.as('admin').call('PATCH', `${NOTES_PATH}/${mine.id}`, { body: 'Taken over' })).toMatchObject({
      status: 403,
    });
    expect((await editor.call('PATCH', `${NOTES_PATH}/${UNKNOWN_NOTE}`, { body: 'x' })).status).toBe(404);
    expect((await editor.call('PATCH', `${NOTES_PATH}/${mine.id}`, { body: '' })).status).toBe(422);
    expect((await editor.call('GET', `${L}/pages/9999/notes`)).status).toBe(404);
    expect((await editor.call('POST', `${L}/pages/9999/notes`, { body: 'x' })).status).toBe(404);
  });

  it('deletes with 204, lets an admin delete any note, and restores only for the one who deleted', async () => {
    const editor = mockBrowser('editor');
    const notes = NOTES.parse((await editor.call('GET', NOTES_PATH)).body).data;
    const theirs = notes.find((note) => !note.can_edit);
    if (theirs === undefined) throw new Error('no note of someone else');
    expect((await editor.call('DELETE', `${NOTES_PATH}/${theirs.id}`)).status).toBe(403);
    expect((await mockBrowser('viewer').call('DELETE', `${NOTES_PATH}/${theirs.id}`)).status).toBe(403);

    const admin = editor.as('admin');
    expect((await admin.call('DELETE', `${NOTES_PATH}/${theirs.id}`)).status).toBe(204);
    expect(await countOf(admin)).toBe(2);
    expect((await admin.call('DELETE', `${NOTES_PATH}/${theirs.id}`)).status).toBe(404);
    expect((await editor.call('POST', `${NOTES_PATH}/${theirs.id}/restore`)).status).toBe(403);
    const back = await admin.call('POST', `${NOTES_PATH}/${theirs.id}/restore`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ data: { id: theirs.id } });
    expect(await countOf(admin)).toBe(3);
    expect((await admin.call('POST', `${NOTES_PATH}/${theirs.id}/restore`)).status).toBe(404);
  });
});

const FILES_PATH = `${L}/pages/108/note-attachments`;
const STORED_FILE = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
    content_type: z.string(),
    is_image: z.boolean(),
    url: z.string(),
  }),
});

const formOf = (content: BlobPart, name: string, type: string): FormData => {
  const form = new FormData();
  form.append('file', new File([content], name, { type }));
  return form;
};

describe('the note file routes of the mock API', () => {
  const upload = async (
    browser: ReturnType<typeof mockBrowser>,
    content: BlobPart = 'hello',
    name = 'notes.txt',
    type = 'text/plain',
  ): Promise<z.infer<typeof STORED_FILE>['data']> => {
    const answer = await browser.call('POST', FILES_PATH, formOf(content, name, type));
    expect(answer.status).toBe(201);
    return STORED_FILE.parse(answer.body).data;
  };

  it('stores one file with 201 and answers its name, size, type and serving path', async () => {
    const stored = await upload(mockBrowser('editor'), 'a,b\n1,2', 'rows.csv');
    expect(stored).toMatchObject({ name: 'rows.csv', size: 7, content_type: 'text/csv', is_image: false });
    expect(stored.url).toBe(`${FILES_PATH}/${stored.id}`);
  });

  it('refuses what the API refuses: too big, a wrong type, empty, no file part, a viewer, an unknown page', async () => {
    const editor = mockBrowser('editor');
    const big = await editor.call(
      'POST',
      FILES_PATH,
      formOf(new Uint8Array(10 * 1024 * 1024 + 1), 'big.txt', 'text/plain'),
    );
    expect(big).toMatchObject({ status: 413, code: 'payload_too_large' });
    expect(big.body).toMatchObject({ limit_bytes: 10 * 1024 * 1024 });
    expect(await editor.call('POST', FILES_PATH, formOf('<html></html>', 'page.txt', 'text/plain'))).toMatchObject({
      status: 415,
      code: 'unsupported_media_type',
    });
    expect(await editor.call('POST', FILES_PATH, formOf('x', 'a.svg', 'image/svg+xml'))).toMatchObject({ status: 415 });
    const empty = await editor.call('POST', FILES_PATH, formOf('', 'empty.txt', 'text/plain'));
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body)).toContain('file_empty');
    const none = await editor.call('POST', FILES_PATH, new FormData());
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.body)).toContain('"path":"file"');
    expect(await editor.call('POST', FILES_PATH, { file: 'x' })).toMatchObject({ status: 415 });
    expect((await mockBrowser('viewer').call('POST', FILES_PATH, formOf('x', 'a.txt', 'text/plain'))).status).toBe(403);
    expect(
      (await editor.call('POST', `${L}/pages/9999/note-attachments`, formOf('x', 'a.txt', 'text/plain'))).status,
    ).toBe(404);
  });

  it('refuses a file past the workspace cap with the figures, orphans counted', async () => {
    setNoteFileLimit(10);
    const editor = mockBrowser('editor');
    await upload(editor, 'ninebytes');
    const over = await editor.call('POST', FILES_PATH, formOf('xx', 'two.txt', 'text/plain'));
    expect(over).toMatchObject({ status: 422, code: 'quota_exceeded' });
    expect(over.body).toMatchObject({ limit: 10, used: 9, requested: 2 });
  });

  it('attaches files by id to a note, serves them to a reader, and answers 404 for a file that is not live', async () => {
    const editor = mockBrowser('editor');
    const stored = await upload(editor);
    // Pending: nobody can read it yet
    expect((await editor.call('GET', stored.url)).status).toBe(404);

    const made = await editor.call('POST', NOTES_PATH, { body: '', attachment_ids: [stored.id] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ data: { body: '', attachments: [stored] } });
    const served = await mockBrowser('viewer').call('GET', stored.url);
    expect(served.status).toBe(200);
    expect(served.body).toEqual({ text: 'hello' });
    expect(served.headers.get('content-type')).toContain('text/plain');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await editor.call('GET', `${L}/pages/101/note-attachments/${stored.id}`)).status).toBe(404);

    const noteId = z.object({ data: z.object({ id: z.string() }) }).parse(made.body).data.id;
    const admin = editor.as('admin');
    expect((await editor.call('DELETE', `${NOTES_PATH}/${noteId}`)).status).toBe(204);
    expect((await admin.call('GET', stored.url)).status).toBe(404);
    expect((await editor.call('POST', `${NOTES_PATH}/${noteId}/restore`)).status).toBe(200);
    expect((await admin.call('GET', stored.url)).status).toBe(200);

    // A change that sends no list keeps the file; one that sends [] detaches it for good
    expect((await editor.call('PATCH', `${NOTES_PATH}/${noteId}`, { body: 'Now with text' })).body).toMatchObject({
      data: { attachments: [stored] },
    });
    const detached = await editor.call('PATCH', `${NOTES_PATH}/${noteId}`, {
      body: 'Now with text',
      attachment_ids: [],
    });
    expect(detached.body).toMatchObject({ data: { attachments: [] } });
    expect((await admin.call('GET', stored.url)).status).toBe(404);
  });

  it('refuses a note with neither text nor a file, a file of someone else, and a file that is attached already', async () => {
    const editor = mockBrowser('editor');
    const none = await editor.call('POST', NOTES_PATH, { body: ' ', attachment_ids: [] });
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.body)).toContain('body_required');

    const stored = await upload(editor);
    const foreign = await editor.as('admin').call('POST', NOTES_PATH, { body: 'x', attachment_ids: [stored.id] });
    expect(foreign.status).toBe(422);
    expect(JSON.stringify(foreign.body)).toContain('attachment_unavailable');
    expect((await editor.call('POST', NOTES_PATH, { body: 'x', attachment_ids: [stored.id] })).status).toBe(201);
    const twice = await editor.call('POST', NOTES_PATH, { body: 'y', attachment_ids: [stored.id] });
    expect(JSON.stringify(twice.body)).toContain('attachment_unavailable');
    const many = await editor.call('POST', NOTES_PATH, { body: 'z', attachment_ids: Array(6).fill(stored.id) });
    expect(JSON.stringify(many.body)).toContain('too_long');
  });
});
