import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS, HISTORY_RUN_IDS, setLinksScenario } from '../internal-links-world';
import { fieldCodes, mockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const P = `${W}/projects/${EVENTUS.project_id}`;
const L = `${P}/internal-links`;
const LATEST = HISTORY_RUN_IDS[0];
const OLDEST = HISTORY_RUN_IDS[4];
const UNKNOWN_RUN = '0192e4a0-1000-7000-8000-0000000000ff';

const SUMMARY = z.object({
  data: z.object({
    run_id: z.string(),
    state: z.string(),
    editorial_lost: z.number(),
    lost_to_top: z.number(),
    alert: z
      .object({
        lost_links: z.number(),
        channel: z.string(),
        max_position: z.number(),
        threshold: z.number(),
        delivery_state: z.string(),
      })
      .nullable(),
  }),
});
const LINKS = z.object({
  data: z.array(z.object({ priority: z.string(), target: z.object({ path: z.string() }) })),
  meta: z.object({ total: z.number(), run_id: z.string() }),
});
const PAGES = z.object({
  data: z.array(
    z.object({ path: z.string(), url_id: z.string(), extras: z.record(z.string(), z.unknown()).nullish() }),
  ),
  meta: z.object({ run_id: z.string(), links_available: z.boolean(), total: z.number() }),
});

describe('the changes routes of the mock API', () => {
  it('answers the summary with the state and the alert for links lost to important pages', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${L}/changes/summary`);
    expect(answer.status).toBe(200);
    const { data } = SUMMARY.parse(answer.body);
    expect(data).toMatchObject({ run_id: LATEST, state: 'ready', editorial_lost: 6, lost_to_top: 5 });
    expect(data.alert).toEqual({
      lost_links: 5,
      channel: 'app',
      max_position: 2,
      threshold: 1,
      delivery_state: 'shown_in_app',
    });
  });

  it('takes the crawl from `run`: latest, a crawl id, 404 for one the project does not have, 422 for no id', async () => {
    const browser = mockBrowser('viewer');
    expect(SUMMARY.parse((await browser.call('GET', `${L}/changes/summary?run=latest`)).body).data.run_id).toBe(LATEST);
    const older = SUMMARY.parse((await browser.call('GET', `${L}/changes/summary?run=${OLDEST}`)).body).data;
    expect(older).toMatchObject({ run_id: OLDEST, state: 'first_crawl' });
    const unknown = await browser.call('GET', `${L}/changes/summary?run=${UNKNOWN_RUN}`);
    expect([unknown.status, unknown.code]).toEqual([404, 'not_found']);
    const bad = await browser.call('GET', `${L}/changes/summary?run=yesterday`);
    expect([bad.status, fieldCodes(bad)]).toEqual([422, ['run:uuid_parsing']]);
    expect((await browser.call('GET', `${L}/changes/summary?other=1`)).status).toBe(422);
  });

  it('answers the state of a crawl whose changes are not worked out: pending, unavailable, first_crawl', async () => {
    const browser = mockBrowser('viewer');
    setLinksScenario({ enrich: 'running' });
    expect(SUMMARY.parse((await browser.call('GET', `${L}/changes/summary`)).body).data.state).toBe('pending');
    setLinksScenario({ enrich: 'failed' });
    expect(SUMMARY.parse((await browser.call('GET', `${L}/changes/summary`)).body).data.state).toBe('unavailable');
    setLinksScenario({ enrich: 'done', firstCrawl: true });
    expect(SUMMARY.parse((await browser.call('GET', `${L}/changes/summary`)).body).data.state).toBe('first_crawl');
  });

  it('lists lost links, important targets first, and only those with only=top', async () => {
    const browser = mockBrowser('viewer');
    const lost = LINKS.parse((await browser.call('GET', `${L}/changes/links?change=lost`)).body);
    expect(lost.meta).toMatchObject({ total: 6, run_id: LATEST });
    expect(lost.data.map((row) => row.priority)).toEqual([
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t1',
      'lost_to_t2',
      'lower',
    ]);
    const top = LINKS.parse((await browser.call('GET', `${L}/changes/links?change=lost&only=top&limit=2`)).body);
    expect(top.data).toHaveLength(2);
    expect(top.meta.total).toBe(5);
    const added = LINKS.parse((await browser.call('GET', `${L}/changes/links?change=added&link_scope=all`)).body);
    expect(added.meta.total).toBe(2);
  });

  it('answers an empty page, not an error, for an offset beyond the total', async () => {
    const browser = mockBrowser('viewer');
    const beyond = LINKS.parse((await browser.call('GET', `${L}/changes/links?change=lost&offset=100`)).body);
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.total).toBe(6);
    const opportunities = await browser.call('GET', `${L}/opportunities?offset=100`);
    expect(opportunities.status).toBe(200);
    expect(opportunities.body.data).toEqual([]);
    expect(opportunities.body.meta).toMatchObject({ total: 8 });
  });

  it('refuses a missing or unknown change, scope, window or format with the field named', async () => {
    const browser = mockBrowser('viewer');
    expect(fieldCodes(await browser.call('GET', `${L}/changes/links`))).toEqual(['change:missing']);
    const bad = await browser.call(
      'GET',
      `${L}/changes/links?change=gone&link_scope=some&only=few&limit=500&format=xml`,
    );
    expect(fieldCodes(bad).sort()).toEqual(
      ['change:enum', 'format:enum', 'limit:value_error', 'link_scope:enum', 'only:enum'].sort(),
    );
  });

  it('writes the lost links as CSV with the server columns', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${L}/changes/links?change=lost&format=csv`);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toContain('text/csv');
    expect(answer.headers.get('content-disposition')).toContain('internal-links-lost.csv');
    const lines = String(answer.body.text).trimEnd().split('\n');
    expect(lines[0]).toBe('Change,Source,Target,Anchor,Link type,Target tier,Still linked from');
    expect(lines).toHaveLength(7);
    expect(lines[1]?.startsWith('Lost,')).toBe(true);
  });

  it('answers the pages that moved most, capped at 50', async () => {
    const browser = mockBrowser('viewer');
    const moved = z
      .object({ data: z.array(z.object({ equity_points: z.number().nullable() })) })
      .parse((await browser.call('GET', `${L}/changes/pages?limit=3`)).body);
    expect(moved.data).toHaveLength(3);
    expect(moved.data.every((row) => row.equity_points === null)).toBe(true);
    expect(fieldCodes(await browser.call('GET', `${L}/changes/pages?limit=51`))).toEqual(['limit:value_error']);
  });

  it('answers 410 links_dropped for the link lists of a crawl past the last four, and still the summary', async () => {
    const browser = mockBrowser('viewer');
    const gone = await browser.call('GET', `${L}/changes/links?change=lost&run=${OLDEST}`);
    expect([gone.status, gone.code]).toEqual([410, 'links_dropped']);
    expect((await browser.call('GET', `${L}/changes/summary?run=${OLDEST}`)).status).toBe(200);
    expect((await browser.call('GET', `${L}/changes/pages?run=${OLDEST}`)).status).toBe(200);
  });

  it('answers 404 no_crawl for a project with no finished crawl, and refuses a stranger', async () => {
    const fynix = `${W}/projects/0192d1a8-9a01-7b44-8c2d-1f0e9d8c7b01/internal-links/changes/summary`;
    const none = await mockBrowser('viewer').call('GET', fynix);
    expect([none.status, none.code]).toEqual([404, 'no_crawl']);
    const stranger = await mockBrowser('viewer').call(
      'GET',
      `${W}/projects/0192e4a0-9000-7000-8000-0000000000ff/internal-links/changes/summary`,
    );
    expect(stranger.status).toBe(404);
  });
});

