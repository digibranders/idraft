import { describe, expect, it } from 'vitest';

import { MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import { competitorRanksOf, rankStateOf } from './rank-state';
import {
  CHECKED_FIXTURES,
  OWN_ENTITY_REF,
  STALE_IDS,
  aioAt,
  checksAt,
  clearManualChecks,
  featuresAt,
  placeRanks,
  recordManualCheck,
  serpOf,
  snapshotIdOf,
  worldChecks,
  type WorldCheck,
} from './serp-world';
import type { EntityRef } from '@/lib/api/types';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const DOMAIN = 'fynix.digital';
/** The fixture keywords that have checks (the pending and failed fixtures have none), with those checks. */
const CHECKED = MOCK_TRACKED_KEYWORDS.slice(0, 60).flatMap((row) => {
  const checks = checksAt(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
  return checks.length === 0 ? [] : [{ row, checks }];
});

describe('snapshotIdOf', () => {
  it('is a positive decimal text, the same for the same check, and unique across every fixture check', () => {
    const ids = CHECKED.flatMap(({ row, checks }) =>
      checks.map((c) => snapshotIdOf(row.tracked_keyword_id, c.observedAt)),
    );
    expect(CHECKED.length).toBeGreaterThan(50);
    expect(ids.length).toBeGreaterThan(50 * 20);
    for (const id of ids) expect(id).toMatch(/^[1-9]\d{0,9}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('features and AI Overview per check', () => {
  it('make the list state of a keyword the state of its latest check', () => {
    for (const { row, checks } of CHECKED) {
      const latest = checks[checks.length - 1];
      expect(latest).toBeDefined();
      const state = rankStateOf(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
      const features = featuresAt(row.tracked_keyword_id, latest?.observedAt ?? '', latest?.rank !== null);
      expect(new Set(state.feature_types_present)).toEqual(new Set(features.map((f) => f.type)));
      expect(new Set(state.owned_feature_types)).toEqual(new Set(features.filter((f) => f.owned).map((f) => f.type)));
      expect(state.aio.state).toBe(aioAt(row.tracked_keyword_id, latest?.observedAt ?? '').state);
    }
  });

  it('flicker: some features and AI Overview states change between checks, but not every check', () => {
    let featureFlips = 0;
    let aioFlips = 0;
    let transitions = 0;
    for (const { row, checks } of CHECKED) {
      checks.slice(1).forEach((cur, i) => {
        const prev = checks[i];
        expect(prev).toBeDefined();
        const id = row.tracked_keyword_id;
        const types = (c: typeof cur): string =>
          featuresAt(id, c.observedAt, c.rank !== null)
            .map((f) => f.type)
            .join();
        transitions += 1;
        if (prev !== undefined && types(prev) !== types(cur)) featureFlips += 1;
        if (prev !== undefined && aioAt(id, prev.observedAt).state !== aioAt(id, cur.observedAt).state) aioFlips += 1;
      });
    }
    expect(transitions).toBeGreaterThan(50 * 20);
    expect(featureFlips).toBeGreaterThan(0);
    expect(aioFlips).toBeGreaterThan(0);
    expect(featureFlips).toBeLessThan(transitions / 2);
    expect(aioFlips).toBeLessThan(transitions / 2);
  });
});

describe('placeRanks', () => {
  it('keeps the own rank and gives each competitor a free rank at or below its walk, within the depth', () => {
    const placed = placeRanks({
      own: 3,
      depth: 20,
      walks: [
        ['a', 3],
        ['b', 3],
        ['c', 4],
        ['d', null],
        ['e', 25],
      ],
    });
    expect([...placed]).toEqual([
      ['a', 4],
      ['b', 5],
      ['c', 6],
      ['d', null],
      ['e', null],
    ]);
  });

  it('puts a competitor beyond the depth when the free rank would pass it', () => {
    expect(placeRanks({ own: 20, depth: 20, walks: [['a', 20]] }).get('a')).toBeNull();
  });

  it('reserves nothing for an own site that does not rank', () => {
    expect(placeRanks({ own: null, depth: 20, walks: [['a', 3]] }).get('a')).toBe(3);
  });
});

describe('serpOf', () => {
  it('ranks are exactly 1..depthReturned without gap or duplicate, own and competitors placed, unique URLs', () => {
    const own = {
      entity_id: 'own',
      canonical_name: 'Fynix',
      entity_type: 'organization' as const,
      role: 'own' as const,
      color_index: null,
    };
    const comp1 = {
      entity_id: 'c1',
      canonical_name: 'Acme',
      entity_type: 'organization' as const,
      role: 'competitor' as const,
      color_index: 2,
    };
    const comp2 = {
      entity_id: 'c2',
      canonical_name: 'Beta',
      entity_type: 'organization' as const,
      role: 'competitor' as const,
      color_index: 3,
    };

    const first = CHECKED[0]?.row;
    if (!first) throw new Error('Missing fixture');
    const all = worldChecks({
      trackedId: first.tracked_keyword_id,
      createdAt: first.created_at,
      now: NOW,
      domain: DOMAIN,
      stoppedAt: null,
      own,
      competitors: [comp1, comp2],
    });
    expect(all.length).toBeGreaterThan(0);

    for (const check of all.slice(-5)) {
      if (check.failed) continue;
      const serp = serpOf(check, {
        own,
        competitors: [comp1, comp2],
        ownHost: DOMAIN,
        entityHosts: new Map([
          ['c1', 'acme.com'],
          ['c2', 'beta.io'],
        ]),
      });
      expect(serp).toHaveLength(check.depthReturned);
      const ranks = serp.map((item) => item.rank);
      expect(ranks).toEqual(Array.from({ length: check.depthReturned }, (_, i) => i + 1));

      const urls = new Set(serp.map((item) => `https://${item.host}${item.path}`));
      expect(urls.size).toBe(check.depthReturned);

      const ownItem = serp.find((item) => item.entity?.role === 'own');
      const expectedOwnPlaced = check.rank !== null && check.rank <= check.depthReturned;
      expect(ownItem !== undefined).toBe(expectedOwnPlaced);
      expect(ownItem?.rank ?? null).toBe(expectedOwnPlaced ? check.rank : null);
      expect(ownItem?.host ?? null).toBe(expectedOwnPlaced ? DOMAIN : null);

      for (const comp of [comp1, comp2]) {
        const placedRank = check.competitorRanks.get(comp.entity_id) ?? null;
        const compItem = serp.find((item) => item.entity?.entity_id === comp.entity_id);
        const expectedCompPlaced = placedRank !== null && placedRank <= check.depthReturned;
        expect(compItem !== undefined).toBe(expectedCompPlaced);
        expect(compItem?.rank ?? null).toBe(expectedCompPlaced ? placedRank : null);
      }
    }
  });

  it('I-1: pins own item host to context.ownHost without reading fixtures or fallback', () => {
    const own = { ...OWN_ENTITY_REF, entity_id: 'custom-own', canonical_name: 'Custom Own' };
    const check: WorldCheck = {
      snapshotId: 'snap-1',
      observedAt: '2026-11-02T12:00:00.000Z',
      attemptAt: '2026-11-02T12:00:00.000Z',
      rank: 3,
      depth: 20,
      depthReturned: 20,
      path: '/about',
      failed: false,
      features: [],
      aio: null,
      competitorRanks: new Map(),
      trackedId: 'tr-unmatched',
    };
    const serp = serpOf(check, {
      own,
      competitors: [],
      ownHost: 'custom-site.example',
    });
    const ownItem = serp.find((item) => item.entity?.role === 'own');
    expect(ownItem).toBeDefined();
    expect(ownItem?.host).toBe('custom-site.example');
  });

  it('the 1-in-12 depthReturned = depth - 1 case occurs over fixtures and the own check depth is kept', () => {
    const own: EntityRef = {
      entity_id: 'own',
      canonical_name: 'Fynix',
      entity_type: 'organization',
      role: 'own',
      color_index: null,
    };
    let fewerReturnedCount = 0;
    let equalReturnedCount = 0;
    let totalChecks = 0;

    for (const row of MOCK_TRACKED_KEYWORDS.slice(1, 50)) {
      const checks = worldChecks({
        trackedId: row.tracked_keyword_id,
        createdAt: row.created_at,
        now: NOW,
        domain: DOMAIN,
        stoppedAt: null,
        own,
        competitors: [],
      });
      const baseChecks = checksAt(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
      const goodChecks = checks.filter((c) => !c.failed);

      for (let i = 0; i < baseChecks.length; i += 1) {
        const c = goodChecks[i];
        const base = baseChecks[i];
        expect(c).toBeDefined();
        expect(base).toBeDefined();
        expect(c?.depth).toBe(base?.depth);

        if (c && c.depthReturned === c.depth - 1) {
          fewerReturnedCount += 1;
        } else if (c && c.depthReturned === c.depth) {
          equalReturnedCount += 1;
        }
        totalChecks += 1;
      }
    }

    expect(totalChecks).toBeGreaterThan(50);
    expect(fewerReturnedCount).toBeGreaterThan(0);
    expect(equalReturnedCount).toBeGreaterThan(0);
  });

  describe('C1: worldChecks built on checksAt and consistent competitor ranks', () => {
    it('for each fixture keyword, the good checks of worldChecks equal those of checksAt plus the plan same-day overlay, for a stale fixture and after recordManualCheck', () => {
      const own: EntityRef = {
        entity_id: 'own',
        canonical_name: 'Fynix',
        entity_type: 'organization',
        role: 'own',
        color_index: null,
      };
      let checkedCount = 0;
      for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 40)) {
        const baseChecks = checksAt(row.tracked_keyword_id, row.created_at, NOW, DOMAIN);
        const world = worldChecks({
          trackedId: row.tracked_keyword_id,
          createdAt: row.created_at,
          now: NOW,
          domain: DOMAIN,
          stoppedAt: null,
          own,
          competitors: [],
        });
        const goodWorld = world.filter((c) => !c.failed);
        expect(goodWorld.map((c) => c.observedAt)).toEqual(baseChecks.map((c) => c.observedAt));
        checkedCount += 1;
      }
      expect(checkedCount).toBe(40);

      // Stale fixture check
      const staleId = [...STALE_IDS][1] ?? '';
      expect(staleId).not.toBe('');
      const staleRow = MOCK_TRACKED_KEYWORDS.find((r) => r.tracked_keyword_id === staleId);
      expect(staleRow).toBeDefined();
      if (!staleRow) throw new Error('Missing stale row');
      const baseStale = checksAt(staleId, staleRow.created_at, NOW, DOMAIN);
      const worldStale = worldChecks({
        trackedId: staleId,
        createdAt: staleRow.created_at,
        now: NOW,
        domain: DOMAIN,
        stoppedAt: null,
        own,
        competitors: [],
      });
      const goodStale = worldStale.filter((c) => !c.failed);
      expect(goodStale.map((c) => c.observedAt)).toEqual(baseStale.map((c) => c.observedAt));
      expect(goodStale.at(-1)?.observedAt).toBe(baseStale.at(-1)?.observedAt);

      // Manual check check
      const manualKeywordId = CHECKED_FIXTURES[2] ?? '';
      expect(manualKeywordId).not.toBe('');
      const row = MOCK_TRACKED_KEYWORDS.find((r) => r.tracked_keyword_id === manualKeywordId);
      expect(row).toBeDefined();
      if (!row) throw new Error('Missing manual row');
      try {
        recordManualCheck(manualKeywordId, NOW - 60_000);
        const baseManual = checksAt(manualKeywordId, row.created_at, NOW, DOMAIN);
        const worldManual = worldChecks({
          trackedId: manualKeywordId,
          createdAt: row.created_at,
          now: NOW,
          domain: DOMAIN,
          stoppedAt: null,
          own,
          competitors: [],
        });
        const goodManual = worldManual.filter((c) => !c.failed);
        expect(goodManual.map((c) => c.observedAt)).toEqual(baseManual.map((c) => c.observedAt));
        expect(goodManual.at(-1)?.observedAt).toBe(new Date(NOW - 60_000).toISOString());
      } finally {
        clearManualChecks();
      }
    });

    it('for a keyword with 4 competitors, competitorRanksOf(entity).current.rank equals the latest worldChecks rank for that entity, for all entities, over all fixtures', () => {
      const own: EntityRef = {
        entity_id: 'own',
        canonical_name: 'Fynix',
        entity_type: 'organization',
        role: 'own',
        color_index: null,
      };
      const fourComps: EntityRef[] = [
        { entity_id: 'c1', canonical_name: 'Comp1', entity_type: 'organization', role: 'competitor', color_index: 0 },
        { entity_id: 'c2', canonical_name: 'Comp2', entity_type: 'organization', role: 'competitor', color_index: 1 },
        { entity_id: 'c3', canonical_name: 'Comp3', entity_type: 'organization', role: 'competitor', color_index: 2 },
        { entity_id: 'c4', canonical_name: 'Comp4', entity_type: 'organization', role: 'competitor', color_index: 3 },
      ];
      let comparisons = 0;
      for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 30)) {
        const checks = worldChecks({
          trackedId: row.tracked_keyword_id,
          createdAt: row.created_at,
          now: NOW,
          domain: DOMAIN,
          stoppedAt: null,
          own,
          competitors: fourComps,
        });
        const latestGood = checks.filter((c) => !c.failed).at(-1);
        const compRanks = competitorRanksOf(row.tracked_keyword_id, row.created_at, NOW, DOMAIN, fourComps, null);
        for (const comp of fourComps) {
          const compRank = compRanks.find((r) => r.entity.entity_id === comp.entity_id);
          const expectedRank = latestGood?.competitorRanks.get(comp.entity_id) ?? null;
          expect(compRank?.current.rank ?? null).toBe(expectedRank);
          comparisons += 1;
        }
      }
      expect(comparisons).toBe(30 * 4);
    });
  });
});
