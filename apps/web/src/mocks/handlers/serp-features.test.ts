import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_ENTITY_IDS } from '../entity-fixtures';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { clearManualChecks } from '../serp-world';
import { AIO_HISTORY, SERP_FEATURE_HISTORY, SERP_SNAPSHOT_DETAIL, SERP_SNAPSHOT_PAGE } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, type Answer, type MockBrowser } from '@/test/mock-api';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix] = MOCK_PROJECTS;
if (!fynix) throw new Error('The Fynix project fixture is missing');
const P = `${W}/projects/${fynix.project_id}`;

const trackedId = (text: string): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) => row.text === text && row.location === 2276 && row.device === 'desktop',
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};

const berlin = trackedId('seo agency berlin');
const ERRORS = z.object({
  errors: z.array(z.object({ location: z.string(), path: z.string(), code: z.string() })),
});

/** `from` for a window that has exactly `days` days up to `to`. */
const fromOf = (to: string, days: number): string =>
  new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);

const featuresOf = async (browser: MockBrowser, id: string, query = '') =>
  dataOf(await browser.call('GET', `${P}/tracked-keywords/${id}/serp-features${query}`), SERP_FEATURE_HISTORY);

const snapshotRows = async (browser: MockBrowser, id: string) =>
  SERP_SNAPSHOT_PAGE.parse((await browser.call('GET', `${P}/tracked-keywords/${id}/serp-snapshots?limit=50`)).body)
    .data;

