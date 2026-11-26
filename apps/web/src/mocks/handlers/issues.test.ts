import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MOCK_WORKSPACE } from '../fixtures';
import { EVENTUS, HISTORY_RUN_IDS, setLinksScenario } from '../internal-links-world';
import { issueCheckIdValues } from '@/lib/api/schema';
import { CATEGORY_IDS } from '@/lib/issues/types';
import { fieldCodes, mockBrowser } from '@/test/mock-api';

const P = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${EVENTUS.project_id}`;
const CHECK = z.object({
  id: z.string(),
  tab: z.string(),
  category: z.string(),
  severity: z.enum(['error', 'warning', 'notice']),
  found_by: z.string(),
  state: z.string(),
  reason: z.string().nullable(),
  pages: z.number().nullable(),
  clicks: z.number().nullable(),
  example_path: z.string().nullable(),
});
const LIST = z.object({
  data: z.array(CHECK),
  summary: z.object({
    pages_crawled: z.number(),
    pages_with_issue: z.number(),
    pages_with_error: z.number(),
    pages_with_warning: z.number(),
    pages_with_notice: z.number(),
    checks_ran: z.number(),
    checks_passed: z.number(),
  }),
  meta: z.object({
    run_id: z.string(),
    links_available: z.boolean(),
    gsc: z.object({ state: z.string(), window_start: z.string().nullable(), window_end: z.string().nullable() }),
  }),
});
const PAGES = z.object({
  data: z.array(
    z.object({
      url_id: z.string(),
      path: z.string(),
      status_code: z.number().nullable(),
      extras: z
        .object({
          issue: z
            .object({
              target_path: z.string().nullish(),
              target_status: z.number().nullish(),
              count: z.number().nullish(),
              reason: z.string().nullish(),
            })
            .nullish(),
          gsc: z.object({ clicks: z.number().nullable() }).nullish(),
        })
        .nullish(),
    }),
  ),
  meta: z.object({ total: z.number() }),
});

const list = async (query = ''): Promise<z.infer<typeof LIST>> =>
  LIST.parse((await mockBrowser('viewer').call('GET', `${P}/issues${query}`)).body);
const checkOf = async (id: string): Promise<z.infer<typeof CHECK>> => {
  const found = (await list()).data.find((check) => check.id === id);
  if (found === undefined) throw new Error(`The list has no check ${id}`);
  return found;
};
const pagesOf = async (id: string, query = ''): Promise<z.infer<typeof PAGES>> =>
  PAGES.parse(
    (
      await mockBrowser('viewer').call(
        'GET',
        `${P}/internal-links/pages?filter[issue]=${id}&scope=all&sort=path${query}`,
      )
    ).body,
  );

describe('the Issues mock API: the list of checks', () => {
  it('answers the 29 checks in catalogue order', async () => {
    const answer = await list();
    expect(answer.data.map((check) => check.id)).toEqual(issueCheckIdValues);
    expect(answer.data.map((check) => check.tab)).toEqual([
      ...Array<string>(22).fill('technical'),
      ...Array<string>(7).fill('on_page'),
    ]);
  });

  it('counts the pages of a crawl check the way the pages list does', async () => {
    for (const id of ['status-4xx', 'links-to-redirect', 'title-short', 'orphans', 'noindex']) {
      const pages = await pagesOf(id);
      expect([id, (await checkOf(id)).pages]).toEqual([id, pages.meta.total]);
    }
    expect((await checkOf('status-4xx')).pages).toBe(1);
    expect((await checkOf('status-4xx')).example_path).toBe('/services/threat-hunting');
  });

  it('counts every check that ran as its pages list does, and builds the strip from those lists', async () => {
    const answer = await list();
    const idsOf = async (id: string): Promise<{ total: number; ids: string[] }> => {
      const pages = await pagesOf(id, '&limit=200');
      return { total: pages.meta.total, ids: pages.data.map((row) => row.url_id) };
    };
    const unions: Record<'all' | 'error' | 'warning' | 'notice', Set<string>> = {
      all: new Set(),
      error: new Set(),
      warning: new Set(),
      notice: new Set(),
    };
    for (const check of answer.data.filter((candidate) => candidate.state === 'ran')) {
      const { total, ids } = await idsOf(check.id);
      expect([check.id, total]).toEqual([check.id, check.pages]);
      expect([check.id, ids.length]).toEqual([check.id, total]);
      for (const id of ids) {
        unions.all.add(id);
        unions[check.severity].add(id);
      }
    }
    expect({
      pages_with_issue: unions.all.size,
      pages_with_error: unions.error.size,
      pages_with_warning: unions.warning.size,
      pages_with_notice: unions.notice.size,
    }).toEqual({
      pages_with_issue: answer.summary.pages_with_issue,
      pages_with_error: answer.summary.pages_with_error,
      pages_with_warning: answer.summary.pages_with_warning,
      pages_with_notice: answer.summary.pages_with_notice,
    });
  });

  it('gives every check a category the web has words for', async () => {
    const known: readonly string[] = CATEGORY_IDS;
    expect((await list()).data.filter((check) => !known.includes(check.category))).toEqual([]);
  });

  it('gives the five joined checks their states', async () => {
    const answer = await list();
    const state = (id: string): string | null | undefined => {
      const check = answer.data.find((candidate) => candidate.id === id);
      return check === undefined ? undefined : `${check.state}:${String(check.reason)}`;
    };
    expect(state('clicks-page-broken')).toBe('ran:null');
    expect(state('clicks-page-orphan')).toBe('ran:null');
    expect(state('rank-page-broken')).toBe('ran:null');
    expect(state('off-target')).toBe('ran:null');
    expect(state('cited-page-broken')).toBe('not_run:not_collected');
    expect(await checkOf('cited-page-broken')).toMatchObject({ pages: null, clicks: null, example_path: null });
  });

  it('sums the Search Console clicks of the pages of a check', async () => {
    expect(await checkOf('clicks-page-broken')).toMatchObject({
      pages: 1,
      clicks: 180,
      example_path: '/services/penetration-testing',
    });
  });

  it('totals the strip over the checks that ran, a page once', async () => {
    const answer = await list();
    const ran = answer.data.filter((check) => check.state === 'ran');
    expect(answer.summary.checks_ran).toBe(ran.length);
    expect(answer.summary.checks_passed).toBe(ran.filter((check) => check.pages === 0).length);
    expect(answer.summary.pages_crawled).toBe(18);
    const { pages_with_issue: any, pages_with_error: error, pages_with_warning: warning } = answer.summary;
    expect(any).toBeLessThanOrEqual(answer.summary.pages_crawled);
    expect(any).toBeGreaterThanOrEqual(Math.max(error, warning, answer.summary.pages_with_notice));
    expect(error).toBeGreaterThan(0);
  });

  it('carries the crawl and Search Console in meta', async () => {
    const { meta } = await list();
    expect(meta.run_id).toBe(HISTORY_RUN_IDS[0]);
    expect(meta.links_available).toBe(true);
    expect(meta.gsc.state).toBe('ok');
    expect(meta.gsc.window_start).not.toBeNull();
  });

  it('says why a Search Console check did not run, and leaves out its clicks', async () => {
    setLinksScenario({ gsc: 'not_connected' });
    expect(await checkOf('clicks-page-broken')).toMatchObject({
      state: 'not_run',
      reason: 'source_not_connected',
      pages: null,
      clicks: null,
    });
    expect((await checkOf('status-4xx')).clicks).toBeNull();
    expect((await list()).meta.gsc).toMatchObject({ state: 'not_connected', window_start: null });
    setLinksScenario({ gsc: 'pending' });
    expect(await checkOf('clicks-page-orphan')).toMatchObject({ state: 'not_run', reason: 'not_collected' });
  });

  it('says why nofollow-internal did not run on a crawl past the last four, and keeps its pages from being read', async () => {
    const oldest = HISTORY_RUN_IDS[4];
    const answer = await list(`?run=${String(oldest)}`);
    expect(answer.data.find((check) => check.id === 'nofollow-internal')).toMatchObject({
      state: 'not_run',
      reason: 'links_dropped',
      pages: null,
    });
    const pages = await mockBrowser('viewer').call(
      'GET',
      `${P}/internal-links/pages?filter[issue]=nofollow-internal&run=${String(oldest)}`,
    );
    expect([pages.status, pages.code]).toEqual([410, 'links_dropped']);
  });

  it('answers the CSV of the list', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/issues?format=csv`);
    expect(answer.status).toBe(200);
    const lines = String(answer.body.text).trim().split('\n');
    expect(lines[0]).toBe('Tab,Category,Check,Severity,Found by,State,Pages,Clicks');
    expect(lines).toHaveLength(30);
  });

  it('refuses a format it does not know, an unknown parameter and a crawl that is not there', async () => {
    const browser = mockBrowser('viewer');
    expect((await browser.call('GET', `${P}/issues?format=xml`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/issues?sort=path`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/issues?run=not-a-crawl`)).status).toBe(422);
    expect((await browser.call('GET', `${P}/issues?run=0192e4a0-1000-7000-8000-0000000000ff`)).code).toBe('not_found');
  });
});

