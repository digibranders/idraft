import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { PENDING_TRACKED_IDS } from '../keyword-fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { clearManualChecks, FAILED_IDS, recordManualCheck } from '../serp-world';
import { aioStateOut } from '../serp-views';
import {
  AIO_HISTORY,
  PROJECT,
  RANK_EVENT_PAGE,
  RANK_HISTORY,
  SERP_CURRENT,
  SERP_FEATURE_HISTORY,
  SERP_SNAPSHOT_DETAIL,
  SERP_SNAPSHOT_PAGE,
  TRACKED_KEYWORD,
  TRACKED_KEYWORD_DETAIL,
} from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser, type MockBrowser } from '@/test/mock-api';
import type { Schemas } from '@/lib/api/types';

const W = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}`;
const [fynix, cleanstart] = MOCK_PROJECTS;
if (!fynix || !cleanstart) throw new Error('Project fixtures missing');
const P = `${W}/projects/${fynix.project_id}`;
const foreignP = `${W}/projects/${cleanstart.project_id}`;

const trackedId = (text: string): string => {
  const index = KEYWORD_TABLE.findIndex(
    (row) => row.text === text && row.location === 2276 && row.device === 'desktop',
  );
  if (index < 0) throw new Error(`No fixture row for ${text}`);
  return mockId('tracked', index + 1);
};

describe('SERP routes', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    clearManualChecks();
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });

  describe('serp-current', () => {
    it('answers 20 results with titles, snippets, entities, matching snapshot id and rank of list state', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      // Check list/detail state
      const detailRes = await browser.call('GET', `${P}/tracked-keywords/${id}`);
      expect(detailRes.status).toBe(200);
      const detail = dataOf(detailRes, TRACKED_KEYWORD_DETAIL);
      const state = detail.state;

      const res = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-current`);
      expect(res.status).toBe(200);
      const current = dataOf(res, SERP_CURRENT);

      expect(current.serp_snapshot_id).toBe(state.current.serp_snapshot_id);
      expect(current.observed_at).toBe(state.current.observed_at);
      expect(current.results).toHaveLength(20);

      // Check ranks 1 to 20
      for (let i = 0; i < 20; i += 1) {
        const item = current.results[i];
        expect(item?.organic_rank).toBe(i + 1);
        expect(item?.title).toMatch(/\S/);
        expect(item?.snippet).toMatch(/\S/);
        expect(item?.domain.host).toMatch(/\S/);
        expect(item?.url.canonical_url).toMatch(/^https:\/\/\S+$/);
      }

      // Own site matches rank in list state
      const ownResult = current.results.find((r) => r.entity?.role === 'own');
      expect(ownResult?.organic_rank).toBe(state.current.rank);

      // Competitors have role competitor (no empty loop: assert count > 0)
      const compResults = current.results.filter((r) => r.entity?.role === 'competitor');
      expect(compResults.length).toBeGreaterThan(0);
      for (const comp of compResults) {
        expect(comp.entity?.entity_id).toMatch(/\S/);
      }
    });

    it('N1: one host has one domain_id in every snapshot and keyword, and different hosts have different ids', async () => {
      const berlin = trackedId('seo agency berlin');
      const germany = trackedId('seo agency germany');
      const browser = mockBrowser('viewer');

      const snapsRes = await browser.call('GET', `${P}/tracked-keywords/${berlin}/serp-snapshots?limit=8`);
      const snaps = SERP_SNAPSHOT_PAGE.parse(snapsRes.body).data;
      expect(snaps).toHaveLength(8);

      const organic: Schemas['SerpResult'][] = [];
      for (const snap of snaps) {
        const detailRes = await browser.call('GET', `${P}/serp-snapshots/${snap.serp_snapshot_id}`);
        organic.push(...dataOf(detailRes, SERP_SNAPSHOT_DETAIL).organic);
      }
      const germanyRes = await browser.call('GET', `${P}/tracked-keywords/${germany}/serp-current`);
      organic.push(...dataOf(germanyRes, SERP_CURRENT).results);

      const idsByHost = new Map<string, Set<number>>();
      const sightings = new Map<string, number>();
      for (const item of organic) {
        const ids = idsByHost.get(item.domain.host) ?? new Set<number>();
        ids.add(item.domain.domain_id);
        idsByHost.set(item.domain.host, ids);
        sightings.set(item.domain.host, (sightings.get(item.domain.host) ?? 0) + 1);
      }
      const hosts = [...idsByHost.keys()];
      expect(hosts.length).toBeGreaterThan(20);
      for (const ids of idsByHost.values()) expect(ids.size).toBe(1);

      // The own host and a competitor host each come back in several snapshots
      const repeated = hosts.filter((host) => (sightings.get(host) ?? 0) > 1);
      expect(repeated.length).toBeGreaterThan(10);
      expect(repeated).toContain('fynix.digital');
      const repeatedCompetitors = organic.filter(
        (o) => o.entity?.role === 'competitor' && (sightings.get(o.domain.host) ?? 0) > 1,
      );
      expect(repeatedCompetitors.length).toBeGreaterThan(0);

      // Different hosts, different ids
      const oneIdPerHost = [...idsByHost.values()].flatMap((ids) => [...ids]);
      expect(new Set(oneIdPerHost).size).toBe(hosts.length);
    });

    describe('a project without a primary domain (N3 / M5)', () => {
      interface OwnRanks {
        snapshotId: string;
        snapshots: number | null;
        current: number | null;
        detail: number | null;
        history: number | null;
        aio: number | null;
      }

      /** The own rank of the newest check as every route that answers it tells it. */
      const ownRanksOf = async (browser: MockBrowser, projectPath: string, tkId: string): Promise<OwnRanks> => {
        const snapshots = SERP_SNAPSHOT_PAGE.parse(
          (await browser.call('GET', `${projectPath}/tracked-keywords/${tkId}/serp-snapshots?limit=1`)).body,
        ).data;
        expect(snapshots).toHaveLength(1);
        const [newest] = snapshots;
        const snapshotId = newest?.serp_snapshot_id ?? '';
        expect(snapshotId).toMatch(/^\d+$/);

        const current = dataOf(
          await browser.call('GET', `${projectPath}/tracked-keywords/${tkId}/serp-current`),
          SERP_CURRENT,
        );
        expect(current.serp_snapshot_id).toBe(snapshotId);
        const detail = dataOf(
          await browser.call('GET', `${projectPath}/serp-snapshots/${snapshotId}`),
          SERP_SNAPSHOT_DETAIL,
        );
        const history = dataOf(
          await browser.call('GET', `${projectPath}/tracked-keywords/${tkId}/rank-history`),
          RANK_HISTORY,
        );
        const ownPoints = history.series?.find((s) => s.entity.role === 'own')?.points ?? [];
        const point = ownPoints.filter((p) => p.serp_snapshot_id === snapshotId);
        expect(point).toHaveLength(1);
        const aio = dataOf(
          await browser.call('GET', `${projectPath}/tracked-keywords/${tkId}/aio-history`),
          AIO_HISTORY,
        );
        const aioRows = aio.filter((a) => a.serp_snapshot_id === snapshotId);
        expect(aioRows).toHaveLength(1);

        return {
          snapshotId,
          snapshots: newest?.own.rank ?? null,
          current: current.results.find((r) => r.entity?.role === 'own')?.organic_rank ?? null,
          detail: detail.organic.find((o) => o.entity?.role === 'own')?.organic_rank ?? null,
          history: point[0]?.rank ?? null,
          aio: aioRows[0]?.organic_rank.rank ?? null,
        };
      };

      it('shows no own rank in any route, while a project with a domain shows the same rank in every route', async () => {
        const editor = mockBrowser('editor');

        const createRes = await editor.call('POST', `${W}/projects`, {
          name: 'No Primary Domain Project',
          slug: 'no-primary-domain',
          default_location_id: 2276,
          default_language_code: 'en',
        });
        expect(createRes.status).toBe(201);
        const proj = dataOf(createRes, PROJECT);
        expect(proj.primary_domain).toBeNull();
        const projPath = `${W}/projects/${proj.project_id}`;

        const tkRes = await editor.call('POST', `${projPath}/tracked-keywords`, {
          keyword: 'berlin marketing agency',
          device: 'desktop',
        });
        expect(tkRes.status).toBe(201);
        const [tracked] = dataOf(tkRes, z.array(TRACKED_KEYWORD));
        const tkId = tracked?.tracked_keyword_id ?? '';
        expect(tkId).toMatch(/^[0-9a-f-]{36}$/);
        recordManualCheck(tkId, Date.now());

        const bare = await ownRanksOf(editor, projPath, tkId);
        expect([bare.snapshots, bare.current, bare.detail, bare.history, bare.aio]).toEqual([
          null,
          null,
          null,
          null,
          null,
        ]);

        // Nothing in the answers is the project's own
        const detail = dataOf(
          await editor.call('GET', `${projPath}/serp-snapshots/${bare.snapshotId}`),
          SERP_SNAPSHOT_DETAIL,
        );
        expect(detail.organic.length).toBeGreaterThan(0);
        expect(detail.organic.filter((o) => o.entity?.role === 'own')).toEqual([]);
        expect(detail.features.filter((f) => f.owned_by_project)).toEqual([]);
        const events = RANK_EVENT_PAGE.parse(
          (await editor.call('GET', `${projPath}/seo/rank-events?filter[tracked_keyword_id]=${tkId}`)).body,
        );
        expect(events.data.filter((e) => e.from_rank !== null || e.to_rank !== null || e.from_url || e.to_url)).toEqual(
          [],
        );

        // A project with a domain tells one own rank, and its host, in every route
        const berlin = trackedId('seo agency berlin');
        const full = await ownRanksOf(editor, P, berlin);
        expect(full.current).not.toBeNull();
        expect([full.snapshots, full.detail, full.history, full.aio]).toEqual([
          full.current,
          full.current,
          full.current,
          full.current,
        ]);
        const fullDetail = dataOf(
          await editor.call('GET', `${P}/serp-snapshots/${full.snapshotId}`),
          SERP_SNAPSHOT_DETAIL,
        );
        expect(fullDetail.own.url?.host).toBe('fynix.digital');
        expect(fullDetail.organic.find((o) => o.entity?.role === 'own')?.domain.host).toBe('fynix.digital');
        const fullEvents = RANK_EVENT_PAGE.parse(
          (await editor.call('GET', `${P}/seo/rank-events?filter[tracked_keyword_id]=${berlin}&limit=200`)).body,
        );
        const rankedEvents = fullEvents.data.filter((e) => e.to_rank !== null);
        expect(rankedEvents.length).toBeGreaterThan(0);
        const urlEvents = fullEvents.data.filter((e) => e.to_url !== null);
        expect(urlEvents.length).toBeGreaterThan(0);
        for (const e of urlEvents) expect(e.to_url?.host).toBe('fynix.digital');
        const fullHistory = dataOf(
          await editor.call('GET', `${P}/tracked-keywords/${berlin}/rank-history?include=events`),
          RANK_HISTORY,
        );
        expect(fullHistory.events?.filter((e) => e.to_rank !== null).length).toBeGreaterThan(0);
      });
    });

    it('answers empty results for pending and failed keywords, 404 for unknown keyword, 422 for bad path uuid', async () => {
      const browser = mockBrowser('viewer');
      const pendingId = [...PENDING_TRACKED_IDS][0] ?? '';
      expect(pendingId).toBeTruthy();

      const pendingRes = await browser.call('GET', `${P}/tracked-keywords/${pendingId}/serp-current`);
      expect(pendingRes.status).toBe(200);
      const pending = dataOf(pendingRes, SERP_CURRENT);
      expect(pending.serp_snapshot_id).toBeNull();
      expect(pending.observed_at).toBeNull();
      expect(pending.results).toEqual([]);

      const failedId = [...FAILED_IDS][0] ?? '';
      expect(failedId).toBeTruthy();
      const failedRes = await browser.call('GET', `${P}/tracked-keywords/${failedId}/serp-current`);
      expect(failedRes.status).toBe(200);
      const failed = dataOf(failedRes, SERP_CURRENT);
      expect(failed.serp_snapshot_id).toBeNull();
      expect(failed.results).toEqual([]);

      const unknownUuid = '00000000-0000-0000-0000-000000000000';
      const unknownRes = await browser.call('GET', `${P}/tracked-keywords/${unknownUuid}/serp-current`);
      expect(unknownRes.status).toBe(404);

      // Non-UUID in path gives 422 with location: 'path'
      const badPathRes = await browser.call('GET', `${P}/tracked-keywords/not-a-uuid/serp-current`);
      expect(badPathRes.status).toBe(422);
      expect(fieldCodes(badPathRes)).toContain('tracked_keyword_id:uuid_parsing');
    });
  });

  describe('serp-snapshots', () => {
    it('answers snapshots newest first, with own RankCell matching history, and newest id matching serp-current', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      const currentRes = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-current`);
      const current = dataOf(currentRes, SERP_CURRENT);

      const historyRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=absolute`);
      const history = dataOf(historyRes, RANK_HISTORY);
      const ownPoints = history.series?.[0]?.points ?? [];

      const snapshotsRes = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-snapshots?limit=50`);
      expect(snapshotsRes.status).toBe(200);
      const page = SERP_SNAPSHOT_PAGE.parse(snapshotsRes.body);
      expect(page.data.length).toBeGreaterThan(0);

      // Newest row equals serp-current
      expect(page.data[0]?.serp_snapshot_id).toBe(current.serp_snapshot_id);

      // Newest first
      expect(page.data.length).toBeGreaterThan(5);
      const times = page.data.map((snap) => snap.observed_at);
      expect(times).toEqual([...times].sort().reverse());

      // Each row's own is the same RankCell implied by rank-history
      const pointBySnapshot = new Map(ownPoints.map((p) => [p.serp_snapshot_id, p]));
      for (const snap of page.data) {
        const point = pointBySnapshot.get(snap.serp_snapshot_id);
        expect(point).toMatchObject({
          state: snap.own.state,
          rank: snap.own.rank,
          absolute_rank: snap.own.absolute_rank,
          serp_snapshot_id: snap.own.serp_snapshot_id,
        });
      }
    });

    it('filters by date range, depth_requested, has_ai_overview, and rejects invalid inputs with 422', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      const resFiltered = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?from=2026-10-01&to=2026-10-15`,
      );
      expect(resFiltered.status).toBe(200);
      const pageFiltered = SERP_SNAPSHOT_PAGE.parse(resFiltered.body);
      expect(pageFiltered.data.length).toBeGreaterThan(0);
      for (const row of pageFiltered.data) {
        expect(row.observed_date >= '2026-10-01').toBe(true);
        expect(row.observed_date <= '2026-10-15').toBe(true);
      }

      // filter[depth_requested]=20 applied
      const resDepth20 = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[depth_requested]=20`,
      );
      expect(resDepth20.status).toBe(200);
      const pageDepth20 = SERP_SNAPSHOT_PAGE.parse(resDepth20.body);
      expect(pageDepth20.data.length).toBeGreaterThan(0);
      for (const row of pageDepth20.data) {
        expect(row.depth_requested).toBe(20);
      }

      // filter[has_ai_overview]=true
      const resAio = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[has_ai_overview]=true`,
      );
      expect(resAio.status).toBe(200);
      const pageAio = SERP_SNAPSHOT_PAGE.parse(resAio.body);
      expect(pageAio.data.length).toBeGreaterThan(0);
      for (const row of pageAio.data) {
        expect(row.has_ai_overview).toBe(true);
        expect(row.ai_overview_state?.startsWith('present')).toBe(true);
      }

      // filter[has_ai_overview]=false
      const resNoAio = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[has_ai_overview]=false`,
      );
      expect(resNoAio.status).toBe(200);
      const pageNoAio = SERP_SNAPSHOT_PAGE.parse(resNoAio.body);
      expect(pageNoAio.data.length).toBeGreaterThan(0);
      for (const row of pageNoAio.data) {
        expect(row.has_ai_overview).toBe(false);
        expect(row.ai_overview_state).toBe('absent');
      }

      // 422 validations
      const resInvalidAio = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[has_ai_overview]=maybe`,
      );
      expect(resInvalidAio.status).toBe(422);
      expect(fieldCodes(resInvalidAio)).toContain('filter[has_ai_overview]:bool_parsing');

      const resBadDate = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-snapshots?from=garbage`);
      expect(resBadDate.status).toBe(422);
      expect(fieldCodes(resBadDate)).toContain('from:date_parsing');

      const resInverted = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?from=2026-10-20&to=2026-10-10`,
      );
      expect(resInverted.status).toBe(422);
      expect(fieldCodes(resInverted)).toContain('from:range_invalid');

      const resInvalidDepth = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[depth_requested]=0`,
      );
      expect(resInvalidDepth.status).toBe(422);

      const resInvalidDepthHigh = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?filter[depth_requested]=701`,
      );
      expect(resInvalidDepthHigh.status).toBe(422);

      const resBadPath = await browser.call('GET', `${P}/tracked-keywords/not-a-uuid/serp-snapshots`);
      expect(resBadPath.status).toBe(422);
      expect(fieldCodes(resBadPath)).toContain('tracked_keyword_id:uuid_parsing');
    });

    it('maps aio state unknown to null (not absent) in snapshot summary (M8)', () => {
      expect(aioStateOut('unknown')).toBeNull();
      expect(aioStateOut('absent')).toBe('absent');
      expect(aioStateOut('present_cited')).toBe('present');
      expect(aioStateOut('present_not_cited')).toBe('present');
      expect(aioStateOut('not_loaded')).toBe('present_not_loaded');
    });

    it('respects project-local date boundaries near midnight UTC', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      // 2026-11-02T23:30:00Z is 2026-11-03 00:30:00 in Europe/Berlin (UTC+1)
      const checkTime = Date.parse('2026-11-02T23:30:00Z');
      recordManualCheck(id, checkTime);
      vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));

      const resNextDay = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?from=2026-11-03&to=2026-11-03`,
      );
      expect(resNextDay.status).toBe(200);
      const pageNextDay = SERP_SNAPSHOT_PAGE.parse(resNextDay.body);
      const foundCheck = pageNextDay.data.find((s) => s.observed_at === '2026-11-02T23:30:00.000Z');
      expect(foundCheck).not.toBeUndefined();

      const resPrevDay = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-snapshots?from=2026-11-02&to=2026-11-02`,
      );
      expect(resPrevDay.status).toBe(200);
      const pagePrevDay = SERP_SNAPSHOT_PAGE.parse(resPrevDay.body);
      const notFoundCheck = pagePrevDay.data.find((s) => s.observed_at === '2026-11-02T23:30:00.000Z');
      expect(notFoundCheck).toBeUndefined();
    });
  });

  describe('serp-snapshots/{id}', () => {
    it('returns detail with organic, features, provenance, titles for latest snapshot when include=titles', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      const currentRes = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-current`);
      const current = dataOf(currentRes, SERP_CURRENT);
      const latestSnapshotId = current.serp_snapshot_id ?? '';
      expect(latestSnapshotId).toBeTruthy();

      // With include=titles on latest snapshot
      const resLatestWithTitles = await browser.call('GET', `${P}/serp-snapshots/${latestSnapshotId}?include=titles`);
      expect(resLatestWithTitles.status).toBe(200);
      const detailLatest = dataOf(resLatestWithTitles, SERP_SNAPSHOT_DETAIL);
      expect(detailLatest.serp_snapshot_id).toBe(latestSnapshotId);
      expect(detailLatest.titles_source).toBe('serp_current_results');
      expect(detailLatest.organic.length).toBe(detailLatest.depth_returned);

      // Top 20 all have titles
      const top20 = detailLatest.organic.slice(0, 20);
      expect(top20).toHaveLength(20);
      for (const item of top20) {
        expect(item.title).toMatch(/\S/);
        expect(item.snippet).toMatch(/\S/);
      }

      // Without include=titles: all titles null, unavailable
      const resWithoutTitles = await browser.call('GET', `${P}/serp-snapshots/${latestSnapshotId}`);
      expect(resWithoutTitles.status).toBe(200);
      const detailWithoutTitles = dataOf(resWithoutTitles, SERP_SNAPSHOT_DETAIL);
      expect(detailWithoutTitles.titles_source).toBe('unavailable');
      for (const item of detailWithoutTitles.organic) {
        expect(item.title).toBeNull();
        expect(item.snippet).toBeNull();
      }

      // Check an older snapshot with include=titles
      const snapshotsRes = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-snapshots?limit=5`);
      const page = SERP_SNAPSHOT_PAGE.parse(snapshotsRes.body);
      const olderSnapshotId = page.data[1]?.serp_snapshot_id ?? '';
      expect(olderSnapshotId).toBeTruthy();

      const resOlderWithTitles = await browser.call('GET', `${P}/serp-snapshots/${olderSnapshotId}?include=titles`);
      expect(resOlderWithTitles.status).toBe(200);
      const detailOlder = dataOf(resOlderWithTitles, SERP_SNAPSHOT_DETAIL);
      expect(detailOlder.titles_source).toBe('domain_rank_observations');
      const olderEntities = detailOlder.organic.filter((item) => item.entity !== null);
      const olderOthers = detailOlder.organic.filter((item) => item.entity === null);
      expect(olderEntities.length).toBeGreaterThan(0);
      expect(olderOthers.length).toBeGreaterThan(0);
      for (const item of olderEntities) {
        expect(item.title).toMatch(/\S/);
        expect(item.snippet).toMatch(/\S/);
      }
      for (const item of olderOthers) {
        expect(item.title).toBeNull();
        expect(item.snippet).toBeNull();
      }

      // Provenance
      expect(detailLatest.provenance.raw_payload_id).toMatch(/^\d+$/);
      expect(detailLatest.provenance.parser_version).toBeGreaterThanOrEqual(1);
      expect(detailLatest.provenance.canonicalizer_version).toBeGreaterThanOrEqual(1);

      // 64-bit ID bounds
      const resZero = await browser.call('GET', `${P}/serp-snapshots/0`);
      expect(resZero.status).toBe(422);
      expect(resZero.body.instance).toBe(`${P}/serp-snapshots/0`);

      const resNegative = await browser.call('GET', `${P}/serp-snapshots/-1`);
      expect(resNegative.status).toBe(422);

      const resMaxBigInt = await browser.call('GET', `${P}/serp-snapshots/9223372036854775807`);
      expect(resMaxBigInt.status).toBe(404);

      const resOverMaxBigInt = await browser.call('GET', `${P}/serp-snapshots/9223372036854775808`);
      expect(resOverMaxBigInt.status).toBe(422);

      // Foreign project gets 404
      const foreignRes = await browser.call('GET', `${foreignP}/serp-snapshots/${latestSnapshotId}`);
      expect(foreignRes.status).toBe(404);

      // Malformed query params
      const resBadInclude = await browser.call('GET', `${P}/serp-snapshots/${latestSnapshotId}?include=bogus`);
      expect(resBadInclude.status).toBe(422);
      expect(fieldCodes(resBadInclude)).toContain('include:value_error');

      const resBadObs = await browser.call('GET', `${P}/serp-snapshots/${latestSnapshotId}?observed_at=garbage`);
      expect(resBadObs.status).toBe(422);
      expect(fieldCodes(resBadObs)).toContain('observed_at:datetime_parsing');
    });
  });

  describe('raw download', () => {
    it('raw:read holders get 200 with JSON attachment and security headers, viewers get 403', async () => {
      const id = trackedId('seo agency berlin');
      const analyst = mockBrowser('analyst');
      const viewer = mockBrowser('viewer');
      const billing = mockBrowser('billing');

      const currentRes = await analyst.call('GET', `${P}/tracked-keywords/${id}/serp-current`);
      const current = dataOf(currentRes, SERP_CURRENT);
      const snapshotId = current.serp_snapshot_id ?? '';

      // Analyst gets 200 attachment
      const res = await analyst.call('GET', `${P}/serp-snapshots/${snapshotId}/raw`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="serp-snapshot-${snapshotId}.json"`);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('content-security-policy')).toBe('sandbox');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');

      // Viewer and billing get 403
      const viewerRes = await viewer.call('GET', `${P}/serp-snapshots/${snapshotId}/raw`);
      expect(viewerRes.status).toBe(403);

      const billingRes = await billing.call('GET', `${P}/serp-snapshots/${snapshotId}/raw`);
      expect(billingRes.status).toBe(403);
    });

    it('returns 200 for snapshot at 13 days, 410 raw_expired at 15 days, and 503 under scenario cookie', async () => {
      const id = trackedId('seo agency berlin');
      const analyst = mockBrowser('analyst');

      const snapshotsRes = await analyst.call('GET', `${P}/tracked-keywords/${id}/serp-snapshots?limit=50`);
      const page = SERP_SNAPSHOT_PAGE.parse(snapshotsRes.body);

      // Snapshot at <= 13 days is 200
      const nowMs = Date.parse('2026-11-02T15:00:00Z');
      const snap13d = page.data.find((s) => {
        const age = nowMs - Date.parse(s.observed_at);
        return age > 10 * 86_400_000 && age < 14 * 86_400_000;
      });
      expect(snap13d).not.toBeUndefined();
      const res13d = await analyst.call('GET', `${P}/serp-snapshots/${snap13d?.serp_snapshot_id ?? ''}/raw`);
      expect(res13d.status).toBe(200);

      // Snapshot at >= 15 days is 410
      const snap15d = page.data.find((s) => nowMs - Date.parse(s.observed_at) > 14 * 86_400_000);
      expect(snap15d).not.toBeUndefined();
      const expiredRes = await analyst.call('GET', `${P}/serp-snapshots/${snap15d?.serp_snapshot_id ?? ''}/raw`);
      expect(expiredRes.status).toBe(410);
      expect(expiredRes.code).toBe('raw_expired');
      expect(expiredRes.body.title).toBe('The raw answer is past its retention');

      // Scenario cookie mock_serp_raw=unavailable
      const currentRes = await analyst.call('GET', `${P}/tracked-keywords/${id}/serp-current`);
      const current = dataOf(currentRes, SERP_CURRENT);
      const snapId = current.serp_snapshot_id ?? '';

      const browserUnavailable = mockBrowser('analyst', new Map([['mock_serp_raw', 'unavailable']]));
      const unavailableRes = await browserUnavailable.call('GET', `${P}/serp-snapshots/${snapId}/raw`);
      expect(unavailableRes.status).toBe(503);
      expect(unavailableRes.code).toBe('raw_unavailable');
      expect(unavailableRes.body.title).toBe('The raw answer is not available now');
    });
  });

  describe('serp-features', () => {
    it('answers recent checks with features, presence rates and ownership rates, defaulting to 30 checks', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      const res = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-features`);
      expect(res.status).toBe(200);
      const data = dataOf(res, SERP_FEATURE_HISTORY);
      expect(data.checks.length).toBeGreaterThan(0);
      expect(data.checks.length).toBeLessThanOrEqual(30);

      // Presence rates
      expect(data.presence.length).toBeGreaterThan(0);
      for (const p of data.presence) {
        expect(p.feature_type).toMatch(/\S/);
        expect(p.presence_rate.metric).toBe('seo.serp_feature_presence');
        expect(p.presence_rate.denominator).toBe(data.checks.length);
        expect(p.own_ownership_rate.metric).toBe('seo.serp_feature_ownership');
      }

      // Feature types sorted
      const types = data.presence.map((p) => p.feature_type);
      expect(types).toEqual([...types].sort());

      // Max 20 feature types allowed
      const tooMany = Array.from({ length: 21 }, (_, i) => `f_${String(i)}`).join(',');
      const resTooMany = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-features?filter[feature_type_in]=${tooMany}`,
      );
      expect(resTooMany.status).toBe(422);
      expect(fieldCodes(resTooMany)).toEqual(['filter[feature_type_in]:too_long']);

      // limit_checks bounds: 0 and 201 are 422
      const resLimit0 = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-features?limit_checks=0`);
      expect(resLimit0.status).toBe(422);

      const resLimit201 = await browser.call('GET', `${P}/tracked-keywords/${id}/serp-features?limit_checks=201`);
      expect(resLimit201.status).toBe(422);
    });

    it('validates from/to with range_invalid (422) and window_too_large (422 with limit_days 400) (I6)', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      // from > to gives 422 range_invalid
      const resInverted = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-features?from=2026-11-05&to=2026-11-01`,
      );
      expect(resInverted.status).toBe(422);
      expect(fieldCodes(resInverted)).toContain('from:range_invalid');

      // window > 400 days gives 422 window_too_large with limit_days: 400
      const resTooLarge = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/serp-features?from=2025-01-01&to=2026-11-01`,
      );
      expect(resTooLarge.status).toBe(422);
      expect(resTooLarge.code).toBe('window_too_large');
      expect(resTooLarge.body.limit_days).toBe(400);

      // Non-UUID path returns 422 with location path
      const resBadPath = await browser.call('GET', `${P}/tracked-keywords/not-uuid/serp-features`);
      expect(resBadPath.status).toBe(422);
      expect(fieldCodes(resBadPath)).toContain('tracked_keyword_id:uuid_parsing');
    });
  });

  describe('aio-history', () => {
    it('answers AI Overview history consistent with rank history, with exact source_count and competitors_cited check', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      const historyRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
      const history = dataOf(historyRes, RANK_HISTORY);
      const ownPoints = history.series?.[0]?.points ?? [];

      const res = await browser.call('GET', `${P}/tracked-keywords/${id}/aio-history`);
      expect(res.status).toBe(200);
      const items = dataOf(res, AIO_HISTORY);
      expect(items.length).toBeGreaterThan(0);

      // Newest first
      const times = items.map((item) => item.observed_at);
      expect(times).toEqual([...times].sort().reverse());
      expect(items.length).toBeGreaterThan(5);

      const pointBySnapshot = new Map(ownPoints.map((p) => [p.serp_snapshot_id, p]));
      for (const item of items) {
        expect(pointBySnapshot.get(item.serp_snapshot_id)).toMatchObject({
          rank: item.organic_rank.rank,
          state: item.organic_rank.state,
        });
      }

      // The own citation follows the state, each state counted so no branch is empty
      const cited = items.filter((item) => item.ai_overview_state === 'present_cited');
      expect(cited.length).toBeGreaterThan(0);
      for (const item of cited) {
        expect(item.own_cited).toBe(true);
        expect(item.own_citation_position).toBeGreaterThanOrEqual(1);
        expect(item.source_count).toBeGreaterThan(0);
      }
      const noBlock = items.filter(
        (item) => item.ai_overview_state === 'absent' || item.ai_overview_state === 'not_loaded',
      );
      expect(noBlock.length).toBeGreaterThan(0);
      for (const item of noBlock) {
        expect(item.own_cited).toBeNull();
        expect(item.own_citation_position).toBeNull();
        expect(item.competitors_cited).toHaveLength(0);
      }
    });

    it('validates from/to with range_invalid (422) and window_too_large (422 with limit_days 400) (I6)', async () => {
      const id = trackedId('seo agency berlin');
      const browser = mockBrowser('viewer');

      // from > to gives 422 range_invalid
      const resInverted = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/aio-history?from=2026-11-05&to=2026-11-01`,
      );
      expect(resInverted.status).toBe(422);
      expect(fieldCodes(resInverted)).toContain('from:range_invalid');

      // window > 400 days gives 422 window_too_large with limit_days: 400
      const resTooLarge = await browser.call(
        'GET',
        `${P}/tracked-keywords/${id}/aio-history?from=2025-01-01&to=2026-11-01`,
      );
      expect(resTooLarge.status).toBe(422);
      expect(resTooLarge.code).toBe('window_too_large');
      expect(resTooLarge.body.limit_days).toBe(400);

      // Non-UUID path returns 422 with location path
      const resBadPath = await browser.call('GET', `${P}/tracked-keywords/not-uuid/aio-history`);
      expect(resBadPath.status).toBe(422);
      expect(fieldCodes(resBadPath)).toContain('tracked_keyword_id:uuid_parsing');
    });
  });
});