describe('serp-features', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    clearManualChecks();
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });

  it('T6: answers the 30 newest checks by default, newest first, and limit_checks cuts from the newest', async () => {
    const browser = mockBrowser('viewer');
    const byDefault = await featuresOf(browser, berlin);
    expect(byDefault.checks).toHaveLength(30);
    const times = byDefault.checks.map((c) => c.observed_at);
    expect(times).toEqual([...times].sort().reverse());
    expect(new Set(times).size).toBe(30);

    const snapshots = await snapshotRows(browser, berlin);
    expect(byDefault.checks.map((c) => c.serp_snapshot_id)).toEqual(snapshots.map((s) => s.serp_snapshot_id));

    const five = await featuresOf(browser, berlin, '?limit_checks=5');
    expect(five.checks).toHaveLength(5);
    expect(five.checks).toEqual(byDefault.checks.slice(0, 5));

    // The mock keeps 30 checks, so a larger limit gives the same 30
    expect((await featuresOf(browser, berlin, '?limit_checks=200')).checks).toHaveLength(30);
    expect((await featuresOf(browser, berlin, '?limit_checks=1')).checks).toHaveLength(1);

    for (const bad of ['0', '201']) {
      const res = await browser.call('GET', `${P}/tracked-keywords/${berlin}/serp-features?limit_checks=${bad}`);
      expect(res.status).toBe(422);
      expect(fieldCodes(res)).toEqual(['limit_checks:value_error']);
    }
  });

  it('T6: from and to keep the checks of those project local days', async () => {
    const browser = mockBrowser('viewer');
    const snapshots = await snapshotRows(browser, berlin);
    const expected = snapshots
      .filter((s) => s.observed_date >= '2026-10-15' && s.observed_date <= '2026-10-24')
      .map((s) => s.serp_snapshot_id);
    expect(expected.length).toBeGreaterThan(3);
    expect(expected.length).toBeLessThan(snapshots.length);

    const windowed = await featuresOf(browser, berlin, '?from=2026-10-15&to=2026-10-24');
    expect(windowed.checks.map((c) => c.serp_snapshot_id)).toEqual(expected);
    // The rates count the checks of the window
    expect(windowed.presence.length).toBeGreaterThan(0);
    for (const p of windowed.presence) expect(p.presence_rate.denominator).toBe(expected.length);
  });

  it('T6: filter[feature_type_in] keeps the listed features, and a check with none of them has an empty list', async () => {
    const browser = mockBrowser('viewer');
    const all = await featuresOf(browser, berlin);
    const rare = [...all.presence]
      .filter((p) => (p.presence_rate.numerator ?? 0) > 0)
      .sort((a, b) => (a.presence_rate.numerator ?? 0) - (b.presence_rate.numerator ?? 0))[0];
    const rareType = rare?.feature_type ?? '';
    expect(rareType).toMatch(/\S/);
    expect(rare?.presence_rate.numerator ?? 0).toBeLessThan(all.checks.length);

    const filtered = await featuresOf(browser, berlin, `?filter[feature_type_in]=${rareType}`);
    expect(filtered.checks.map((c) => c.serp_snapshot_id)).toEqual(all.checks.map((c) => c.serp_snapshot_id));
    expect(filtered.checks.map((c) => c.features)).toEqual(
      all.checks.map((c) => c.features.filter((f) => f.feature_type === rareType)),
    );
    expect(filtered.presence.map((p) => p.feature_type)).toEqual([rareType]);
    const empty = filtered.checks.filter((c) => c.features.length === 0);
    const withFeature = filtered.checks.filter((c) => c.features.length > 0);
    expect(empty.length).toBeGreaterThan(0);
    expect(withFeature.length).toBe(rare?.presence_rate.numerator);
    // Features were taken out of the unfiltered list
    expect(all.checks.flatMap((c) => c.features).length).toBeGreaterThan(withFeature.length);
  });

  it('T6: the presence and ownership rates count the returned checks, ownership over the checks where the feature is present', async () => {
    const browser = mockBrowser('viewer');
    const ids = KEYWORD_TABLE.filter(
      (row) => row.location === 2276 && row.device === 'desktop' && row.archived !== true,
    )
      .slice(0, 8)
      .map((row) => trackedId(row.text));
    let rows = 0;
    let partlyOwned = 0;
    let neverOwned = 0;
    for (const id of ids) {
      const history = await featuresOf(browser, id);
      for (const p of history.presence) {
        const present = history.checks.filter((c) => c.features.some((f) => f.feature_type === p.feature_type));
        const owned = present.filter((c) =>
          c.features.some((f) => f.feature_type === p.feature_type && f.owned_by_project),
        );
        expect(p.presence_rate).toMatchObject({
          numerator: present.length,
          denominator: history.checks.length,
          value: present.length / history.checks.length,
        });
        expect(present.length).toBeGreaterThan(0);
        expect(p.own_ownership_rate).toMatchObject({
          numerator: owned.length,
          denominator: present.length,
          value: owned.length / present.length,
        });
        rows += 1;
        partlyOwned += owned.length > 0 && owned.length < present.length ? 1 : 0;
        neverOwned += owned.length === 0 ? 1 : 0;
      }
    }
    expect(rows).toBeGreaterThan(10);
    expect(partlyOwned).toBeGreaterThan(0);
    expect(neverOwned).toBeGreaterThan(0);
  });

  it('T6: the sources and the competitors of a feature are the ones the snapshot detail tells for the same check', async () => {
    const browser = mockBrowser('viewer');
    const history = await featuresOf(browser, berlin);
    let withSources = 0;
    let withCompetitors = 0;
    for (const check of history.checks.slice(0, 10)) {
      const detail = dataOf(
        await browser.call('GET', `${P}/serp-snapshots/${check.serp_snapshot_id}`),
        SERP_SNAPSHOT_DETAIL,
      );
      expect(check.features).toEqual(detail.features);
      withSources += check.features.filter((f) => f.source_urls.length > 0).length;
      withCompetitors += check.features.filter((f) => f.competitor_entity_ids.length > 0).length;
    }
    expect(withSources).toBeGreaterThan(0);
    expect(withCompetitors).toBeGreaterThan(0);
  });
});

