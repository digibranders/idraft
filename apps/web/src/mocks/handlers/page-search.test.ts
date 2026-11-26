import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { fillTracked, resetPageSearchWorld } from '../page-search-world';
import type { Schemas } from '@/lib/api/types';
import { dataOf, mockBrowser, type MockBrowser } from '@/test/mock-api';

/**
 * The seven routes of `fp/tracked-pages` and `fp/page-search` of the mock. Answers are read through strict shapes
 * declared against the generated types, so a member the mock leaves out or adds fails the parse.
 */
const NUMBERS: z.ZodType<Schemas['PageNumbers']> = z.strictObject({
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
});
const HEALTH: z.ZodType<Schemas['PageHealth']> = z.strictObject({
  verdict: z.enum(['no_data', 'new', 'lost', 'low_data', 'sharp_drop', 'declining', 'growing', 'stable']),
  basis: z.enum(['clicks', 'impressions']),
  change: z.number().nullable(),
  absolute: z.number(),
  small: z.boolean(),
  flags: z.array(z.string()),
});
const WINDOW = z.strictObject({ from: z.string(), to: z.string(), days: z.number() });
const QUERIES: z.ZodType<Schemas['PageQueries']> = z.strictObject({
  value: z.number(),
  previous: z.number().nullable(),
  capped: z.boolean(),
});
const CANNIBALIZATION: z.ZodType<Schemas['PageCannibalization']> = z.strictObject({
  keywords: z.number(),
  likely: z.number(),
  co_ranking: z.number(),
  unstable: z.number(),
});
const STATE = z.enum(['ok', 'pending', 'not_connected', 'reauth_required', 'no_access']);
const ROW: z.ZodType<Schemas['TrackedPageRow']> = z.strictObject({
  url_id: z.string(),
  url: z.string(),
  path: z.string(),
  title: z.string().nullable(),
  tier_id: z.string().nullable(),
  added_at: z.string(),
  history: z.enum(['ready', 'loading']),
  current: NUMBERS.nullable(),
  previous: NUMBERS.nullable(),
  health: HEALTH.nullable(),
  queries: QUERIES.nullable(),
  cannibalization: CANNIBALIZATION.nullable(),
  trend: z.array(z.number()).nullable(),
});
const LIST: z.ZodType<Schemas['TrackedPagesResponse']> = z.strictObject({
  data: z.array(ROW),
  meta: z.strictObject({
    state: STATE,
    property: z.string().nullable(),
    final_through: z.string().nullable(),
    window: WINDOW.nullable(),
    compare_window: WINDOW.nullable(),
    limit: z.number(),
    tracked: z.number(),
  }),
});
const POINT: z.ZodType<Schemas['SeriesPoint']> = z.strictObject({
  date: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  position: z.number().nullable(),
});
const DETAIL: z.ZodType<Schemas['PageSearchResponse']> = z.strictObject({
  data: z.strictObject({
    url_id: z.string(),
    url: z.string(),
    path: z.string(),
    title: z.string().nullable(),
    tier_id: z.string().nullable(),
    tracked: z.boolean(),
    current: NUMBERS.nullable(),
    previous: NUMBERS.nullable(),
    health: HEALTH.nullable(),
    series: z.array(POINT),
    previous_series: z.array(POINT),
  }),
  meta: z.strictObject({
    state: STATE,
    property: z.string().nullable(),
    final_through: z.string().nullable(),
    window: WINDOW.nullable(),
    compare_window: WINDOW.nullable(),
    history_from: z.string().nullable(),
    retry_after: z.number().nullable(),
  }),
});
const OUTCOMES = z.strictObject({
  data: z.array(
    z.strictObject({
      input: z.string(),
      outcome: z.string(),
      url_id: z.string().nullable(),
      path: z.string().nullable(),
      clicks_28d: z.number().nullable(),
    }),
  ),
  meta: z.strictObject({ limit: z.number(), tracked: z.number(), added: z.number() }),
});
const BREAKDOWN = z.strictObject({
  data: z.array(z.strictObject({ key: z.string(), current: NUMBERS.nullable(), previous: NUMBERS.nullable() })),
  meta: z.strictObject({
    state: STATE,
    property: z.string().nullable(),
    final_through: z.string().nullable(),
    dimension: z.string(),
    window: WINDOW.nullable(),
    compare_window: WINDOW.nullable(),
    row_limit: z.number(),
    truncated: z.boolean(),
    coverage: z.number().nullable(),
    fetched_at: z.string().nullable(),
  }),
});
const SUGGESTIONS = z.strictObject({
  data: z.array(
    z.strictObject({
      url_id: z.string(),
      url: z.string(),
      path: z.string(),
      title: z.string().nullable(),
      clicks_28d: z.number(),
      impressions_28d: z.number(),
    }),
  ),
  meta: z.strictObject({ state: STATE }),
});

