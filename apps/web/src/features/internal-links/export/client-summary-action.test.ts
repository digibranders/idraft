// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildClientSummary, type BuildClientSummaryOptions } from './client-summary-action';
import { crawlInView } from '@/lib/internal-links/crawl-choice';
import type { ClientSummaryWords } from '@/lib/internal-links/client-summary';
import type { TierFlow } from '@/lib/internal-links/types';
import { MOCK_WORKSPACE, mockUser } from '@/mocks/fixtures';
import { crawlsOf, EVENTUS, HISTORY_RUN_IDS, tierFlow } from '@/mocks/internal-links-world';
import { mswPath } from '@/mocks/respond';
import { SESSION_COOKIE } from '@/mocks/session';
import { server } from '@/test/msw';

const BASE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/internal-links';
const FLOW = mswPath(`${BASE}/tier-flow`);
const LINKS = mswPath(`${BASE}/changes/links`);
const SUMMARY = mswPath(`${BASE}/changes/summary`);
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: EVENTUS.project_id };
const PROBLEM = { 'content-type': 'application/problem+json' };

const words: ClientSummaryWords = {
  title: (host) => `Internal links summary for ${host}`,
  crawlLine: (when, pages) => `Crawl of ${when}, ${String(pages)} pages.`,
  olderNote: 'This summary is of an older crawl.',
  lostUnavailable: (reason) => (reason === 'dropped' ? 'The links are not stored.' : 'Nothing to compare.'),
  tiersHeading: 'Pages by tier',
  tiersHead: ['Tier', 'Pages', 'Share of pages', 'Average depth'],
  flowHeading: 'Links between tiers',
  flowNote: 'Editorial links.',
  flowFrom: 'From',
  flowTo: (code) => `To ${code}`,
  worklistsHeading: 'Open worklists',
  worklistsHead: ['Worklist', 'Count'],
  worklistsNone: 'Nothing open.',
  lostHeading: (tiers) => `Lost editorial links to ${tiers} pages`,
  lostHead: ['Source page', 'Target page', 'Anchor'],
  lostNone: () => 'No links lost.',
  lostMore: (count) => `Plus ${count} more.`,
  footer: 'Counts use editorial links.',
  notAvailable: 'n/a',
  tierPair: (a, b) => `${a} and ${b}`,
  tierRange: (a, b) => `${a} to ${b}`,
};

const options = (run: string | null = null): BuildClientSummaryOptions => ({
  client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  scope: SCOPE,
  view: crawlInView(crawlsOf(EVENTUS.project_id), run),
  host: 'eventussecurity.com',
  timeZone: 'UTC',
  locale: 'en',
  words,
  labels: {
    untiered: 'Untiered',
    worklist: (key) => (key === 'under_linked_t1' ? 'Under-linked T1 pages' : key),
  },
});

beforeEach(() => {
  document.cookie = `${SESSION_COOKIE}=mock.active.${mockUser('editor').user_id}.${String(Date.now() + 600_000)}; Path=/; Secure`;
});

describe('the client summary page', () => {
  it('holds the host, the tiers, the worklists and a lost link of the world, and no equity or dash', async () => {
    const html = await buildClientSummary(options());
    expect(html).toContain('eventussecurity.com');
    expect(html).toContain('T1 ');
    expect(html).toContain('Under-linked T1 pages');
    expect(html).toContain('Lost editorial links to T1 and T2 pages');
    expect(html).toMatch(/<td[^>]*>\/[^<]+<\/td><td[^>]*>\/[^<]+<\/td><td[^>]*>[^<]+<\/td>/);
    expect(html.toLowerCase()).not.toContain('equity');
    expect(html).not.toMatch(/[—–]/);
    expect(html).not.toContain('older crawl');
  });

  it('escapes a hostile tier name and host', async () => {
    const nasty = '<script>alert(1)</script>';
    const real = tierFlow('editorial');
    const hostile: TierFlow = {
      ...real,
      tiers: real.tiers.map((stat, index) =>
        index === 0 && stat.tier !== null ? { ...stat, tier: { ...stat.tier, name: nasty } } : stat,
      ),
    };
    server.use(http.get(FLOW, () => HttpResponse.json({ data: hostile })));
    const html = await buildClientSummary({ ...options(), host: nasty });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('says so for an older crawl and reads with its run id', async () => {
    const asked: string[] = [];
    server.events.on('request:start', ({ request }) => asked.push(request.url));
    const run = HISTORY_RUN_IDS[2] ?? '';
    const html = await buildClientSummary(options(run));
    server.events.removeAllListeners();
    expect(html).toContain('This summary is of an older crawl.');
    expect(asked.filter((url) => url.includes('/internal-links/')).every((url) => url.includes(`run=${run}`))).toBe(
      true,
    );
  });

  it('builds the page without the lost links when that read answers 410', async () => {
    server.use(
      http.get(LINKS, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Gone', status: 410, code: 'links_dropped' },
          { status: 410, headers: PROBLEM },
        ),
      ),
    );
    const html = await buildClientSummary(options());
    expect(html).toContain('The links are not stored.');
    expect(html).toContain('Pages by tier');
  });

  it('makes no lost read when the previous crawl kept no links, or there is no previous crawl', async () => {
    const lostReads: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/changes/links')) lostReads.push(request.url);
    });
    // The fourth newest crawl is compared with the fifth, whose links are dropped; the fifth has nothing before it
    const dropped = await buildClientSummary(options(HISTORY_RUN_IDS[3] ?? ''));
    const first = await buildClientSummary(options(HISTORY_RUN_IDS[4] ?? ''));
    server.events.removeAllListeners();
    expect(lostReads).toEqual([]);
    expect(dropped).toContain('The links are not stored.');
    expect(first).toContain('Nothing to compare.');
  });

  it('rejects when a read fails', async () => {
    server.use(http.get(SUMMARY, () => HttpResponse.json({ title: 'Broken' }, { status: 500, headers: PROBLEM })));
    await expect(buildClientSummary(options())).rejects.toBeDefined();
  });
});