describe('aio-history', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    clearManualChecks();
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });

  it('T7: source_count is the number of sources of the AI Overview of that check, and competitors_cited are the competitors of a loaded block', async () => {
    const browser = mockBrowser('viewer');
    const items = dataOf(await browser.call('GET', `${P}/tracked-keywords/${berlin}/aio-history`), AIO_HISTORY);
    expect(items.length).toBe(30);

    let withSources = 0;
    let withoutBlock = 0;
    let citedWithBlock = 0;
    let competitorsAroundNoBlock = 0;
    const citedEntityIds = new Set<string>();
    for (const item of items.slice(0, 20)) {
      const detail = dataOf(
        await browser.call('GET', `${P}/serp-snapshots/${item.serp_snapshot_id}`),
        SERP_SNAPSHOT_DETAIL,
      );
      const block = detail.features.find((f) => f.feature_type === 'ai_overview');
      expect(item.source_count).toBe(block?.source_urls.length ?? 0);
      withSources += item.source_count > 0 ? 1 : 0;
      withoutBlock += block === undefined ? 1 : 0;

      // A block that is loaded and read is one the state says is present
      const loaded = item.ai_overview_state === 'present_cited' || item.ai_overview_state === 'present_not_cited';
      const top10 = detail.organic
        .filter((o) => o.entity?.role === 'competitor' && o.organic_rank <= 10)
        .map((o) => o.entity?.entity_id ?? '')
        .sort();
      const cited = item.competitors_cited.map((e) => e.entity_id).sort();
      expect(cited).toEqual(loaded ? top10 : []);
      for (const entity of item.competitors_cited) {
        expect(entity.role).toBe('competitor');
        citedEntityIds.add(entity.entity_id);
      }
      citedWithBlock += loaded && cited.length > 0 ? 1 : 0;
      competitorsAroundNoBlock += !loaded && top10.length > 0 ? 1 : 0;
    }
    expect(withSources).toBeGreaterThan(2);
    expect(withoutBlock).toBeGreaterThan(0);
    expect(citedWithBlock).toBeGreaterThan(0);
    expect(competitorsAroundNoBlock).toBeGreaterThan(0);
    // The competitor the keyword leaves out never shows, the ones it keeps do
    expect(citedEntityIds.has(MOCK_ENTITY_IDS.meridian)).toBe(false);
    expect(citedEntityIds.size).toBeGreaterThan(1);
  });

  it('T7: from and to keep the checks of those project local days', async () => {
    const browser = mockBrowser('viewer');
    const snapshots = await snapshotRows(browser, berlin);
    const expected = snapshots
      .filter((s) => s.observed_date >= '2026-10-15' && s.observed_date <= '2026-10-24')
      .map((s) => s.serp_snapshot_id);
    expect(expected.length).toBeGreaterThan(3);
    expect(expected.length).toBeLessThan(snapshots.length);

    const items = dataOf(
      await browser.call('GET', `${P}/tracked-keywords/${berlin}/aio-history?from=2026-10-15&to=2026-10-24`),
      AIO_HISTORY,
    );
    expect(items.map((i) => i.serp_snapshot_id)).toEqual(expected);
  });

  it('T7: a window of 400 days is answered and one of 401 days is 422 window_too_large, for both routes', async () => {
    const browser = mockBrowser('viewer');
    for (const route of ['aio-history', 'serp-features']) {
      const path = `${P}/tracked-keywords/${berlin}/${route}`;
      const exact = await browser.call('GET', `${path}?from=${fromOf('2026-11-02', 400)}&to=2026-11-02`);
      expect(exact.status).toBe(200);

      const over: Answer = await browser.call('GET', `${path}?from=${fromOf('2026-11-02', 401)}&to=2026-11-02`);
      expect(over.status).toBe(422);
      expect(over.code).toBe('window_too_large');
      expect(over.body.limit_days).toBe(400);
    }
  });
});

describe('errors of the SERP routes (T8)', () => {
  it('names the path as the location of a bad id in the path, and the query as the location of a bad parameter', async () => {
    const browser = mockBrowser('analyst');
    const withBadKeyword = ['serp-current', 'serp-snapshots', 'serp-features', 'aio-history', 'rank-history'];
    for (const route of withBadKeyword) {
      const res = await browser.call('GET', `${P}/tracked-keywords/not-a-uuid/${route}`);
      expect(res.status).toBe(422);
      expect(ERRORS.parse(res.body).errors).toEqual([
        { location: 'path', path: 'tracked_keyword_id', code: 'uuid_parsing' },
      ]);
    }
    // H2: the problem is for the request that was made
    for (const path of ['abc', 'abc/raw', '0', '-1', '9223372036854775808', '9223372036854775808/raw']) {
      const res = await browser.call('GET', `${P}/serp-snapshots/${path}`);
      expect(res.status).toBe(422);
      expect(ERRORS.parse(res.body).errors).toEqual([
        { location: 'path', path: 'serp_snapshot_id', code: 'value_error' },
      ]);
      expect(res.body.instance).toBe(`${P}/serp-snapshots/${path}`);
    }

    const query = await browser.call('GET', `${P}/tracked-keywords/${berlin}/serp-features?limit_checks=0`);
    expect(ERRORS.parse(query.body).errors).toEqual([{ location: 'query', path: 'limit_checks', code: 'value_error' }]);
  });
});