/** Thursday 26 November 2026, noon UTC: Pacific Time is the 26th, so the last final day is the 23rd. */
const NOW = Date.parse('2026-11-26T12:00:00Z');
const fynix = MOCK_PROJECTS.find((project) => project.slug === 'fynix');
if (fynix === undefined) throw new Error('The fixture project Fynix is missing');
const PROJECT = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${fynix.project_id}`;
const TRACKED = `${PROJECT}/fp/tracked-pages`;
const OCTOBER = 'from=2026-10-01&to=2026-10-31';

/** The owner links a Search Console property of Fynix, through the routes the integrations page uses. */
async function linkSearchConsole(browser: MockBrowser): Promise<void> {
  const started = await browser.call('POST', `${PROJECT}/integrations/google/authorize`, {});
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const data = z.object({ authorization_url: z.string() }).parse(started.body.data);
  const connectionId = new URL(data.authorization_url).searchParams.get('connection_id');
  const linked = await browser.call('POST', `${PROJECT}/integrations`, {
    connection_id: connectionId,
    kind: 'gsc',
    external_property: 'sc-domain:fynix.digital',
  });
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
}

async function connected(): Promise<MockBrowser> {
  const browser = mockBrowser('owner');
  await linkSearchConsole(browser);
  return browser;
}

async function list(browser: MockBrowser, query = ''): Promise<Schemas['TrackedPagesResponse']> {
  const answer = await browser.call('GET', `${TRACKED}${query === '' ? '' : `?${query}`}`);
  expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  return LIST.parse(answer.body);
}

beforeEach(() => {
  resetPageSearchWorld();
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the tracked pages list of the mock', () => {
  it('lists the tracked pages with no numbers while Search Console is not linked', async () => {
    const answer = await list(mockBrowser('owner'));
    expect(answer.data).toHaveLength(8);
    expect(answer.meta).toMatchObject({ state: 'not_connected', window: null, compare_window: null, tracked: 8 });
    for (const row of answer.data) {
      expect(row).toMatchObject({ current: null, previous: null, health: null, trend: null, queries: null });
    }
  });

  it('answers eight rows over the last full month, ordered by path, once Search Console is linked', async () => {
    const answer = await list(await connected());
    expect(answer.meta).toMatchObject({
      state: 'ok',
      property: 'sc-domain:fynix.digital',
      final_through: '2026-11-23',
      window: { from: '2026-10-01', to: '2026-10-31', days: 31 },
      compare_window: { from: '2026-09-01', to: '2026-09-30', days: 30 },
      limit: 200,
      tracked: 8,
    });
    const paths = answer.data.map((row) => row.path);
    expect(paths).toEqual([...paths].sort());
    expect(answer.data[0]?.url).toMatch(/^https:\/\/fynix\.digital\//);
    const verdicts = answer.data.map((row) => row.health?.verdict);
    expect(verdicts).toEqual(
      expect.arrayContaining(['declining', 'sharp_drop', 'growing', 'stable', 'low_data', 'lost']),
    );
  });

  it('gives a row that is still loading no numbers, and gives it back once its detail was opened', async () => {
    const browser = await connected();
    const before = await list(browser);
    const loading = before.data.find((row) => row.history === 'loading');
    expect(loading).toMatchObject({ current: null, previous: null, health: null, trend: null });
    const opened = await browser.call('GET', `${PROJECT}/fp/page-search/${loading?.url_id ?? ''}?${OCTOBER}`);
    expect(DETAIL.parse(opened.body).data.current).not.toBeNull();
    const after = await list(browser);
    expect(after.data.find((row) => row.url_id === loading?.url_id)?.history).toBe('ready');
  });

  it('carries the trend of each day, and no previous with no comparison', async () => {
    const browser = await connected();
    const answer = await list(browser, `${OCTOBER}&compare=none`);
    const ready = answer.data.filter((row) => row.history === 'ready');
    for (const row of ready) {
      expect(row.trend).toHaveLength(31);
      expect(row.previous).toBeNull();
    }
    expect(answer.meta.compare_window).toBeNull();
  });

  it('counts queries for a whole month: the capped page at its cap, the empty page at 0, the unstored page null', async () => {
    const answer = await list(await connected());
    const queries = answer.data.map((row) => row.queries);
    expect(queries).toContainEqual({ value: 25000, previous: null, capped: true });
    expect(queries).toContainEqual(expect.objectContaining({ value: 0, capped: false }));
    expect(queries.filter((one) => one === null)).toHaveLength(1);
    for (const one of queries) {
      if (one !== null && !one.capped) expect(one.previous).not.toBeNull();
    }
  });

  it('has queries null for a seven day period, and no previous queries with no comparison or a year back', async () => {
    const browser = await connected();
    const week = await list(browser, 'from=2026-11-10&to=2026-11-16');
    for (const row of week.data) expect(row.queries).toBeNull();
    for (const compare of ['none', 'previous_year']) {
      const answer = await list(browser, `${OCTOBER}&compare=${compare}`);
      for (const row of answer.data) expect(row.queries?.previous ?? null).toBeNull();
    }
  });

  it('has cannibalization null on every row, and filled on three with ?mock=cannibalization', async () => {
    const browser = await connected();
    const plain = await list(browser);
    expect(plain.data.every((row) => row.cannibalization === null)).toBe(true);
    const filled = await list(browser, 'mock=cannibalization');
    const withCounts = filled.data.flatMap((row) => (row.cannibalization ? [row.cannibalization] : []));
    expect(withCounts).toHaveLength(3);
    expect(withCounts.some((one) => one.likely > 0)).toBe(true);
    expect(withCounts.some((one) => one.likely === 0 && one.co_ranking > 0)).toBe(true);
    expect(withCounts.some((one) => one.keywords === 0)).toBe(true);
    for (const one of withCounts) expect(one.likely + one.co_ranking + one.unstable).toBe(one.keywords);
  });

  it('refuses a period of more than 92 days, a bad choice and a query it does not have', async () => {
    const browser = await connected();
    expect((await browser.call('GET', `${TRACKED}?from=2026-01-01&to=2026-11-11`)).code).toBe('window_too_large');
    expect((await browser.call('GET', `${TRACKED}?compare=weekly`)).code).toBe('validation_failed');
    expect((await browser.call('GET', `${TRACKED}?surprise=1`)).code).toBe('validation_failed');
  });
});

describe('tracking and untracking', () => {
  it('adds a new path, then lists nine, and says so again for the same page', async () => {
    const browser = await connected();
    const added = OUTCOMES.parse(
      (await browser.call('POST', TRACKED, { urls: ['/services/pentest'], url_ids: [], dry_run: false })).body,
    );
    expect(added.data[0]).toMatchObject({ input: '/services/pentest', outcome: 'added', path: '/services/pentest' });
    expect(added.meta).toMatchObject({ added: 1, tracked: 9, limit: 200 });
    expect((await list(browser)).data).toHaveLength(9);
    const again = OUTCOMES.parse((await browser.call('POST', TRACKED, { urls: ['/services/pentest'] })).body);
    expect(again.data[0]?.outcome).toBe('already_tracked');
    expect(again.meta.added).toBe(0);
  });

  it('answers one outcome per input, in order', async () => {
    const browser = await connected();
    const answer = OUTCOMES.parse(
      (
        await browser.call('POST', TRACKED, {
          urls: ['https://other.example/x', 'not a url ::', '/never-crawled'],
          dry_run: true,
        })
      ).body,
    );
    expect(answer.data.map((row) => row.outcome)).toEqual(['wrong_host', 'invalid_url', 'not_crawled']);
    expect(answer.meta.added).toBe(0);
  });

  it('writes nothing with dry_run, and says ok for a page that would be added', async () => {
    const browser = await connected();
    const answer = OUTCOMES.parse(
      (await browser.call('POST', TRACKED, { urls: ['/services/pentest'], dry_run: true })).body,
    );
    expect(answer.data[0]?.outcome).toBe('ok');
    expect((await list(browser)).data).toHaveLength(8);
  });

  it('answers over_limit once the world is filled to its limit', async () => {
    const browser = await connected();
    fillTracked(fynix.project_id, 200);
    const answer = OUTCOMES.parse((await browser.call('POST', TRACKED, { urls: ['/services/pentest'] })).body);
    expect(answer.data[0]?.outcome).toBe('over_limit');
    expect(answer.meta).toMatchObject({ added: 0, tracked: 200 });
  });

  it('adds by url id and stops tracking', async () => {
    const browser = await connected();
    const suggestion = dataOf(await browser.call('GET', `${TRACKED}/suggestions`), SUGGESTIONS.shape.data)[0];
    expect(suggestion).toBeDefined();
    const added = OUTCOMES.parse((await browser.call('POST', TRACKED, { url_ids: [suggestion?.url_id] })).body);
    expect(added.data[0]).toMatchObject({ outcome: 'added', url_id: suggestion?.url_id });
    const rows = (await list(browser)).data;
    const removed = await browser.call('POST', `${TRACKED}/remove`, {
      url_ids: rows.slice(0, 2).map((row) => row.url_id),
    });
    expect(removed.body).toEqual({ data: { removed: 2 } });
    expect((await list(browser)).data).toHaveLength(7);
  });

  it('lets a viewer read but not write', async () => {
    const owner = await connected();
    const viewer = owner.as('viewer');
    expect((await viewer.call('GET', TRACKED)).status).toBe(200);
    expect((await viewer.call('POST', TRACKED, { urls: ['/services/pentest'] })).status).toBe(403);
    expect((await viewer.call('POST', `${TRACKED}/remove`, { url_ids: ['1'] })).status).toBe(403);
  });

  it('lists the ids and the 25 untracked pages with the most clicks, most first', async () => {
    const browser = await connected();
    const ids = z
      .strictObject({ data: z.array(z.string()), meta: z.strictObject({ limit: z.number() }) })
      .parse((await browser.call('GET', `${TRACKED}/ids`)).body);
    expect(ids.data).toHaveLength(8);
    expect(ids.meta.limit).toBe(200);
    const suggestions = SUGGESTIONS.parse((await browser.call('GET', `${TRACKED}/suggestions`)).body);
    expect(suggestions.data.length).toBeGreaterThan(0);
    expect(suggestions.data.some((row) => ids.data.includes(row.url_id))).toBe(false);
    const clicks = suggestions.data.map((row) => row.clicks_28d);
    expect(clicks).toEqual([...clicks].sort((a, b) => b - a));
  });
});

describe('the page search routes of the mock', () => {
  it('answers a detail whose totals are the sum of its series', async () => {
    const browser = await connected();
    const [row] = (await list(browser)).data.filter(
      (one) => one.history === 'ready' && one.health?.verdict === 'declining',
    );
    const answer = DETAIL.parse(
      (await browser.call('GET', `${PROJECT}/fp/page-search/${row?.url_id ?? ''}?${OCTOBER}`)).body,
    );
    const { data, meta } = answer;
    expect(data.series).toHaveLength(31);
    expect(data.previous_series).toHaveLength(30);
    expect(data.current?.clicks).toBe(data.series.reduce((sum, point) => sum + point.clicks, 0));
    expect(data.current?.impressions).toBe(data.series.reduce((sum, point) => sum + point.impressions, 0));
    expect(data.previous?.clicks).toBe(data.previous_series.reduce((sum, point) => sum + point.clicks, 0));
    expect(data.current).toEqual(row?.current);
    expect(data.health).toEqual(row?.health);
    expect(meta).toMatchObject({ state: 'ok', window: { from: '2026-10-01', to: '2026-10-31' }, retry_after: null });
    expect(meta.history_from).not.toBeNull();
  });

  it('answers a page that is not tracked, and not_found for one that is not a page of the project', async () => {
    const browser = await connected();
    const suggestion = dataOf(await browser.call('GET', `${TRACKED}/suggestions`), SUGGESTIONS.shape.data)[0];
    const detail = DETAIL.parse(
      (await browser.call('GET', `${PROJECT}/fp/page-search/${suggestion?.url_id ?? ''}?${OCTOBER}`)).body,
    );
    expect(detail.data.tracked).toBe(false);
    expect((await browser.call('GET', `${PROJECT}/fp/page-search/999999999?${OCTOBER}`)).code).toBe('not_found');
    expect((await browser.call('GET', `${PROJECT}/fp/page-search/999999999/breakdown?dimension=query`)).code).toBe(
      'not_found',
    );
  });

  it('answers no numbers and no series while Search Console is not linked', async () => {
    const browser = mockBrowser('owner');
    const [row] = (await list(browser)).data;
    const answer = DETAIL.parse((await browser.call('GET', `${PROJECT}/fp/page-search/${row?.url_id ?? ''}`)).body);
    expect(answer.meta).toMatchObject({ state: 'not_connected', window: null, history_from: null });
    expect(answer.data).toMatchObject({ current: null, previous: null, health: null, series: [], previous_series: [] });
  });

  it('splits the clicks over the queries to 88 percent, and over locations and devices to all of them', async () => {
    const browser = await connected();
    const [row] = (await list(browser)).data.filter(
      (one) => one.history === 'ready' && one.health?.verdict === 'stable',
    );
    const total = row?.current?.clicks ?? 0;
    const read = async (dimension: string): Promise<z.infer<typeof BREAKDOWN>> =>
      BREAKDOWN.parse(
        (
          await browser.call(
            'GET',
            `${PROJECT}/fp/page-search/${row?.url_id ?? ''}/breakdown?dimension=${dimension}&${OCTOBER}`,
          )
        ).body,
      );
    const sumOf = (answer: z.infer<typeof BREAKDOWN>): number =>
      answer.data.reduce((sum, one) => sum + (one.current?.clicks ?? 0), 0);
    const queries = await read('query');
    expect(queries.meta).toMatchObject({ dimension: 'query', row_limit: 100, truncated: false });
    expect(queries.meta.coverage).toBeCloseTo(0.88, 1);
    expect(sumOf(queries) / total).toBeCloseTo(0.88, 1);
    const countries = await read('country');
    expect(sumOf(countries)).toBe(total);
    expect(countries.data.map((one) => one.key)).toEqual(expect.arrayContaining(['USA', 'IND', 'GBR', 'DEU']));
    expect(sumOf(await read('device'))).toBe(total);
    const clicks = countries.data.map((one) => one.current?.clicks ?? 0);
    expect(clicks).toEqual([...clicks].sort((a, b) => b - a));
  });

  it('answers 429 gsc_busy with the wait for ?mock=busy', async () => {
    const browser = await connected();
    const [row] = (await list(browser)).data;
    const answer = await browser.call(
      'GET',
      `${PROJECT}/fp/page-search/${row?.url_id ?? ''}/breakdown?dimension=query&mock=busy`,
    );
    expect(answer.status).toBe(429);
    expect(answer.code).toBe('gsc_busy');
    expect(answer.headers.get('retry-after')).toBe('20');
    expect(answer.body.retry_after_seconds).toBe(20);
  });

  it('answers a detail with no numbers and a wait for ?mock=busy, and keeps a loading page loading', async () => {
    const browser = await connected();
    const loading = (await list(browser)).data.find((row) => row.history === 'loading');
    const answer = DETAIL.parse(
      (await browser.call('GET', `${PROJECT}/fp/page-search/${loading?.url_id ?? ''}?${OCTOBER}&mock=busy`)).body,
    );
    expect(answer.data).toMatchObject({ current: null, health: null, series: [] });
    expect(answer.meta).toMatchObject({ state: 'ok', history_from: null, retry_after: 20 });
    expect((await list(browser)).data.find((row) => row.url_id === loading?.url_id)?.history).toBe('loading');
  });

  it('refuses a dimension it does not have', async () => {
    const browser = await connected();
    const [row] = (await list(browser)).data;
    const answer = await browser.call('GET', `${PROJECT}/fp/page-search/${row?.url_id ?? ''}/breakdown?dimension=page`);
    expect(answer.code).toBe('validation_failed');
  });
});
