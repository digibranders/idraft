import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MOCK_PROJECTS, MOCK_WORKSPACE } from '../fixtures';
import { KEYWORD_TABLE } from '../keyword-table';
import { mockId } from '../mock-ids';
import { aioAt, clearManualChecks, featuresAt, recordManualCheck } from '../serp-world';
import { PROJECT, SERP_CURRENT, SERP_SNAPSHOT_DETAIL, SERP_SNAPSHOT_PAGE, TRACKED_KEYWORD } from '@/test/api-shapes';
import { dataOf, mockBrowser, type MockBrowser } from '@/test/mock-api';

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

const berlin = trackedId('seo agency berlin');

const snapshotsOf = async (
  browser: MockBrowser,
  path: string,
  query: string,
): Promise<z.infer<typeof SERP_SNAPSHOT_PAGE>> => {
  const res = await browser.call('GET', `${path}/serp-snapshots?${query}`);
  expect(res.status).toBe(200);
  return SERP_SNAPSHOT_PAGE.parse(res.body);
};

describe('SERP snapshots', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
    clearManualChecks();
  });

  afterEach(() => {
    clearManualChecks();
    vi.useRealTimers();
  });

  it('T4: pages by limit and cursor without overlap, and binds the cursor to its filters', async () => {
    const browser = mockBrowser('viewer');
    const base = `${P}/tracked-keywords/${berlin}`;
    const all = (await snapshotsOf(browser, base, 'limit=50')).data.map((s) => s.serp_snapshot_id);
    expect(all.length).toBeGreaterThan(20);

    const pages: string[][] = [];
    let cursor: string | null = null;
    let firstCursor = '';
    do {
      const cursorQuery: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const page = await snapshotsOf(browser, base, `limit=7${cursorQuery}`);
      pages.push(page.data.map((s) => s.serp_snapshot_id));
      cursor = page.page.next_cursor;
      expect(page.page.limit).toBe(7);
      expect(page.page.has_more).toBe(cursor !== null);
      firstCursor = firstCursor || (cursor ?? '');
    } while (cursor !== null && pages.length < 20);
    expect(cursor).toBeNull();

    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages.slice(0, -1)) expect(page).toHaveLength(7);
    // No row twice, none lost, same order as the unpaged list
    expect(pages.flat()).toEqual(all);

    // The cursor is for the filters it was made under
    expect(firstCursor).toMatch(/\S/);
    for (const filter of ['filter[depth_requested]=20', 'filter[has_ai_overview]=true', 'from=2026-10-01']) {
      const reused = await browser.call(
        'GET',
        `${base}/serp-snapshots?limit=7&${filter}&cursor=${encodeURIComponent(firstCursor)}`,
      );
      expect(reused.status).toBe(400);
      expect(reused.code).toBe('invalid_cursor');
    }
    const sameFilters = await browser.call(
      'GET',
      `${base}/serp-snapshots?limit=7&cursor=${encodeURIComponent(firstCursor)}`,
    );
    expect(sameFilters.status).toBe(200);
  });

  it('T4: the detail and the raw answer accept observed_at, and the detail is the same with it', async () => {
    const analyst = mockBrowser('analyst');
    const page = await snapshotsOf(analyst, `${P}/tracked-keywords/${berlin}`, 'limit=10');
    const snap = page.data[4];
    expect(snap).toBeDefined();
    const id = snap?.serp_snapshot_id ?? '';
    const plain = await analyst.call('GET', `${P}/serp-snapshots/${id}`);
    expect(plain.status).toBe(200);
    const withObserved = await analyst.call(
      'GET',
      `${P}/serp-snapshots/${id}?observed_at=${encodeURIComponent(snap?.observed_at ?? '')}`,
    );
    expect(withObserved.status).toBe(200);
    expect(dataOf(withObserved, SERP_SNAPSHOT_DETAIL)).toEqual(dataOf(plain, SERP_SNAPSHOT_DETAIL));

    const raw = await analyst.call(
      'GET',
      `${P}/serp-snapshots/${id}/raw?observed_at=${encodeURIComponent(snap?.observed_at ?? '')}`,
    );
    expect(raw.status).toBe(200);
  });

  it('T5: the detail features are the features of that check, the organic items run from 1 to depth_returned', async () => {
    const browser = mockBrowser('viewer');
    const snaps = (await snapshotsOf(browser, `${P}/tracked-keywords/${berlin}`, 'limit=12')).data;
    expect(snaps).toHaveLength(12);

    let ownedFeatures = 0;
    let aioBlocks = 0;
    let featuresWithCompetitors = 0;
    for (const snap of snaps) {
      const detail = dataOf(
        await browser.call('GET', `${P}/serp-snapshots/${snap.serp_snapshot_id}`),
        SERP_SNAPSHOT_DETAIL,
      );
      const expected = featuresAt(berlin, snap.observed_at, snap.own.rank !== null);

      expect(
        detail.features.map((f) => [f.feature_type, f.ordinal, f.rank_absolute, f.owned_by_project, f.owned_position]),
      ).toEqual(
        expected.map((f) => [
          f.type,
          f.ordinal,
          f.positionAbsolute,
          f.owned && f.type !== 'ai_overview',
          f.owned && f.type !== 'ai_overview' ? f.positionAbsolute : null,
        ]),
      );
      expect(detail.item_types).toEqual(['organic', ...expected.map((f) => f.type)]);
      expect(detail.organic.map((o) => o.organic_rank)).toEqual(
        Array.from({ length: detail.depth_returned }, (_, i) => i + 1),
      );

      // The AI Overview lists the sources of that check, no other feature does
      const aio = detail.features.find((f) => f.feature_type === 'ai_overview');
      const sources = aio === undefined ? 0 : aioAt(berlin, snap.observed_at).sources;
      expect(aio?.source_urls.map((u) => u.canonical_url) ?? []).toEqual(
        Array.from({ length: sources }, (_, i) => `https://source-${String(i + 1)}.com/article`),
      );
      aioBlocks += aio === undefined ? 0 : 1;
      for (const f of detail.features.filter((x) => x.feature_type !== 'ai_overview')) {
        expect(f.source_urls).toEqual([]);
      }

      // The competitors of a feature are competitors of the project that rank in the top 10 of that check
      const topCompetitors = new Set(
        detail.organic
          .filter((o) => o.entity?.role === 'competitor' && o.organic_rank <= 10)
          .map((o) => o.entity?.entity_id),
      );
      for (const f of detail.features) {
        expect(f.competitor_entity_ids).toEqual([...f.competitor_entity_ids].sort());
        for (const entityId of f.competitor_entity_ids) expect(topCompetitors.has(entityId)).toBe(true);
        featuresWithCompetitors += f.competitor_entity_ids.length > 0 ? 1 : 0;
      }
      ownedFeatures += detail.features.filter((f) => f.owned_by_project).length;
    }
    expect(ownedFeatures).toBeGreaterThan(0);
    expect(aioBlocks).toBeGreaterThan(0);
    expect(featuresWithCompetitors).toBeGreaterThan(0);
  });

  it('T5: titles_source is unavailable for an older snapshot when no row has an entity to title', async () => {
    const editor = mockBrowser('editor');
    const created = await editor.call('POST', `${W}/projects`, {
      name: 'No Entity Project',
      slug: 'no-entity',
      default_location_id: 2276,
      default_language_code: 'en',
    });
    expect(created.status).toBe(201);
    const projectPath = `${W}/projects/${dataOf(created, PROJECT).project_id}`;
    const tracked = await editor.call('POST', `${projectPath}/tracked-keywords`, {
      keyword: 'berlin marketing agency',
      device: 'desktop',
    });
    expect(tracked.status).toBe(201);
    const trackedKeywordId = dataOf(tracked, z.array(TRACKED_KEYWORD))[0]?.tracked_keyword_id ?? '';
    expect(trackedKeywordId).toMatch(/^[0-9a-f-]{36}$/);

    // A manual check on top of the first one gives two snapshots, and the project has no entity to give a result
    recordManualCheck(trackedKeywordId, Date.parse('2026-11-02T16:00:00Z'));
    vi.setSystemTime(new Date('2026-11-02T17:00:00Z'));
    const snaps = (await snapshotsOf(editor, `${projectPath}/tracked-keywords/${trackedKeywordId}`, 'limit=5')).data;
    expect(snaps.length).toBeGreaterThan(1);
    const [latest, older] = snaps;

    const latestDetail = dataOf(
      await editor.call('GET', `${projectPath}/serp-snapshots/${latest?.serp_snapshot_id ?? ''}?include=titles`),
      SERP_SNAPSHOT_DETAIL,
    );
    expect(latestDetail.titles_source).toBe('serp_current_results');
    const current = dataOf(
      await editor.call('GET', `${projectPath}/tracked-keywords/${trackedKeywordId}/serp-current`),
      SERP_CURRENT,
    );
    expect(current.results.every((r) => r.entity === null)).toBe(true);

    const olderDetail = dataOf(
      await editor.call('GET', `${projectPath}/serp-snapshots/${older?.serp_snapshot_id ?? ''}?include=titles`),
      SERP_SNAPSHOT_DETAIL,
    );
    expect(olderDetail.organic.length).toBeGreaterThan(0);
    expect(olderDetail.organic.every((o) => o.entity === null)).toBe(true);
    expect(olderDetail.organic.every((o) => o.title === null && o.snippet === null)).toBe(true);
    expect(olderDetail.titles_source).toBe('unavailable');
  });

  it('T6: the raw answer of an unknown snapshot, or of a snapshot of another project, is 404', async () => {
    const analyst = mockBrowser('analyst');
    const unknown = await analyst.call('GET', `${P}/serp-snapshots/9007199254740991/raw`);
    expect(unknown.status).toBe(404);
    expect(unknown.code).toBe('not_found');

    const current = dataOf(await analyst.call('GET', `${P}/tracked-keywords/${berlin}/serp-current`), SERP_CURRENT);
    const id = current.serp_snapshot_id ?? '';
    expect(id).toMatch(/^\d+$/);
    expect((await analyst.call('GET', `${P}/serp-snapshots/${id}/raw`)).status).toBe(200);
    expect((await analyst.call('GET', `${foreignP}/serp-snapshots/${id}/raw`)).status).toBe(404);
  });
});
