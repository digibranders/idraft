import { describe, expect, it } from 'vitest';

import { MOCK_TRACKED_KEYWORDS, PENDING_TRACKED_IDS } from './keyword-fixtures';
import { checksOf, FIRST_CHECK_DELAY_MS, type MockCheck } from './rank-history';
import { changeOf, FAILED_IDS, FAILING_IDS, rankStateOf, STALE_IDS, stoppedAtOf } from './rank-state';
import { FEATURE_TYPES } from '@/lib/keywords/serp-features';
import { TRACKED_KEYWORD_STATE } from '@/test/api-shapes';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const CREATED = '2026-06-15T08:00:00Z';
const DOMAIN = 'fynix.digital';
const idOf = (n: number): string => `0192d1a8-ee99-7a10-8e07-${String(n).padStart(12, '0')}`;

const side = (rank: number | null, depth: number, observedAt = '2026-10-05T02:00:00.000Z') => ({
  rank,
  depth,
  observedAt,
});

describe('mock rank change', () => {
  const before = side(7, 20, '2026-10-04T02:00:00.000Z');

  it('is the first check when there is no check before it', () => {
    expect(changeOf(null, side(3, 20))).toEqual({
      label: 'first_check',
      value: null,
      previous_rank: null,
      previous_observed_at: null,
    });
  });

  it('is numeric, previous minus current, when both ranks lie within the smaller depth', () => {
    expect(changeOf(before, side(4, 20))).toEqual({
      label: 'numeric',
      value: 3,
      previous_rank: 7,
      previous_observed_at: '2026-10-04T02:00:00.000Z',
    });
    expect(changeOf(before, side(9, 20))).toMatchObject({ label: 'numeric', value: -2 });
    expect(changeOf(before, side(7, 20))).toMatchObject({ label: 'numeric', value: 0 });
  });

  it('is new when only the current rank lies within the depth, and lost when only the previous one does', () => {
    expect(changeOf(side(null, 20), side(12, 20))).toMatchObject({ label: 'new', value: null, previous_rank: null });
    expect(changeOf(before, side(null, 20))).toMatchObject({ label: 'lost', value: null, previous_rank: 7 });
  });

  it('reads both checks within the smaller depth of the two', () => {
    // 35 is ranked at depth 50 but beyond the 20 that the other check looked at: the keyword is lost, not 28 places down
    expect(changeOf(before, side(35, 50))).toMatchObject({ label: 'lost', value: null });
    expect(changeOf(side(35, 50), side(7, 20))).toMatchObject({ label: 'new', value: null, previous_rank: 35 });
    // At the depth of the smaller check the boundary itself still counts
    expect(changeOf(side(20, 50), side(20, 20))).toMatchObject({ label: 'numeric', value: 0 });
    expect(changeOf(side(21, 50), side(20, 20))).toMatchObject({ label: 'new' });
    expect(changeOf(side(20, 20), side(21, 50))).toMatchObject({ label: 'lost' });
  });

  it('is consistent beyond when a rank exists but lies beyond the compared depth, and unchanged beyond when none does', () => {
    expect(changeOf(side(35, 50), side(null, 20))).toMatchObject({ label: 'consistent_beyond', value: null });
    expect(changeOf(side(null, 20), side(35, 50))).toMatchObject({ label: 'consistent_beyond', value: null });
    expect(changeOf(side(35, 50), side(40, 50))).toMatchObject({ label: 'numeric', value: -5 });
    expect(changeOf(side(35, 50), side(30, 20))).toMatchObject({ label: 'consistent_beyond' });
    expect(changeOf(side(null, 20), side(null, 50))).toMatchObject({ label: 'unchanged_beyond', value: null });
  });
});