describe('the pages routes with the crawl history', () => {
  it('adds only the parts asked for with include, and nothing without it', async () => {
    const browser = mockBrowser('viewer');
    const plain = PAGES.parse((await browser.call('GET', `${L}/pages?sort=path&limit=100`)).body);
    expect(plain.data.every((row) => row.extras === undefined)).toBe(true);
    const rich = PAGES.parse(
      (await browser.call('GET', `${L}/pages?include=keywords,gsc,changes&sort=path&limit=100`)).body,
    );
    const soc = rich.data.find((row) => row.path === '/services/soc-as-a-service');
    expect(Object.keys(soc?.extras ?? {}).sort()).toEqual(['change', 'gsc', 'keywords']);
    expect(rich.meta).toMatchObject({ run_id: LATEST, links_available: true });
    expect(fieldCodes(await browser.call('GET', `${L}/pages?include=keywords,equity`))).toEqual(['include:enum']);
  });

  it('filters the generic anchors flag and the two new worklists, and sorts by change', async () => {
    const browser = mockBrowser('viewer');
    const generic = PAGES.parse((await browser.call('GET', `${L}/pages?filter[flags]=generic_anchors`)).body);
    expect(generic.data.map((row) => row.path)).toEqual(['/contact']);
    const lost = PAGES.parse((await browser.call('GET', `${L}/pages?filter[worklist]=lost_links_top&sort=path`)).body);
    expect(lost.data.map((row) => row.path)).toEqual([
      '/contact',
      '/pricing',
      '/services',
      '/services/managed-detection-and-response',
      '/services/soc-as-a-service',
    ]);
    const weak = PAGES.parse((await browser.call('GET', `${L}/pages?filter[worklist]=weak_outlinks`)).body);
    expect(weak.data.map((row) => row.path)).toEqual(['/services/vapt']);
    const rising = PAGES.parse((await browser.call('GET', `${L}/pages?sort=-change&limit=2`)).body);
    expect(rising.data[0]?.path).toBe('/services/vapt');
    const falling = PAGES.parse((await browser.call('GET', `${L}/pages?sort=change&limit=100`)).body);
    expect(falling.data[0]?.path).toBe('/blog/threat-report-2022');
  });

  it('counts the two new worklists', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${L}/worklists`);
    expect(answer.body.data).toMatchObject({ run_id: LATEST, lost_links_top: 5, weak_outlinks: 1 });
  });

  it('answers a page with every extra, and the not-compared answer when the crawl has no previous one', async () => {
    const browser = mockBrowser('viewer');
    const id = '103';
    const detail = z
      .object({
        data: z.object({
          extras: z.object({
            change: z.object({ is_new: z.boolean() }).nullable(),
            gsc: z.object({ state: z.string() }),
          }),
        }),
      })
      .parse((await browser.call('GET', `${L}/pages/${id}`)).body);
    expect(detail.data.extras.change).not.toBeNull();
    expect(detail.data.extras.gsc.state).toBe('ok');
    setLinksScenario({ firstCrawl: true, gsc: 'pending' });
    const first = z
      .object({
        data: z.object({
          extras: z.object({ change: z.null(), gsc: z.object({ state: z.string(), clicks: z.null() }) }),
        }),
      })
      .parse((await browser.call('GET', `${L}/pages/${id}`)).body);
    expect(first.data.extras.gsc.state).toBe('pending');
  });

  it('keeps the pages of a crawl without links readable, with no anchors, and gives its detail without link lists', async () => {
    const browser = mockBrowser('viewer');
    const pages = PAGES.parse((await browser.call('GET', `${L}/pages?run=${OLDEST}&include=anchors&limit=100`)).body);
    expect(pages.meta).toMatchObject({ run_id: OLDEST, links_available: false });
    expect(pages.data.every((row) => row.extras?.anchors === null)).toBe(true);
    const detail = await browser.call('GET', `${L}/pages/103?run=${OLDEST}`);
    expect(detail.body.data).toMatchObject({ linking_pages: [], outlinks: [], linking_pages_total: 0 });
    const weak = await browser.call('GET', `${L}/pages?run=${OLDEST}&filter[worklist]=weak_outlinks`);
    expect([weak.status, weak.code]).toEqual([410, 'links_dropped']);
    expect((await browser.call('GET', `${L}/worklists?run=${OLDEST}`)).body.data).toMatchObject({ weak_outlinks: 0 });
  });

  it('answers 410 links_dropped for the edges, neighbors and paths of such a crawl, and a stale tier flow', async () => {
    const browser = mockBrowser('viewer');
    for (const tail of ['edges', 'neighbors?url_id=101&direction=out', 'paths?url_id=103']) {
      const joiner = tail.includes('?') ? '&' : '?';
      const answer = await browser.call('GET', `${L}/${tail}${joiner}run=${OLDEST}`);
      expect([tail, answer.status, answer.code]).toEqual([tail, 410, 'links_dropped']);
    }
    const flow = await browser.call('GET', `${L}/tier-flow?run=${OLDEST}`);
    expect(flow.body.data).toMatchObject({ run_id: OLDEST, stale: true });
    expect((await browser.call('GET', `${L}/tier-flow?run=${HISTORY_RUN_IDS[3]}`)).body.data).toMatchObject({
      stale: false,
    });
    expect((await browser.call('GET', `${L}/edges?run=${HISTORY_RUN_IDS[3]}`)).status).toBe(200);
    expect((await browser.call('GET', `${L}/edges?run=${UNKNOWN_RUN}`)).status).toBe(404);
  });

  it('answers 410 for every link level read of the latest crawl when its links were dropped', async () => {
    setLinksScenario({ latestLinksDropped: true });
    const browser = mockBrowser('viewer');
    // The stored flow of the latest crawl is stale only when the stored flag says so (tiers changed), not by age
    expect((await browser.call('GET', `${L}/tier-flow`)).body.data).toMatchObject({ run_id: LATEST, stale: false });
    expect((await browser.call('GET', `${L}/edges`)).code).toBe('links_dropped');
    expect((await browser.call('GET', `${L}/changes/links?change=lost`)).code).toBe('links_dropped');
    expect((await browser.call('GET', `${L}/opportunities`)).code).toBe('links_dropped');
    expect((await browser.call('GET', `${P}/link-crawls`)).body.data).toMatchObject([
      { links_available: false },
      {},
      {},
      {},
      {},
    ]);
  });
});

describe('the opportunity routes', () => {
  it('lists the opportunities with the counts, and filters them', async () => {
    const browser = mockBrowser('viewer');
    const all = z
      .object({
        data: z.array(z.object({ key: z.string(), source_equity_share: z.null() })),
        meta: z.object({ total: z.number(), counts: z.object({ open: z.number() }) }),
      })
      .parse((await browser.call('GET', `${L}/opportunities`)).body);
    expect(all.meta).toMatchObject({ total: 8, counts: { open: 8 } });
    const tier = await browser.call('GET', `${L}/opportunities?filter[target_tier]=none&q=blog`);
    expect(tier.body.meta).toMatchObject({ total: 1 });
    expect(
      fieldCodes(await browser.call('GET', `${L}/opportunities?filter[target_tier]=9&status=done`)).sort(),
    ).toEqual(['filter[target_tier]:string_pattern_mismatch', 'status:enum']);
  });

  it('writes the filtered list and the planned fixes as CSV', async () => {
    const browser = mockBrowser('editor');
    const listed = await browser.call('GET', `${L}/opportunities?format=csv&filter[target_tier]=1`);
    expect(listed.headers.get('content-type')).toContain('text/csv');
    expect(String(listed.body.text).trimEnd().split('\n')).toHaveLength(6);
    const key = z.object({
      data: z.array(z.object({ source: z.object({ url_id: z.string() }), target: z.object({ url_id: z.string() }) })),
    });
    const [first] = key.parse((await browser.call('GET', `${L}/opportunities`)).body).data;
    if (first === undefined) throw new Error('no opportunity');
    await browser.call('PUT', `${L}/opportunities/decisions`, {
      items: [{ source_url_id: first.source.url_id, target_url_id: first.target.url_id }],
      status: 'accepted',
    });
    const planned = await browser.call('GET', `${L}/opportunities?export=planned`);
    expect(planned.headers.get('content-disposition')).toContain('internal-links-planned-fixes.csv');
    expect(String(planned.body.text).trimEnd().split('\n')).toHaveLength(2);
  });

  it('records a decision for an editor, refuses a viewer, and validates the body', async () => {
    const editor = mockBrowser('editor');
    const pair = { source_url_id: '112', target_url_id: '104' };
    const refused = await mockBrowser('viewer').call('PUT', `${L}/opportunities/decisions`, {
      items: [pair],
      status: 'dismissed',
    });
    expect([refused.status, refused.code]).toEqual([403, 'forbidden']);
    const done = await editor.call('PUT', `${L}/opportunities/decisions`, { items: [pair], status: 'dismissed' });
    expect(done.body.data).toEqual({ matched: 1, changed: 1 });
    const counts = (await editor.call('GET', `${L}/opportunities`)).body.meta;
    expect(counts).toMatchObject({ counts: { open: 7, dismissed: 1 } });
    expect(
      fieldCodes(await editor.call('PUT', `${L}/opportunities/decisions`, { items: [], status: 'x' })).sort(),
    ).toEqual(['items:too_short', 'status:enum']);
    expect(
      fieldCodes(
        await editor.call('PUT', `${L}/opportunities/decisions`, {
          items: [{ source_url_id: '01', target_url_id: '2' }],
          status: 'open',
        }),
      ),
    ).toEqual(['items.0.source_url_id:value_error']);
  });
});

describe('the tier suggestion and path routes', () => {
  it('lists the suggestions and sets a tier by hand when one is accepted: the row of Pages changes', async () => {
    const editor = mockBrowser('editor');
    const listed = z
      .object({
        data: z.array(z.object({ url_id: z.string(), path: z.string() })),
        meta: z.object({ gsc_state: z.string() }),
      })
      .parse((await editor.call('GET', `${L}/tier-suggestions`)).body);
    expect(listed.meta.gsc_state).toBe('ok');
    expect(listed.data.map((row) => row.path)).toEqual(['/blog', '/blog/soc-vs-mdr', '/blog/what-is-a-soc']);
    const refused = await mockBrowser('viewer').call('POST', `${L}/tier-suggestions/accept`, { all: true });
    expect(refused.status).toBe(403);
    const accepted = await editor.call('POST', `${L}/tier-suggestions/accept`, { url_ids: ['113'] });
    expect(accepted.body.data).toEqual({ matched: 1, changed: 1 });
    const row = z
      .object({
        data: z.array(
          z.object({ tier: z.object({ code: z.string() }).nullable(), tier_source: z.string().nullable() }),
        ),
      })
      .parse((await editor.call('GET', `${L}/pages?q=soc-vs-mdr`)).body).data[0];
    expect(row).toEqual({ tier: expect.objectContaining({ code: 'T2' }), tier_source: 'manual' });
  });

  it('dismisses suggestions, and wants ids or all, not both and not neither', async () => {
    const editor = mockBrowser('editor');
    const dismissed = await editor.call('POST', `${L}/tier-suggestions/dismiss`, { all: true });
    expect(dismissed.body.data).toEqual({ matched: 3, changed: 3 });
    expect((await editor.call('GET', `${L}/tier-suggestions`)).body.data).toEqual([]);
    for (const body of [{}, { all: true, url_ids: ['1'] }]) {
      const answer = await editor.call('POST', `${L}/tier-suggestions/dismiss`, body);
      expect([answer.status, fieldCodes(answer)]).toEqual([422, [':value_error']]);
    }
    expect(fieldCodes(await editor.call('POST', `${L}/tier-suggestions/accept`, { url_ids: ['0'] }))).toEqual([
      'url_ids.0:value_error',
    ]);
  });

  it('finds the route to a page over every link and over editorial links', async () => {
    const browser = mockBrowser('viewer');
    const routes = z
      .object({
        data: z.object({
          target: z.object({ path: z.string() }),
          any: z.object({ clicks: z.number() }).nullable(),
          editorial: z.unknown(),
        }),
      })
      .parse((await browser.call('GET', `${L}/paths?url_id=114`)).body).data;
    expect(routes.target.path).toBe('/blog/vapt-checklist');
    expect(routes.any?.clicks).toBe(2);
    expect(routes.editorial).toBeNull();
    expect((await browser.call('GET', `${L}/paths?url_id=999`)).status).toBe(404);
    expect((await browser.call('GET', `${L}/paths?url_id=0`)).status).toBe(422);
    expect(fieldCodes(await browser.call('GET', `${L}/paths`))).toEqual(['url_id:missing']);
  });
});

describe('the alert rules in the project settings', () => {
  it('answers the backend defaults and merges a patch member by member', async () => {
    const editor = mockBrowser('editor');
    const defaults = await editor.call('GET', `${P}/settings`);
    expect(defaults.body.data).toMatchObject({
      internal_links: { alerts: { enabled: true, max_position: 2, threshold: 1, channel: 'app' } },
    });
    await editor.call('PATCH', `${P}/settings`, { internal_links: { alerts: { threshold: 5 } } });
    const second = await editor.call('PATCH', `${P}/settings`, { internal_links: { alerts: { max_position: 1 } } });
    expect(second.body.data).toMatchObject({
      internal_links: { alerts: { enabled: true, max_position: 1, threshold: 5, channel: 'app' } },
    });
    // The summary follows the rules
    const summary = SUMMARY.parse((await editor.call('GET', `${L}/changes/summary`)).body).data;
    expect(summary).toMatchObject({ lost_to_top: 4, alert: null });
  });

  it('refuses email and Slack with the reason in the field error and a generic detail', async () => {
    const editor = mockBrowser('editor');
    for (const channel of ['email', 'slack']) {
      const refused = await editor.call('PATCH', `${P}/settings`, { internal_links: { alerts: { channel } } });
      expect([refused.status, refused.code]).toEqual([422, 'validation_failed']);
      expect(fieldCodes(refused)).toEqual(['internal_links.alerts.channel:value_error']);
      expect(JSON.stringify(refused.body.errors)).toContain('channel_unavailable');
      expect(refused.body.detail).toBe('1 field is invalid.');
    }
    const kept = await editor.call('GET', `${P}/settings`);
    expect(kept.body.data).toMatchObject({ internal_links: { alerts: { channel: 'app' } } });
  });

  it('checks the other alert members and an empty patch', async () => {
    const editor = mockBrowser('editor');
    const bad = await editor.call('PATCH', `${P}/settings`, {
      internal_links: { alerts: { enabled: 'yes', max_position: 9, threshold: 0, channel: 'sms', extra: 1 } },
    });
    expect(fieldCodes(bad).sort()).toEqual(
      [
        'internal_links.alerts.channel:enum',
        'internal_links.alerts.enabled:bool_type',
        'internal_links.alerts.extra:extra_forbidden',
        'internal_links.alerts.max_position:less_than_equal',
        'internal_links.alerts.threshold:greater_than_equal',
      ].sort(),
    );
    expect(fieldCodes(await editor.call('PATCH', `${P}/settings`, { internal_links: { alerts: {} } }))).toEqual([
      'internal_links.alerts:value_error',
    ]);
    expect(fieldCodes(await editor.call('PATCH', `${P}/settings`, { internal_links: { alerts: null } }))).toEqual([
      'internal_links.alerts:null_not_allowed',
    ]);
  });
});