describe('the Issues mock API: the pages of a check', () => {
  it('answers the detail of what was found with include=issue', async () => {
    const found = await pagesOf('status-4xx', '&include=issue,gsc');
    expect(found.data).toHaveLength(1);
    expect(found.data[0]).toMatchObject({
      path: '/services/threat-hunting',
      status_code: 404,
      extras: { issue: { count: 2 } },
    });
    const redirects = await pagesOf('redirect-pages', '&include=issue');
    expect(redirects.data[0]?.extras?.issue).toMatchObject({ target_path: '/services/vapt', target_status: 200 });
    const noindex = await pagesOf('noindex', '&include=issue');
    expect(noindex.data[0]?.extras?.issue).toMatchObject({ reason: 'meta_tag' });
  });

  it('leaves the detail null when the page list names no check, and the clicks with the gsc part', async () => {
    const browser = mockBrowser('viewer');
    const plain = PAGES.parse((await browser.call('GET', `${P}/internal-links/pages?include=issue&limit=1`)).body);
    expect(plain.data[0]?.extras?.issue ?? null).toBeNull();
    const clicks = await pagesOf('clicks-page-broken', '&include=issue,gsc');
    expect(clicks.data[0]?.extras?.gsc?.clicks).toBe(180);
    // A check with no detail still answers the four members, empty
    expect(clicks.data[0]?.extras?.issue).toEqual({
      target_path: null,
      target_status: null,
      count: null,
      reason: null,
    });
  });

  it('narrows a check by the search and pages it', async () => {
    const all = await pagesOf('title-short');
    expect(all.meta.total).toBeGreaterThan(2);
    const searched = await pagesOf('title-short', '&q=blog');
    expect(searched.data.every((row) => row.path.includes('blog'))).toBe(true);
    expect(searched.meta.total).toBeLessThan(all.meta.total);
    const first = await pagesOf('title-short', '&limit=2');
    expect(first.data).toHaveLength(2);
    expect(first.meta.total).toBe(all.meta.total);
  });

  it('finds nothing for a check that did not run, and for one that passed', async () => {
    expect((await pagesOf('cited-page-broken')).meta.total).toBe(0);
    expect((await pagesOf('status-5xx')).meta.total).toBe(0);
  });

  it('refuses an unknown check with a 422 on filter[issue]', async () => {
    const answer = await mockBrowser('viewer').call('GET', `${P}/internal-links/pages?filter[issue]=no-such-check`);
    expect(answer.status).toBe(422);
    expect(fieldCodes(answer)).toEqual(['filter[issue]:enum']);
  });

  it('adds the five columns of a check to the CSV', async () => {
    const answer = await mockBrowser('viewer').call(
      'GET',
      `${P}/internal-links/pages?filter[issue]=status-4xx&format=csv`,
    );
    const [header = '', row = ''] = String(answer.body.text).trim().split('\n');
    expect(header.endsWith(',Found address,Found status,Found count,Found reason,Clicks')).toBe(true);
    // The detail is a count of 2 linking pages, and the page has no clicks in the window
    expect(row.endsWith(',,,2,,0')).toBe(true);
  });
});