describe('mock rank state', () => {
  /** The first ids from `idOf(1)` whose state at `now` (a keyword created 4 minutes before it) is ranked, and beyond. */
  const justChecked = (n: number) => rankStateOf(idOf(n), new Date(NOW - 4 * 60_000).toISOString(), NOW, DOMAIN);

  it('is not checked for a keyword created a minute ago, whatever its id', () => {
    for (let n = 1; n <= 20; n += 1) {
      const state = rankStateOf(idOf(n), new Date(NOW - 60_000).toISOString(), NOW, DOMAIN);
      expect(state).toEqual({
        current: {
          state: 'not_checked',
          rank: null,
          absolute_rank: null,
          depth_requested: null,
          url: null,
          observed_at: null,
          serp_snapshot_id: null,
        },
        change: { label: 'first_check', value: null, previous_rank: null, previous_observed_at: null },
        best_rank: null,
        best_rank_at: null,
        worst_rank: null,
        first_ranked_at: null,
        feature_types_present: [],
        owned_feature_types: [],
        aio: { state: 'unknown', citation_position: null, observation_id: null },
        target_url_match: null,
        url_changed_at: null,
        consecutive_failures: 0,
        is_stale: false,
        last_observed_at: null,
        ranking_url_count: 0,
      });
    }
  });

  it('gets its first check after the first check delay: ranked or beyond the depth, with a first_check change', () => {
    const states = Array.from({ length: 40 }, (_, index) => justChecked(index + 1));
    const ranked = states.find((state) => state.current.state === 'ranked');
    const beyond = states.find((state) => state.current.state === 'beyond_depth');
    if (ranked === undefined || beyond === undefined) throw new Error('40 keywords gave no ranked and no beyond case');
    for (const state of [ranked, beyond]) {
      expect(TRACKED_KEYWORD_STATE.parse(state)).toBeDefined();
      expect(state.change).toMatchObject({ label: 'first_check', value: null });
      expect(state.current.observed_at).toBe(new Date(NOW - 4 * 60_000 + FIRST_CHECK_DELAY_MS).toISOString());
      expect(state.last_observed_at).toBe(state.current.observed_at);
      expect(state.current.depth_requested).toBeGreaterThanOrEqual(20);
      expect(state.is_stale).toBe(false);
    }
    expect(ranked.current.rank).toBeGreaterThanOrEqual(1);
    expect(ranked.current.rank).toBeLessThanOrEqual(ranked.current.depth_requested ?? 0);
    expect(ranked.ranking_url_count).toBeGreaterThanOrEqual(1);
    const url = ranked.current.url;
    expect(url).toMatchObject({ host: DOMAIN, registrable_domain: DOMAIN });
    expect(url?.canonical_url).toBe(`https://${DOMAIN}${url?.path ?? ''}`);
    expect(url?.path).toMatch(/^\//);
    // The id is a decimal integer text so that `filter[ranking_url_id]` can match it
    expect(url?.url_id).toMatch(/^[1-9]\d*$/);
    expect(beyond.current).toMatchObject({ rank: null, url: null });
    expect(beyond.ranking_url_count).toBe(0);
  });

  it('gives the same URL the same id', () => {
    const urls = Array.from({ length: 60 }, (_, index) => justChecked(index + 1).current.url).filter(
      (url) => url !== null,
    );
    const byPath = new Map<string, string>();
    for (const url of urls) {
      expect(byPath.get(url.path) ?? url.url_id).toBe(url.url_id);
      byPath.set(url.path, url.url_id);
    }
    expect(new Set(byPath.values()).size).toBe(byPath.size);
  });

  it('takes its change, previous rank and previous time from the two latest checks', () => {
    for (let n = 1; n <= 30; n += 1) {
      const checks = checksOf(idOf(n), CREATED, NOW);
      const state = rankStateOf(idOf(n), CREATED, NOW, DOMAIN);
      const last = checks.at(-1);
      const previous = checks.at(-2);
      if (last === undefined || previous === undefined) throw new Error('A keyword from June has no history');
      expect(state.change).toEqual(changeOf(previous, last));
      expect(state.current.rank).toBe(last.rank);
      expect(state.current.depth_requested).toBe(last.depth);
      expect(state.current.state).toBe(last.rank === null ? 'beyond_depth' : 'ranked');
      expect(state.last_observed_at).toBe(last.observedAt);
    }
  });

  it('has a best, worst and best-at over the ranked checks only', () => {
    let seen = 0;
    for (let n = 1; n <= 30; n += 1) {
      const checks = checksOf(idOf(n), CREATED, NOW);
      const ranked = checks.filter((check): check is MockCheck & { rank: number } => check.rank !== null);
      const state = rankStateOf(idOf(n), CREATED, NOW, DOMAIN);
      if (ranked.length === 0) {
        expect([state.best_rank, state.worst_rank, state.best_rank_at, state.first_ranked_at]).toEqual([
          null,
          null,
          null,
          null,
        ]);
        continue;
      }
      seen += 1;
      const best = Math.min(...ranked.map((check) => check.rank));
      expect(state.best_rank).toBe(best);
      expect(state.worst_rank).toBe(Math.max(...ranked.map((check) => check.rank)));
      // The first check that reached the best rank
      expect(state.best_rank_at).toBe(ranked.find((check) => check.rank === best)?.observedAt);
      expect(state.first_ranked_at).toBe(ranked[0]?.observedAt);
      if (state.current.rank !== null) expect(state.best_rank).toBeLessThanOrEqual(state.current.rank);
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('is the same every time, and is valid against the contract', () => {
    for (let n = 1; n <= 12; n += 1) {
      const a = rankStateOf(idOf(n), CREATED, NOW, DOMAIN);
      expect(a).toEqual(rankStateOf(idOf(n), CREATED, NOW, DOMAIN));
      expect(TRACKED_KEYWORD_STATE.parse(a)).toBeDefined();
    }
  });

  it('is not stale while the daily checks run, at any hour of the day', () => {
    for (let n = 1; n <= 10; n += 1) {
      for (let hour = 0; hour < 48; hour += 5) {
        const state = rankStateOf(idOf(n), CREATED, NOW + hour * HOUR_MS, DOMAIN);
        expect(state.is_stale).toBe(false);
      }
    }
  });

  it('keeps a few fixture keywords stale: their latest check is at least 40 hours old', () => {
    expect(STALE_IDS.size).toBeGreaterThanOrEqual(2);
    for (const id of STALE_IDS) {
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      const state = rankStateOf(id, created, NOW, DOMAIN);
      expect(state.is_stale).toBe(true);
      expect(state.current.state).not.toBe('not_checked');
      expect(NOW - Date.parse(state.last_observed_at ?? '')).toBeGreaterThanOrEqual(40 * HOUR_MS);
    }
  });

  it('keeps one stale fixture keyword failing after good checks: its rank stays, the failures are counted', () => {
    expect(FAILING_IDS.size).toBe(1);
    for (const id of FAILING_IDS) {
      expect(STALE_IDS.has(id)).toBe(true);
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      const state = rankStateOf(id, created, NOW, DOMAIN);
      // `current` is from the last good check; only the count says that checks since then failed
      expect(['ranked', 'beyond_depth']).toContain(state.current.state);
      expect(state.last_observed_at).not.toBeNull();
      expect(state.consecutive_failures).toBe(2);
      expect(TRACKED_KEYWORD_STATE.parse(state)).toBeDefined();
    }
    for (const id of STALE_IDS) {
      if (FAILING_IDS.has(id)) continue;
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      expect(rankStateOf(id, created ?? CREATED, NOW, DOMAIN).consecutive_failures).toBe(0);
    }
  });

  it('keeps one fixture keyword failed: no successful check, three failures in a row', () => {
    expect(FAILED_IDS.size).toBe(1);
    for (const id of FAILED_IDS) {
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      const state = rankStateOf(id, created, NOW, DOMAIN);
      expect(state.current).toMatchObject({ state: 'failed', rank: null, url: null, observed_at: null });
      expect(state).toMatchObject({
        consecutive_failures: 3,
        last_observed_at: null,
        best_rank: null,
        ranking_url_count: 0,
      });
      expect(state.change.label).toBe('first_check');
      expect(TRACKED_KEYWORD_STATE.parse(state)).toBeDefined();
    }
  });

  it('judges a keyword with no good check stale from its creation, as the backend does (coalesce of last check and created)', () => {
    for (const id of FAILED_IDS) {
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      // The fixture keyword is older than 36 hours, so its failing checks leave it stale
      expect(Date.parse(created)).toBeLessThan(NOW - 36 * HOUR_MS);
      expect(rankStateOf(id, created, NOW, DOMAIN).is_stale).toBe(true);
      // The same keyword created 35 hours ago is not stale yet, and 37 hours ago it is
      expect(rankStateOf(id, new Date(NOW - 35 * HOUR_MS).toISOString(), NOW, DOMAIN).is_stale).toBe(false);
      expect(rankStateOf(id, new Date(NOW - 37 * HOUR_MS).toISOString(), NOW, DOMAIN).is_stale).toBe(true);
    }
  });

  it('never calls a keyword stale that has not been checked or failed yet: it has no state row', () => {
    for (const id of PENDING_TRACKED_IDS) {
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      expect(rankStateOf(id, created, NOW + 90 * 24 * HOUR_MS, DOMAIN).is_stale).toBe(false);
    }
  });

  it('keeps the fixture keywords that wait for Labs metrics waiting for their first check', () => {
    expect(PENDING_TRACKED_IDS.size).toBe(3);
    for (const id of PENDING_TRACKED_IDS) {
      const created = MOCK_TRACKED_KEYWORDS.find((row) => row.tracked_keyword_id === id)?.created_at;
      if (created === undefined) throw new Error(`${id} is not a fixture keyword`);
      for (const later of [NOW, NOW + 10 * 60_000, NOW + 30 * 24 * HOUR_MS]) {
        expect(rankStateOf(id, created, later, DOMAIN).current.state).toBe('not_checked');
      }
    }
  });

  it('has features and an AI Overview from the id, once the keyword is checked', () => {
    const states = Array.from({ length: 40 }, (_, index) => rankStateOf(idOf(index + 1), CREATED, NOW, DOMAIN));
    expect(states.some((state) => state.feature_types_present.length > 0)).toBe(true);
    expect(states.some((state) => state.feature_types_present.length === 0)).toBe(true);
    for (const state of states) {
      for (const owned of state.owned_feature_types) expect(state.feature_types_present).toContain(owned);
      if (state.current.state !== 'ranked') expect(state.owned_feature_types).toEqual([]);
      if (state.aio.state === 'present_cited') expect(state.aio.citation_position).toBeGreaterThanOrEqual(1);
      else expect(state.aio.citation_position).toBeNull();
    }
    expect(new Set(states.map((state) => state.aio.state)).size).toBeGreaterThanOrEqual(3);
  });

  it('has a target URL match only for a keyword with a target that ranks, true when it is the ranking URL', () => {
    const states = Array.from({ length: 40 }, (_, index) => ({
      id: idOf(index + 1),
      state: rankStateOf(idOf(index + 1), CREATED, NOW, DOMAIN),
    }));
    for (const { state } of states) expect(state.target_url_match).toBeNull();
    const ranked = states.find(({ state }) => state.current.url !== null);
    if (ranked === undefined) throw new Error('No keyword ranks');
    const url = ranked.state.current.url;
    const same = rankStateOf(ranked.id, CREATED, NOW, DOMAIN, url?.canonical_url ?? null);
    expect(same.target_url_match).toBe(true);
    expect(rankStateOf(ranked.id, CREATED, NOW, DOMAIN, `https://${DOMAIN}/not-this-page`).target_url_match).toBe(
      false,
    );
    const beyond = states.find(({ state }) => state.current.state === 'beyond_depth');
    if (beyond === undefined) throw new Error('No keyword is beyond the depth');
    expect(rankStateOf(beyond.id, CREATED, NOW, DOMAIN, `https://${DOMAIN}/`).target_url_match).toBeNull();
  });

  it('ranks nowhere for a project without a primary domain', () => {
    for (let n = 1; n <= 10; n += 1) {
      const state = rankStateOf(idOf(n), CREATED, NOW, null);
      expect(state.current).toMatchObject({ state: 'beyond_depth', rank: null, url: null });
      expect(state).toMatchObject({ best_rank: null, ranking_url_count: 0 });
    }
  });
});

describe('mock rank state of an archived keyword', () => {
  const DAY_MS = 24 * HOUR_MS;

  it('is checked no more once it was archived: the history stops there, and it is not stale for it', () => {
    const archivedAt = new Date(NOW - 10 * DAY_MS).toISOString();
    for (let n = 1; n <= 12; n += 1) {
      const state = rankStateOf(idOf(n), CREATED, NOW, DOMAIN, null, archivedAt);
      expect(Date.parse(state.last_observed_at ?? '')).toBeLessThanOrEqual(Date.parse(archivedAt));
      // The backend clears the stale flag of a keyword that is no longer collected
      expect(state.is_stale).toBe(false);
      // Days later nothing has moved: no check happens, so no change either
      expect(rankStateOf(idOf(n), CREATED, NOW + 5 * DAY_MS, DOMAIN, null, archivedAt)).toEqual(state);
    }
  });

  it('is not stale even when its last check is older than 36 hours, and an active one with the same history is', () => {
    const archivedAt = new Date(NOW - 10 * DAY_MS).toISOString();
    const frozen = rankStateOf(idOf(3), CREATED, NOW, DOMAIN, null, archivedAt);
    expect(NOW - Date.parse(frozen.last_observed_at ?? '')).toBeGreaterThan(36 * HOUR_MS);
    expect(frozen.is_stale).toBe(false);
  });

  it('has no check at all when it was archived before its first one, and is not checked then', () => {
    const state = rankStateOf(idOf(3), CREATED, NOW, DOMAIN, null, CREATED);
    expect(state.current.state).toBe('not_checked');
    expect(state.is_stale).toBe(false);
  });

  it('knows when checks stopped: never for an active keyword, at the archive time, or a few days after creation for a fixture', () => {
    const created = '2026-07-01T08:00:00.000Z';
    expect(stoppedAtOf({ is_active: true, created_at: created, updated_at: '2026-09-01T00:00:00.000Z' })).toBeNull();
    // Archived through the API: its `updated_at` is when
    expect(stoppedAtOf({ is_active: false, created_at: created, updated_at: '2026-09-01T00:00:00.000Z' })).toBe(
      '2026-09-01T00:00:00.000Z',
    );
    // An archived fixture was never updated, so no archive time is stored: it was collected for 5 days
    expect(stoppedAtOf({ is_active: false, created_at: created, updated_at: created })).toBe(
      new Date(Date.parse(created) + 5 * DAY_MS).toISOString(),
    );
  });

  it('gives the archived fixture keywords a history that ends days after they were added, not at the mock clock', () => {
    const archived = MOCK_TRACKED_KEYWORDS.filter((row) => !row.is_active);
    expect(archived.length).toBeGreaterThan(0);
    for (const row of archived) {
      const state = rankStateOf(row.tracked_keyword_id, row.created_at, NOW, DOMAIN, null, stoppedAtOf(row));
      if (state.last_observed_at === null) continue;
      expect(Date.parse(state.last_observed_at)).toBeLessThanOrEqual(Date.parse(row.created_at) + 5 * DAY_MS);
      expect(state.is_stale).toBe(false);
    }
  });
});

describe('mock rank state of the fixtures', () => {
  const statesAt = (now: number) =>
    MOCK_TRACKED_KEYWORDS.map((row) => rankStateOf(row.tracked_keyword_id, row.created_at, now, DOMAIN));

  it('shows every kind of state on a pinned day: ranked, beyond the depth, stale, failed and not checked', () => {
    const states = statesAt(NOW);
    const count = (test: (state: (typeof states)[number]) => boolean): number => states.filter(test).length;
    expect(states).toHaveLength(MOCK_TRACKED_KEYWORDS.length);
    expect(count((state) => state.current.state === 'ranked')).toBeGreaterThanOrEqual(20);
    expect(count((state) => state.current.state === 'beyond_depth')).toBeGreaterThanOrEqual(10);
    expect(count((state) => state.current.rank !== null && state.current.rank <= 3)).toBeGreaterThanOrEqual(1);
    expect(count((state) => (state.current.rank ?? 0) >= 4 && (state.current.rank ?? 0) <= 10)).toBeGreaterThanOrEqual(
      5,
    );
    expect(count((state) => state.current.state === 'not_checked')).toBe(PENDING_TRACKED_IDS.size);
    expect(count((state) => state.current.state === 'failed')).toBe(FAILED_IDS.size);
    // The failed fixture keyword is older than 36 hours with no good check, so it is stale as well
    expect(count((state) => state.is_stale)).toBe(STALE_IDS.size + FAILED_IDS.size);
    expect(count((state) => state.ranking_url_count > 1)).toBeGreaterThanOrEqual(1);
  });

  it('shows every change label over a few days, and moves in both directions', () => {
    const labels = new Set<string>();
    const values: number[] = [];
    for (let day = 0; day < 4; day += 1) {
      for (const state of statesAt(NOW + day * 24 * HOUR_MS)) {
        labels.add(state.change.label);
        if (state.change.value !== null) values.push(state.change.value);
      }
    }
    expect([...labels].sort()).toEqual(
      ['consistent_beyond', 'first_check', 'lost', 'new', 'numeric', 'unchanged_beyond'].sort(),
    );
    expect(values.some((value) => value > 0)).toBe(true);
    expect(values.some((value) => value < 0)).toBe(true);
    expect(values.some((value) => value === 0)).toBe(true);
  });

  it('uses only the feature codes the backend knows, and lists ai_overview when an AI Overview showed', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 40)) {
      const state = rankStateOf(row.tracked_keyword_id, row.created_at, now, 'fynix.digital');
      for (const code of state.feature_types_present) expect(FEATURE_TYPES).toContain(code);
      for (const code of state.owned_feature_types) expect(state.feature_types_present).toContain(code);
      const showed = state.aio.state === 'present_cited' || state.aio.state === 'present_not_cited';
      if (state.current.state !== 'not_checked')
        expect(state.feature_types_present.includes('ai_overview')).toBe(showed);
    }
  });
});
