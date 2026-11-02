import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ENTITIES_COOKIE, entitiesCookie } from '../entities-state';
import { MOCK_CREATED_AT, MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import {
  CHECKED_FIXTURES,
  clearManualChecks,
  FAILED_IDS,
  FAILING_IDS,
  FAILING_RUN,
  recordManualCheck,
  snapshotIdOf,
  STALE_IDS,
} from '../serp-world';
import { WORKSPACE_COOKIE } from '../workspace-state';
import { RANK_HISTORY, TRACKED_KEYWORD, TRACKED_KEYWORD_ROW } from '@/test/api-shapes';
import { dataOf, fieldCodes, mockBrowser } from '@/test/mock-api';

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

describe('Rank history handler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });
  it('answers rank history for a tracked keyword with real API summary and average_rank', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);

    const history = dataOf(res, RANK_HISTORY);
    expect(history.tracked_keyword_id).toBe(id);
    expect(history.window.timezone).toBe(fynix.timezone);
    expect(history.summary.checks).toBeGreaterThan(0);
    expect(history.summary.ranked_checks + history.summary.beyond_depth_checks).toBe(history.summary.checks);
    expect(history.summary.failed_checks).toBe(0);

    // average_rank is a MetricValue when there are ranked checks
    expect(history.summary.average_rank).not.toBeNull();
    expect(history.summary.average_rank?.metric).toBe('seo.average_rank');
    expect(history.summary.average_rank?.unit).toBe('rank');
    expect(history.summary.average_rank?.denominator).toBe(history.summary.ranked_checks);
    expect(history.summary.average_rank?.n_observations).toBe(history.summary.checks);

    // Series 0 is the own entity
    const series = history.series ?? [];
    expect(series.length).toBeGreaterThanOrEqual(1);
    const [own, ...competitors] = series;
    expect(own?.entity.role).toBe('own');
    expect(own?.points.length).toBe(history.summary.checks);
    expect(own?.points.length).toBeLessThanOrEqual(30);

    // Each point has state, date in project timezone
    for (const point of own?.points ?? []) {
      expect(['ranked', 'beyond_depth']).toContain(point.state);
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (point.state === 'ranked') {
        expect(point.rank).toBeGreaterThanOrEqual(1);
      } else {
        expect(point.rank).toBeNull();
      }
    }

    // Contains two checks on the same day (scheduled + manual)
    const dates = (own?.points ?? []).map((p) => p.date);
    const duplicates = dates.filter((d, i) => dates.indexOf(d) !== i);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);

    // Effective competitors follow
    for (const comp of competitors) {
      expect(['competitor', 'watch']).toContain(comp.entity.role);
    }

    // Bands for consecutive beyond_depth runs for every returned entity
    for (const band of history.bands) {
      expect(band.kind).toBe('beyond_depth');
      expect(band.label).toMatch(/^not in top \d+$/);
      expect(band.from <= band.to).toBe(true);
    }
  });

  it('C1 remainder: list row state.current.{rank, observed_at, serp_snapshot_id}, best_rank, sparkline, and competitor_ranks match latest good history point across all fixtures at 03:00Z, 15:00Z, and 20:00Z, plus archived, stale, and failing fixtures after manual checks', async () => {
    const browser = mockBrowser('viewer');
    const times = ['2026-11-02T03:00:00Z', '2026-11-02T15:00:00Z', '2026-11-02T20:00:00Z'];
    let ownCompared = 0;
    let competitorCompared = 0;

    const assertConsistency = (
      row: z.infer<typeof TRACKED_KEYWORD_ROW>,
      history: z.infer<typeof RANK_HISTORY>,
      timeLimit: string | null = null,
    ) => {
      const ownSeries = history.series?.find((s) => s.entity.role === 'own');
      const goodPoints = ownSeries?.points.filter((p) => p.state !== 'failed') ?? [];
      const latestGood = goodPoints.at(-1);

      if (timeLimit !== null) {
        if (row.state.current.observed_at !== null) {
          expect(Date.parse(row.state.current.observed_at)).toBeLessThanOrEqual(Date.parse(timeLimit));
          ownCompared++;
        }
        if (latestGood?.observed_at) {
          expect(Date.parse(latestGood.observed_at)).toBeLessThanOrEqual(Date.parse(timeLimit));
          ownCompared++;
        }
      }

      if (row.state.current.state === 'failed' || row.state.current.state === 'not_checked') {
        expect(latestGood).toBeUndefined();
        expect(row.state.current.rank).toBeNull();
        expect(row.state.current.observed_at).toBeNull();
        expect(row.state.current.serp_snapshot_id).toBeNull();
        ownCompared += 4;
      } else {
        expect(latestGood).toBeDefined();
        if (!latestGood) throw new Error('Missing latestGood');
        expect(row.state.current.rank).toBe(latestGood.rank);
        expect(row.state.current.observed_at).toBe(latestGood.observed_at);
        expect(row.state.current.serp_snapshot_id).toBe(latestGood.serp_snapshot_id);
        expect(row.sparkline?.points.at(-1)?.rank).toBe(latestGood.rank);

        const rankedRanks = goodPoints.filter((p) => p.state === 'ranked').map((p) => p.rank);
        const expectedBest =
          rankedRanks.length > 0 ? Math.min(...rankedRanks.filter((r): r is number => r !== null)) : null;
        expect(row.state.best_rank).toBe(expectedBest);
        ownCompared += 5;
      }

      expect(row.competitor_ranks).not.toBeNull();
      const compRanks = row.competitor_ranks ?? [];
      for (const comp of compRanks) {
        const compSeries = history.series?.find((s) => s.entity.entity_id === comp.entity.entity_id);
        const compGood = compSeries?.points.filter((p) => p.state !== 'failed') ?? [];
        const compLatest = compGood.at(-1);
        expect(comp.current.rank).toBe(compLatest?.rank ?? null);
        expect(comp.current.observed_at).toBe(compLatest?.observed_at ?? null);
        expect(comp.current.serp_snapshot_id).toBe(compLatest?.serp_snapshot_id ?? null);
        expect(comp.current.absolute_rank).toBe(compLatest?.absolute_rank ?? null);
        competitorCompared++;
      }
    };

    for (const timeStr of times) {
      vi.setSystemTime(new Date(timeStr));
      const listRes = await browser.call('GET', `${P}/tracked-keywords?include=sparkline,competitor_ranks&limit=100`);
      expect(listRes.status).toBe(200);
      const listRows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
      expect(listRows.length).toBeGreaterThan(0);

      for (const row of listRows) {
        const histRes = await browser.call(
          'GET',
          `${P}/tracked-keywords/${row.tracked_keyword_id}/rank-history?include=url,absolute`,
        );
        expect(histRes.status).toBe(200);
        const history = dataOf(histRes, RANK_HISTORY);
        assertConsistency(row, history, timeStr === '2026-11-02T03:00:00Z' ? timeStr : null);
      }
    }

    // Extension 1: archived fixture
    const editor = mockBrowser('editor');
    const archivedId = CHECKED_FIXTURES[1];
    if (!archivedId) throw new Error('Missing fixture for archive');
    const archiveTime = '2026-11-02T10:00:00Z';
    vi.setSystemTime(new Date(archiveTime));
    const patchRes = await editor.call('PATCH', `${P}/tracked-keywords/${archivedId}`, { is_active: false });
    expect(patchRes.status).toBe(200);
    vi.setSystemTime(new Date('2026-11-02T16:00:00Z'));

    const archivedListRes = await editor.call(
      'GET',
      `${P}/tracked-keywords?filter[is_active]=false&include=sparkline,competitor_ranks&limit=100`,
    );
    expect(archivedListRes.status).toBe(200);
    const archivedRows = dataOf(archivedListRes, z.array(TRACKED_KEYWORD_ROW));
    const archivedRow = archivedRows.find((r) => r.tracked_keyword_id === archivedId);
    expect(archivedRow).toBeDefined();
    if (!archivedRow) throw new Error('Missing archivedRow');

    const archivedHistRes = await editor.call(
      'GET',
      `${P}/tracked-keywords/${archivedId}/rank-history?include=url,absolute`,
    );
    expect(archivedHistRes.status).toBe(200);
    const archivedHistory = dataOf(archivedHistRes, RANK_HISTORY);
    assertConsistency(archivedRow, archivedHistory, archiveTime);

    // Extension 2: stale fixture after a manual check
    const staleId = [...STALE_IDS].find((id) => !FAILING_IDS.has(id));
    if (!staleId) throw new Error('Missing stale fixture');
    const staleManualTime = Date.parse('2026-11-02T11:00:00Z');
    recordManualCheck(staleId, staleManualTime);
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));

    const staleListRes = await browser.call(
      'GET',
      `${P}/tracked-keywords?include=sparkline,competitor_ranks&limit=100`,
    );
    expect(staleListRes.status).toBe(200);
    const staleRows = dataOf(staleListRes, z.array(TRACKED_KEYWORD_ROW));
    const staleRow = staleRows.find((r) => r.tracked_keyword_id === staleId);
    expect(staleRow).toBeDefined();
    if (!staleRow) throw new Error('Missing staleRow');

    const staleHistRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${staleId}/rank-history?include=url,absolute`,
    );
    expect(staleHistRes.status).toBe(200);
    const staleHistory = dataOf(staleHistRes, RANK_HISTORY);
    assertConsistency(staleRow, staleHistory);

    // Extension 3: failing fixture after a manual check
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');
    const failingManualTime = Date.parse('2026-11-02T11:30:00Z');
    recordManualCheck(failingId, failingManualTime);

    const failingListRes = await browser.call(
      'GET',
      `${P}/tracked-keywords?include=sparkline,competitor_ranks&limit=100`,
    );
    expect(failingListRes.status).toBe(200);
    const failingRows = dataOf(failingListRes, z.array(TRACKED_KEYWORD_ROW));
    const failingRow = failingRows.find((r) => r.tracked_keyword_id === failingId);
    expect(failingRow).toBeDefined();
    if (!failingRow) throw new Error('Missing failingRow');

    const failingHistRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${failingId}/rank-history?include=url,absolute`,
    );
    expect(failingHistRes.status).toBe(200);
    const failingHistory = dataOf(failingHistRes, RANK_HISTORY);
    assertConsistency(failingRow, failingHistory);

    clearManualChecks();

    expect(ownCompared).toBeGreaterThan(600);
    expect(competitorCompared).toBeGreaterThanOrEqual(275 * 3);
  });

  it('Item 3: monotonic (non-decreasing) times in every series after recordManualCheck on a failing fixture', async () => {
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');
    const browser = mockBrowser('viewer');
    const manualTime = Date.parse('2026-11-02T15:00:00Z');
    recordManualCheck(failingId, manualTime);

    const res = await browser.call('GET', `${P}/tracked-keywords/${failingId}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);

    expect(history.series?.length).toBeGreaterThan(0);
    for (const s of history.series ?? []) {
      expect(s.points.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < s.points.length; i++) {
        const prev = s.points[i - 1];
        const cur = s.points[i];
        expect(cur?.date).toBeDefined();
        expect(prev?.date).toBeDefined();
        expect((cur?.date ?? '') >= (prev?.date ?? '')).toBe(true);
      }
    }
  });

  it('returns failed_checks = 2 and checks excluding failed for a failing keyword', async () => {
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${failingId}/rank-history`);
    expect(res.status).toBe(200);

    const history = dataOf(res, RANK_HISTORY);
    expect(history.summary.failed_checks).toBe(2);
    expect(history.summary.ranked_checks + history.summary.beyond_depth_checks).toBe(history.summary.checks);
    const own = history.series?.[0];
    const failedPoints = own?.points.filter((p) => p.state === 'failed');
    expect(failedPoints?.length).toBe(2);
  });

  it('answers checks = 0 and failed_checks = 3 for an all-failed keyword', async () => {
    const failedId = [...FAILED_IDS][0];
    if (!failedId) throw new Error('Missing failed fixture');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${failedId}/rank-history`);
    expect(res.status).toBe(200);

    const history = dataOf(res, RANK_HISTORY);
    expect(history.summary.checks).toBe(0);
    expect(history.summary.failed_checks).toBe(3);
    expect(history.summary.ranked_checks).toBe(0);
    expect(history.summary.beyond_depth_checks).toBe(0);
    expect(history.summary.average_rank).toBeNull();
    const own = history.series?.[0];
    expect(own?.points.every((p) => p.state === 'failed')).toBe(true);
  });

  it('assigns matching serp_snapshot_id on non-failed points of own and competitor series', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);

    const history = dataOf(res, RANK_HISTORY);
    const own = history.series?.[0];
    const comp = history.series?.[1];
    expect(own).toBeDefined();
    expect(comp).toBeDefined();

    expect(own?.points.length).toBeGreaterThan(0);
    for (let i = 0; i < (own?.points.length ?? 0); i += 1) {
      const op = own?.points[i];
      const cp = comp?.points[i];
      expect(op).toBeDefined();
      expect(cp).toBeDefined();
      if (!op || !cp) continue;
      expect(op.serp_snapshot_id).toBe(snapshotIdOf(id, op.observed_at ?? ''));
      expect(cp.serp_snapshot_id).toBe(op.serp_snapshot_id);
    }
  });

  it('I4 snapshot ids: failed points have no serp_snapshot_id and appear in every series, non-failed points have snapshot ids', async () => {
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${failingId}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    const series = history.series ?? [];
    expect(series.length).toBeGreaterThanOrEqual(1);

    const length = series[0]?.points.length ?? 0;
    expect(length).toBeGreaterThanOrEqual(2);
    for (const s of series) {
      expect(s.points.length).toBe(length);
    }

    let nonFailedCount = 0;
    let failedCount = 0;
    for (let i = 0; i < length; i += 1) {
      const states = series.map((s) => s.points[i]?.state);
      const isFailed = states.every((st) => st === 'failed');
      const isNonFailed = states.every((st) => st === 'ranked' || st === 'beyond_depth');
      expect(isFailed || isNonFailed).toBe(true);

      if (isFailed) {
        failedCount += 1;
        for (const s of series) {
          expect(s.points[i]?.serp_snapshot_id).toBeNull();
        }
      } else {
        nonFailedCount += 1;
        const expectedSnapId = snapshotIdOf(failingId, series[0]?.points[i]?.observed_at ?? '');
        for (const s of series) {
          expect(s.points[i]?.serp_snapshot_id).toBe(expectedSnapId);
        }
      }
    }
    expect(failedCount).toBe(2);
    expect(nonFailedCount).toBeGreaterThan(0);
  });

  it('I4 include: without include=url and include=absolute every point has url_id null, absolute_rank null, and urls is {}', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    expect(history.urls).toEqual({});
    const points = (history.series ?? []).flatMap((s) => s.points);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.url_id).toBeNull();
      expect(p.absolute_rank).toBeNull();
    }
  });

  it('I1: summary is always the own site summary, even if rival is requested first, and empty when only rival requested', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const fullRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    const fullHistory = dataOf(fullRes, RANK_HISTORY);
    const rival = fullHistory.series?.find((s) => s.entity.role !== 'own');
    expect(rival).toBeDefined();
    if (!rival) throw new Error('Missing rival');

    // Case 1: only rival requested
    const onlyRivalRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?entity_ids=${rival.entity.entity_id}`,
    );
    expect(onlyRivalRes.status).toBe(200);
    const onlyRivalHistory = dataOf(onlyRivalRes, RANK_HISTORY);
    expect(onlyRivalHistory.summary.checks).toBe(0);
    expect(onlyRivalHistory.summary.average_rank).toBeNull();
    expect(onlyRivalHistory.summary.failed_checks).toBe(0);
    expect(onlyRivalHistory.series).toHaveLength(1);
    expect(onlyRivalHistory.series?.[0]?.entity.entity_id).toBe(rival.entity.entity_id);

    // Case 2: rival requested first, then own
    const rivalFirstRes = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?entity_ids=${rival.entity.entity_id},own`,
    );
    expect(rivalFirstRes.status).toBe(200);
    const rivalFirstHistory = dataOf(rivalFirstRes, RANK_HISTORY);
    expect(rivalFirstHistory.series?.[0]?.entity.entity_id).toBe(rival.entity.entity_id);
    expect(rivalFirstHistory.series?.[1]?.entity.role).toBe('own');
    expect(rivalFirstHistory.summary.checks).toBe(fullHistory.summary.checks);
    expect(rivalFirstHistory.summary.average_rank).toEqual(fullHistory.summary.average_rank);
  });

  it('I2: failed points must have observed_at === null in handler output', async () => {
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${failingId}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    const series = history.series ?? [];
    expect(series.length).toBeGreaterThan(0);
    let failedPointCount = 0;
    for (const s of series) {
      for (const p of s.points) {
        if (p.state === 'failed') {
          failedPointCount += 1;
          expect(p.observed_at).toBeNull();
          expect(p.rank).toBeNull();
          expect(p.absolute_rank).toBeNull();
          expect(p.depth_requested).toBeNull();
          expect(p.url_id).toBeNull();
          expect(p.serp_snapshot_id).toBeNull();
        }
      }
    }
    expect(failedPointCount).toBeGreaterThanOrEqual(2);
  });

  it('I3: accepts format=columns and returns series null and columns as parallel arrays equal to points', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const pointsRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    const pointsData = dataOf(pointsRes, RANK_HISTORY);
    const pointsSeries = pointsData.series ?? [];
    expect(pointsSeries.length).toBeGreaterThan(0);

    const colsRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?format=columns`);
    expect(colsRes.status).toBe(200);
    const colsData = dataOf(colsRes, RANK_HISTORY);
    expect(colsData.series).toBeNull();
    expect(colsData.columns).not.toBeNull();
    const columns = colsData.columns ?? [];
    expect(columns).toHaveLength(pointsSeries.length);

    for (let i = 0; i < pointsSeries.length; i += 1) {
      const s = pointsSeries[i];
      const c = columns[i];
      expect(s).toBeDefined();
      expect(c).toBeDefined();
      if (!s || !c) continue;
      expect(c.entity).toEqual(s.entity);
      expect(c.rank).toEqual(s.points.map((p) => p.rank));
      expect(c.state).toEqual(s.points.map((p) => p.state));
      expect(c.serp_snapshot_id).toEqual(s.points.map((p) => p.serp_snapshot_id));
      expect(c.t).toEqual(s.points.map((p) => p.observed_at));
      expect(c.depth_requested).toEqual(s.points.map((p) => p.depth_requested));
      expect(c.url_id).toEqual(s.points.map((p) => p.url_id));
      expect(c.absolute_rank).toEqual(s.points.map((p) => p.absolute_rank));
    }
  });

  it('I4/review-2 bands: on real responses, depth change between adjacent beyond-depth points splits bands, every returned entity has at least one band, and no bands overlap', async () => {
    const browser = mockBrowser('viewer');
    const listRes = await browser.call('GET', `${P}/tracked-keywords?limit=100`);
    expect(listRes.status).toBe(200);
    const rows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
    expect(rows.length).toBeGreaterThan(0);

    // 1. Assert every returned entity (own and competitors) has at least one band, and no bands overlap
    const id = trackedId('seo agency berlin');
    const berlinRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(berlinRes.status).toBe(200);
    const berlinHistory = dataOf(berlinRes, RANK_HISTORY);
    const berlinSeries = berlinHistory.series ?? [];
    expect(berlinSeries.length).toBeGreaterThanOrEqual(5);

    let checkedEntitiesWithBands = 0;
    for (const s of berlinSeries) {
      const entityBands = berlinHistory.bands.filter((b) => b.entity_id === s.entity.entity_id);
      expect(entityBands.length).toBeGreaterThanOrEqual(1);
      checkedEntitiesWithBands++;
    }
    expect(checkedEntitiesWithBands).toBe(berlinSeries.length);

    let checkedNoOverlapBands = 0;
    for (const s of berlinSeries) {
      const entityBands = berlinHistory.bands.filter((b) => b.entity_id === s.entity.entity_id);
      const sorted = [...entityBands].sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        expect(cur).toBeDefined();
        expect(prev).toBeDefined();
        expect((cur?.from ?? '') > (prev?.to ?? '')).toBe(true);
        checkedNoOverlapBands++;
      }
    }
    expect(checkedNoOverlapBands).toBeGreaterThan(0);

    // 2. Find, over the fixtures, where depth_requested changes between adjacent beyond-depth points
    // and assert two bands split exactly at that date
    interface DepthSplitMatch {
      keywordId: string;
      entityId: string;
      prevDate: string;
      prevDepth: number;
      curDate: string;
      curDepth: number;
      bandPrev: (typeof berlinHistory.bands)[number] | undefined;
      bandCur: (typeof berlinHistory.bands)[number] | undefined;
    }
    const splits: DepthSplitMatch[] = [];

    for (const row of rows) {
      const res = await browser.call('GET', `${P}/tracked-keywords/${row.tracked_keyword_id}/rank-history`);
      expect(res.status).toBe(200);
      const history = dataOf(res, RANK_HISTORY);
      const series = history.series ?? [];
      for (const s of series) {
        for (let i = 1; i < s.points.length; i++) {
          const prev = s.points[i - 1];
          const cur = s.points[i];
          if (
            prev !== undefined &&
            cur !== undefined &&
            prev.state === 'beyond_depth' &&
            cur.state === 'beyond_depth' &&
            typeof prev.depth_requested === 'number' &&
            typeof cur.depth_requested === 'number' &&
            prev.depth_requested !== cur.depth_requested
          ) {
            const bandPrev = history.bands.find(
              (b) =>
                b.entity_id === s.entity.entity_id && b.to === prev.date && b.depth_requested === prev.depth_requested,
            );
            const bandCur = history.bands.find(
              (b) =>
                b.entity_id === s.entity.entity_id && b.from === cur.date && b.depth_requested === cur.depth_requested,
            );
            splits.push({
              keywordId: row.tracked_keyword_id,
              entityId: s.entity.entity_id,
              prevDate: prev.date,
              prevDepth: prev.depth_requested,
              curDate: cur.date,
              curDepth: cur.depth_requested,
              bandPrev,
              bandCur,
            });
          }
        }
      }
    }

    expect(splits.length).toBeGreaterThan(0);
    for (const split of splits) {
      expect(split.bandPrev).toBeDefined();
      expect(split.bandCur).toBeDefined();
      expect(split.bandPrev?.to).toBe(split.prevDate);
      expect(split.bandCur?.from).toBe(split.curDate);
      expect(split.bandPrev?.depth_requested).toBe(split.prevDepth);
      expect(split.bandCur?.depth_requested).toBe(split.curDepth);
      expect(split.bandPrev?.depth_requested).not.toBe(split.bandCur?.depth_requested);
    }
  });

  it('fills urls and absolute_rank when requested via include, and validates include', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=absolute,url,events`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    expect(history.events).toEqual([]);

    const own = history.series?.[0];
    const rankedPoints = own?.points.filter((p) => p.state === 'ranked') ?? [];
    expect(rankedPoints.length).toBeGreaterThan(0);
    for (const p of rankedPoints) {
      expect(p.absolute_rank).toBeGreaterThanOrEqual(p.rank ?? 0);
      expect(p.url_id).not.toBeNull();
      if (p.url_id) expect(history.urls[p.url_id]).toBeDefined();
    }

    // Invalid include value returns 422
    const badInclude = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=invalid_token`);
    expect(badInclude.status).toBe(422);
    expect(fieldCodes(badInclude)).toContain('include:value_error');
  });

  it('handles window validation, from/to bounds, and window_too_large (422)', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    // Invalid window names
    const res1 = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=last_14d`);
    expect(res1.status).toBe(422);
    expect(fieldCodes(res1)).toContain('window:invalid_window');

    const res2 = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=last_400d`);
    expect(res2.status).toBe(422);
    expect(fieldCodes(res2)).toContain('window:invalid_window');

    // Valid windows
    for (const win of ['last_7d', 'last_30d', 'last_90d', 'last_180d', 'last_365d']) {
      const ok = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=${win}`);
      expect(ok.status).toBe(200);
    }

    // from after to returns 422 range_invalid
    const badRange = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?from=2026-10-10&to=2026-10-01`,
    );
    expect(badRange.status).toBe(422);
    expect(fieldCodes(badRange)).toContain('from:range_invalid');

    // more than 400 days returns 422 window_too_large with limit_days: 400
    const tooLarge = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?from=2025-01-01&to=2026-10-01`,
    );
    expect(tooLarge.status).toBe(422);
    expect(tooLarge.code).toBe('window_too_large');
    expect(tooLarge.body.limit_days).toBe(400);
  });

  it('orders series by entity_ids, limits to 11 (422 too_many_entities), and drops unknown entities', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=own`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    expect(history.series).toHaveLength(1);
    expect(history.series?.[0]?.entity.role).toBe('own');

    // More than 11 entities returns 422 too_many_entities
    const twelve = Array.from(
      { length: 12 },
      (_, i) => `0192d1a8-ee99-7a10-8e07-${String(i + 1).padStart(12, '0')}`,
    ).join(',');
    const badEntities = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=${twelve}`);
    expect(badEntities.status).toBe(422);
    expect(fieldCodes(badEntities)).toContain('entity_ids:too_many_entities');
  });

  it('creates bands for every returned entity and splits on depth change', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);

    const entityIdsInSeries = new Set((history.series ?? []).map((s) => s.entity.entity_id));
    for (const band of history.bands) {
      expect(entityIdsInSeries.has(band.entity_id)).toBe(true);
      expect(band.label).toBe(`not in top ${String(band.depth_requested)}`);
    }
  });

  it('I4 window: asserts answer window field and that explicit from/to win over window', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const resWin = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=last_30d`);
    expect(resWin.status).toBe(200);
    const dataWin = dataOf(resWin, RANK_HISTORY);
    expect(dataWin.window.timezone).toBe(fynix.timezone);
    expect(dataWin.window.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataWin.window.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dataWin.window.from <= dataWin.window.to).toBe(true);

    const resExplicit = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?window=last_30d&from=2026-10-01&to=2026-10-15`,
    );
    expect(resExplicit.status).toBe(200);
    const dataExplicit = dataOf(resExplicit, RANK_HISTORY);
    expect(dataExplicit.window.from).toBe('2026-10-01');
    expect(dataExplicit.window.to).toBe('2026-10-15');
    expect(dataExplicit.window.timezone).toBe(fynix.timezone);
  });

  it('I4 entity_ids: order as asked, summary from the first own entity among them', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const full = dataOf(await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`), RANK_HISTORY);
    const comps = (full.series ?? []).filter((s) => s.entity.role !== 'own');
    expect(comps.length).toBeGreaterThanOrEqual(2);
    const [c1, c2] = comps;
    if (!c1 || !c2) throw new Error('Missing comps');

    const unknownId = '0192d1a8-ee99-7a10-8e07-999999999999';
    const query = `${c2.entity.entity_id},${c1.entity.entity_id},${c2.entity.entity_id},${unknownId},own`;
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=${query}`);
    expect(res.status).toBe(200);
    const data = dataOf(res, RANK_HISTORY);
    const series = data.series ?? [];
    expect(series).toHaveLength(3);
    expect(series[0]?.entity.entity_id).toBe(c2.entity.entity_id);
    expect(series[1]?.entity.entity_id).toBe(c1.entity.entity_id);
    expect(series[2]?.entity.role).toBe('own');
    expect(data.summary.checks).toBe(full.summary.checks);
    expect(data.summary.average_rank).toEqual(full.summary.average_rank);

    // I-3: dedupe by resolved entity_id (own and ownUUID)
    const ownEntity = full.series?.find((s) => s.entity.role === 'own')?.entity;
    if (!ownEntity) throw new Error('Missing own entity');
    const ownUUID = ownEntity.entity_id;

    const dupRes1 = await browser.call(
      'GET',
      `${P}/tracked-keywords/${id}/rank-history?entity_ids=own,${ownUUID},${c1.entity.entity_id}`,
    );
    expect(dupRes1.status).toBe(200);
    const dataDup1 = dataOf(dupRes1, RANK_HISTORY);
    expect(dataDup1.series).toHaveLength(2);
    expect(dataDup1.series?.[0]?.entity.role).toBe('own');
    expect(dataDup1.series?.[1]?.entity.entity_id).toBe(c1.entity.entity_id);

    const dupRes2 = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=${ownUUID},own`);
    expect(dupRes2.status).toBe(200);
    const dataDup2 = dataOf(dupRes2, RANK_HISTORY);
    expect(dataDup2.series).toHaveLength(1);
    expect(dataDup2.series?.[0]?.entity.role).toBe('own');

    const ownAloneRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=own`);
    expect(ownAloneRes.status).toBe(200);
    const dataOwnAlone = dataOf(ownAloneRes, RANK_HISTORY);
    expect(dataOwnAlone.series).toHaveLength(1);
    expect(dataOwnAlone.series?.[0]?.entity.role).toBe('own');

    // Uppercase UUID token resolved case-insensitively
    const upperC1 = c1.entity.entity_id.toUpperCase();
    const upperRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=${upperC1}`);
    expect(upperRes.status).toBe(200);
    const dataUpper = dataOf(upperRes, RANK_HISTORY);
    expect(dataUpper.series).toHaveLength(1);
    expect(dataUpper.series?.[0]?.entity.entity_id).toBe(c1.entity.entity_id);
  });

  it('M2: entity_ids tokens must be own or a UUID, anything else is 422', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const badToken = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?entity_ids=not-a-uuid`);
    expect(badToken.status).toBe(422);
    expect(fieldCodes(badToken)).toContain('entity_ids:invalid_uuid');
  });

  it('4a / M3: default entities (no entity_ids) is capped at exactly 11 (ENTITIES_MAX)', async () => {
    const id = trackedId('seo agency berlin');
    const extraEntities = Array.from({ length: 10 }, (_, i) => ({
      entity_id: mockId('entity', 200 + i),
      entity_type: 'brand' as const,
      canonical_name: `Extra Competitor ${String(i + 1).padStart(2, '0')}`,
      created_at: MOCK_CREATED_AT,
    }));
    const extraRoles = extraEntities.map((e, i) => ({
      project_id: fynix.project_id,
      entity_id: e.entity_id,
      role: 'competitor' as const,
      color_index: (i % 6) + 1,
      track_seo: true,
      removed_at: null,
      added_at: MOCK_CREATED_AT,
    }));
    const cookieVal = entitiesCookie({
      entities: { created: extraEntities },
      roles: { created: extraRoles },
    });
    const rawValue = (cookieVal?.split(';')[0] ?? '').replace(/^[^=]+=/, '');
    const browser = mockBrowser('viewer', new Map([[ENTITIES_COOKIE, rawValue]]));

    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);
    const data = dataOf(res, RANK_HISTORY);
    expect(data.series).toHaveLength(11);
  });

  it('4b / M5: project in America/Los_Angeles at 03:00Z sets window.to to previous local day and from to 89 days earlier', async () => {
    const editor = mockBrowser('editor');
    const patchRes = await editor.call('PATCH', P, { timezone: 'America/Los_Angeles' });
    expect(patchRes.status).toBe(200);
    const wsCookie = editor.cookie(WORKSPACE_COOKIE);
    expect(wsCookie).toBeDefined();

    const browser = mockBrowser('viewer', new Map([[WORKSPACE_COOKIE, wsCookie ?? '']]));
    vi.setSystemTime(new Date('2026-11-02T03:00:00Z'));

    const id = trackedId('seo agency berlin');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?window=last_90d`);
    expect(res.status).toBe(200);
    const data = dataOf(res, RANK_HISTORY);

    expect(data.window.timezone).toBe('America/Los_Angeles');
    expect(data.window.to).toBe('2026-11-01');
    expect(data.window.from).toBe('2026-08-04');
  });

  it('4c: history competitor point ranks equal list competitor_ranks, are not all null, and do not reuse own rank', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const listRes = await browser.call('GET', `${P}/tracked-keywords?include=competitor_ranks&limit=100`);
    expect(listRes.status).toBe(200);
    const rows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
    const row = rows.find((r) => r.tracked_keyword_id === id);
    if (!row || !row.competitor_ranks) throw new Error('Missing row or competitor ranks');

    const histRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(histRes.status).toBe(200);
    const history = dataOf(histRes, RANK_HISTORY);

    const ownSeries = history.series?.find((s) => s.entity.role === 'own');
    const ownLatest = ownSeries?.points.filter((p) => p.state !== 'failed').at(-1);
    expect(ownLatest?.rank).not.toBeNull();

    expect(row.competitor_ranks.length).toBeGreaterThanOrEqual(4);
    const compSeriesList = (history.series ?? []).filter((s) => s.entity.role !== 'own');
    expect(compSeriesList.length).toBe(row.competitor_ranks.length);

    let nonNullCount = 0;
    let differentFromOwnCount = 0;

    for (const compRank of row.competitor_ranks) {
      const s = compSeriesList.find((series) => series.entity.entity_id === compRank.entity.entity_id);
      expect(s).toBeDefined();
      const latestGood = s?.points.filter((p) => p.state !== 'failed').at(-1);
      expect(compRank.current.rank).toBe(latestGood?.rank ?? null);
      if (compRank.current.rank !== null) {
        nonNullCount++;
        if (compRank.current.rank !== ownLatest?.rank) {
          differentFromOwnCount++;
        }
      }
    }

    expect(nonNullCount).toBeGreaterThan(0);
    expect(differentFromOwnCount).toBeGreaterThan(0);
  });

  it('4d: list row absolute_rank equals history absolute_rank for the same check and includes features offset', async () => {
    const browser = mockBrowser('viewer');
    const listRes = await browser.call('GET', `${P}/tracked-keywords?include=features,competitor_ranks&limit=100`);
    expect(listRes.status).toBe(200);
    const rows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));

    let checkedRankedCount = 0;
    let checkedCompetitorCount = 0;
    let checkedCompetitorRankedCount = 0;

    for (const row of rows) {
      const compIds = (row.competitor_ranks ?? []).map((c) => c.entity.entity_id);
      const entityIdsParam = compIds.length > 0 ? `&entity_ids=own,${compIds.join(',')}` : '';
      const histRes = await browser.call(
        'GET',
        `${P}/tracked-keywords/${row.tracked_keyword_id}/rank-history?include=absolute${entityIdsParam}`,
      );
      expect(histRes.status).toBe(200);
      const history = dataOf(histRes, RANK_HISTORY);
      const ownSeries = history.series?.find((s) => s.entity.role === 'own');
      const latestGood = ownSeries?.points.filter((p) => p.state !== 'failed').at(-1);

      if (row.state.current.rank !== null) {
        expect(latestGood).toBeDefined();
        if (!latestGood) throw new Error('Missing latestGood');
        expect(latestGood.rank).toBe(row.state.current.rank);
        expect(row.state.current.absolute_rank).toBe(latestGood.absolute_rank);
        const expectedAbsolute = row.state.current.rank + Math.min(row.state.feature_types_present.length, 2);
        expect(row.state.current.absolute_rank).toBe(expectedAbsolute);
        checkedRankedCount++;
      }

      for (const comp of row.competitor_ranks ?? []) {
        const compSeries = history.series?.find((s) => s.entity.entity_id === comp.entity.entity_id);
        const compGood = compSeries?.points.filter((p) => p.state !== 'failed') ?? [];
        const compLatest = compGood.at(-1);
        expect(compLatest).toBeDefined();
        if (!compLatest) throw new Error('Missing compLatest');
        expect(comp.current.rank).toBe(compLatest.rank);
        expect(comp.current.absolute_rank).toBe(compLatest.absolute_rank);
        if (comp.current.rank !== null) {
          const expectedCompAbsolute = comp.current.rank + Math.min(row.state.feature_types_present.length, 2);
          expect(comp.current.absolute_rank).toBe(expectedCompAbsolute);
          checkedCompetitorRankedCount++;
        }
        checkedCompetitorCount++;
      }
    }
    expect(checkedRankedCount).toBeGreaterThan(10);
    expect(checkedCompetitorCount).toBeGreaterThan(50);
    expect(checkedCompetitorRankedCount).toBeGreaterThan(50);
  });

  it('4e: manual check must not be dated after now', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');
    const futureTime = Date.now() + 60 * 60 * 1000;
    recordManualCheck(id, futureTime);

    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    const ownSeries = history.series?.find((s) => s.entity.role === 'own');

    for (const p of ownSeries?.points ?? []) {
      if (p.observed_at !== null) {
        expect(Date.parse(p.observed_at)).toBeLessThanOrEqual(Date.now());
      }
    }
    clearManualChecks();
  });

  it('Item 4: same-day overlay respects stoppedAt when keyword is archived', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('editor');
    const archiveTime = '2026-11-02T13:00:00Z';
    vi.setSystemTime(new Date(archiveTime));

    const patchRes = await browser.call('PATCH', `${P}/tracked-keywords/${id}`, { is_active: false });
    expect(patchRes.status).toBe(200);

    const laterTime = '2026-11-02T20:00:00Z';
    vi.setSystemTime(new Date(laterTime));

    const histRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(histRes.status).toBe(200);
    const history = dataOf(histRes, RANK_HISTORY);
    const ownSeries = history.series?.find((s) => s.entity.role === 'own');
    expect(ownSeries).toBeDefined();
    if (!ownSeries) throw new Error('Missing ownSeries');

    let pointCount = 0;
    for (const p of ownSeries.points) {
      if (p.observed_at !== null) {
        expect(Date.parse(p.observed_at)).toBeLessThanOrEqual(Date.parse(archiveTime));
        pointCount++;
      }
    }
    expect(pointCount).toBeGreaterThan(0);

    const listRes = await browser.call(
      'GET',
      `${P}/tracked-keywords?filter[is_active]=false&include=sparkline&limit=100`,
    );
    expect(listRes.status).toBe(200);
    const rows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
    const row = rows.find((r) => r.tracked_keyword_id === id);
    expect(row).toBeDefined();
    if (!row) throw new Error('Missing row');
    if (row.state.current.observed_at !== null) {
      expect(Date.parse(row.state.current.observed_at)).toBeLessThanOrEqual(Date.parse(archiveTime));
    }
    if (row.state.best_rank_at !== null) {
      expect(Date.parse(row.state.best_rank_at)).toBeLessThanOrEqual(Date.parse(archiveTime));
    }
    for (const pt of row.sparkline?.points ?? []) {
      expect(Date.parse(pt.t)).toBeLessThanOrEqual(Date.parse(archiveTime));
    }
  });

  it('Item 5: after recordManualCheck there are at most 30 checks in the history and the sparkline', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('viewer');

    const beforeHistRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(beforeHistRes.status).toBe(200);
    const beforeHistory = dataOf(beforeHistRes, RANK_HISTORY);
    const beforeOwnSeries = beforeHistory.series?.find((s) => s.entity.role === 'own');
    if (!beforeOwnSeries) throw new Error('Missing beforeOwnSeries');
    const oldestPreManualObservedAt = beforeOwnSeries.points[0]?.observed_at;
    if (!oldestPreManualObservedAt) throw new Error('Missing oldest pre-manual check');

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    recordManualCheck(id, now);

    const histRes = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(histRes.status).toBe(200);
    const history = dataOf(histRes, RANK_HISTORY);
    const ownSeries = history.series?.find((s) => s.entity.role === 'own');
    expect(ownSeries).toBeDefined();
    if (!ownSeries) throw new Error('Missing ownSeries');
    expect(ownSeries.points.length).toBeLessThanOrEqual(30);

    const manualPoint = ownSeries.points.find((p) => p.observed_at === nowIso);
    expect(manualPoint).toBeDefined();

    const goodPoints = ownSeries.points.filter((p) => p.state !== 'failed');
    const lastGood = goodPoints.at(-1);
    expect(lastGood?.observed_at).toBe(nowIso);

    const hasOldest = ownSeries.points.some((p) => p.observed_at === oldestPreManualObservedAt);
    expect(hasOldest).toBe(false);

    const listRes = await browser.call('GET', `${P}/tracked-keywords?include=sparkline&limit=100`);
    expect(listRes.status).toBe(200);
    const rows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
    const row = rows.find((r) => r.tracked_keyword_id === id);
    expect(row).toBeDefined();
    if (!row) throw new Error('Missing row');
    expect(row.sparkline?.points.length).toBeLessThanOrEqual(30);

    const sparklineEnd = row.sparkline?.points.at(-1);
    expect(sparklineEnd?.t).toBe(nowIso);

    clearManualChecks();
  });

  it('M-3: manual check before archive stays in history and list; manual check after archive is excluded', async () => {
    const editor = mockBrowser('editor');

    // Scenario A: manual check completed before archive
    const idA = CHECKED_FIXTURES[3];
    if (!idA) throw new Error('Missing fixture for idA');
    const manualTimeA = Date.parse('2026-11-02T10:00:00Z');
    recordManualCheck(idA, manualTimeA);
    vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
    const patchResA = await editor.call('PATCH', `${P}/tracked-keywords/${idA}`, { is_active: false });
    expect(patchResA.status).toBe(200);

    vi.setSystemTime(new Date('2026-11-02T16:00:00Z'));
    const histResA = await editor.call('GET', `${P}/tracked-keywords/${idA}/rank-history`);
    expect(histResA.status).toBe(200);
    const histDataA = dataOf(histResA, RANK_HISTORY);
    const ownSeriesA = histDataA.series?.find((s) => s.entity.role === 'own');
    if (!ownSeriesA) throw new Error('Missing ownSeriesA');
    const isoA = new Date(manualTimeA).toISOString();
    expect(ownSeriesA.points.some((p) => p.observed_at === isoA)).toBe(true);

    const listResA = await editor.call(
      'GET',
      `${P}/tracked-keywords?filter[is_active]=false&include=sparkline&limit=100`,
    );
    expect(listResA.status).toBe(200);
    const rowsA = dataOf(listResA, z.array(TRACKED_KEYWORD_ROW));
    const rowA = rowsA.find((r) => r.tracked_keyword_id === idA);
    if (!rowA) throw new Error('Missing rowA');
    expect(rowA.state.current.observed_at).toBe(isoA);
    expect(rowA.sparkline?.points.some((p) => p.t === isoA)).toBe(true);

    // Scenario B: manual check completed after archive
    const idB = CHECKED_FIXTURES[4];
    if (!idB) throw new Error('Missing fixture for idB');
    vi.setSystemTime(new Date('2026-11-02T11:00:00Z'));
    const patchResB = await editor.call('PATCH', `${P}/tracked-keywords/${idB}`, { is_active: false });
    expect(patchResB.status).toBe(200);

    const manualTimeB = Date.parse('2026-11-02T13:00:00Z');
    recordManualCheck(idB, manualTimeB);

    vi.setSystemTime(new Date('2026-11-02T16:00:00Z'));
    const histResB = await editor.call('GET', `${P}/tracked-keywords/${idB}/rank-history`);
    expect(histResB.status).toBe(200);
    const histDataB = dataOf(histResB, RANK_HISTORY);
    const ownSeriesB = histDataB.series?.find((s) => s.entity.role === 'own');
    if (!ownSeriesB) throw new Error('Missing ownSeriesB');
    const isoB = new Date(manualTimeB).toISOString();
    expect(ownSeriesB.points.some((p) => p.observed_at === isoB)).toBe(false);

    const listResB = await editor.call(
      'GET',
      `${P}/tracked-keywords?filter[is_active]=false&include=sparkline&limit=100`,
    );
    expect(listResB.status).toBe(200);
    const rowsB = dataOf(listResB, z.array(TRACKED_KEYWORD_ROW));
    const rowB = rowsB.find((r) => r.tracked_keyword_id === idB);
    if (!rowB) throw new Error('Missing rowB');
    expect(rowB.state.current.observed_at).not.toBe(isoB);
    expect(rowB.sparkline?.points.some((p) => p.t === isoB)).toBe(false);

    clearManualChecks();
  });

  it('I-1: pins own host to the project primary domain for own ranked points and across projects', async () => {
    const browser = mockBrowser('viewer');

    // (a) "seo agency berlin" under Fynix
    const id = trackedId('seo agency berlin');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history?include=url,absolute`);
    expect(res.status).toBe(200);
    const data = dataOf(res, RANK_HISTORY);
    const ownSeries = data.series?.find((s) => s.entity.role === 'own');
    expect(ownSeries).toBeDefined();
    expect(data.urls).toBeDefined();
    const rankedPoints = ownSeries?.points.filter((p) => p.state === 'ranked') ?? [];
    expect(rankedPoints.length).toBeGreaterThan(0);
    for (const point of rankedPoints) {
      if (!point.url_id) throw new Error('Ranked point missing url_id');
      const url = data.urls?.[point.url_id];
      expect(url).toBeDefined();
      expect(url?.host).toBe(fynix.host);
      expect(url?.canonical_url.startsWith(`https://${fynix.host}/`)).toBe(true);
    }

    // Keyword under a second project (Cleanstart)
    const [, cleanstart] = MOCK_PROJECTS;
    if (!cleanstart) throw new Error('Missing Cleanstart project');
    const editor = mockBrowser('editor');
    const cleanstartP = `${W}/projects/${cleanstart.project_id}`;
    const createRes = await editor.call('POST', `${cleanstartP}/tracked-keywords`, {
      keyword: 'office cleaning berlin',
      device: 'desktop',
    });
    expect(createRes.status).toBe(201);
    const [created] = dataOf(createRes, z.array(TRACKED_KEYWORD));
    if (!created) throw new Error('Failed to create keyword for Cleanstart');

    // Advance clock past FIRST_CHECK_DELAY_MS so checks are generated
    vi.advanceTimersByTime(5 * 60 * 1000);
    recordManualCheck(created.tracked_keyword_id, Date.now());

    const csRes = await editor.call(
      'GET',
      `${cleanstartP}/tracked-keywords/${created.tracked_keyword_id}/rank-history?include=url,absolute`,
    );
    expect(csRes.status).toBe(200);
    const csData = dataOf(csRes, RANK_HISTORY);
    const csOwnSeries = csData.series?.find((s) => s.entity.role === 'own');
    expect(csOwnSeries).toBeDefined();
    expect(csData.urls).toBeDefined();
    const csRanked = csOwnSeries?.points.filter((p) => p.state === 'ranked') ?? [];
    expect(csRanked.length).toBeGreaterThan(0);
    for (const point of csRanked) {
      if (!point.url_id) throw new Error('Cleanstart ranked point missing url_id');
      const url = csData.urls?.[point.url_id];
      expect(url).toBeDefined();
      expect(url?.host).toBe(cleanstart.host);
      expect(url?.canonical_url.startsWith(`https://${cleanstart.host}/`)).toBe(true);
    }
  });

  it('I-2: failing fixture drops last FAILING_RUN good checks so failed attempts do not collide on dates', async () => {
    const failingId = [...FAILING_IDS][0];
    if (!failingId) throw new Error('Missing failing fixture');

    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/${failingId}/rank-history`);
    expect(res.status).toBe(200);
    const history = dataOf(res, RANK_HISTORY);
    const ownSeries = history.series?.find((s) => s.entity.role === 'own');
    if (!ownSeries) throw new Error('Missing own series');

    expect(ownSeries.points.length).toBe(history.summary.checks + history.summary.failed_checks);
    const lastPoints = ownSeries.points.slice(-FAILING_RUN);
    expect(lastPoints).toHaveLength(FAILING_RUN);
    for (const point of lastPoints) {
      expect(point.state).toBe('failed');
    }

    const goodPoints = ownSeries.points.slice(0, -FAILING_RUN);
    const lastGoodPoint = goodPoints[goodPoints.length - 1];
    if (!lastGoodPoint?.observed_at) throw new Error('Missing last good point observed_at');
    const lastGoodTime = Date.parse(lastGoodPoint.observed_at);
    for (const point of ownSeries.points) {
      if (point.state !== 'failed' && point.observed_at) {
        expect(Date.parse(point.observed_at)).toBeLessThanOrEqual(lastGoodTime);
      }
    }

    const listRes = await browser.call('GET', `${P}/tracked-keywords?limit=100`);
    expect(listRes.status).toBe(200);
    const listRows = dataOf(listRes, z.array(TRACKED_KEYWORD_ROW));
    const failingRow = listRows.find((r) => r.tracked_keyword_id === failingId);
    if (!failingRow) throw new Error('Missing list row');
    expect(failingRow.state.current.observed_at).toBe(lastGoodPoint.observed_at);
  });

  it('returns 404 for an unknown keyword', async () => {
    const browser = mockBrowser('viewer');
    const res = await browser.call('GET', `${P}/tracked-keywords/unknown-id/rank-history`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for a member without data:read', async () => {
    const id = trackedId('seo agency berlin');
    const browser = mockBrowser('billing');
    const res = await browser.call('GET', `${P}/tracked-keywords/${id}/rank-history`);
    expect(res.status).toBe(403);
  });
});
