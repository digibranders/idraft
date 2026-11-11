import { describe, expect, it } from 'vitest';

import { MOCK_TRACKED_KEYWORDS } from './keyword-fixtures';
import { checksOf, FIRST_CHECK_DELAY_MS } from './rank-history';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const CREATED = '2026-06-15T08:00:00Z';
const ID = '0192d1a8-e007-7a10-8e07-000000000003';

describe('mock rank history', () => {
  it('keeps the rank and depth of every existing check', () => {
    const NOW_PINNED = Date.parse('2026-11-02T12:00:00Z');
    const f0 = MOCK_TRACKED_KEYWORDS[0];
    const f1 = MOCK_TRACKED_KEYWORDS[1];
    const f2 = MOCK_TRACKED_KEYWORDS[2];
    if (!f0 || !f1 || !f2) throw new Error('Fixture keywords missing');

    const pairs = (id: string, createdAt: string): Array<{ rank: number | null; depth: number }> =>
      checksOf(id, createdAt, NOW_PINNED)
        .slice(-10)
        .map((c) => ({ rank: c.rank, depth: c.depth }));

    expect(pairs(f0.tracked_keyword_id, f0.created_at)).toEqual([
      { rank: 18, depth: 20 },
      { rank: 18, depth: 20 },
      { rank: 16, depth: 50 },
      { rank: 12, depth: 20 },
      { rank: 14, depth: 20 },
      { rank: 13, depth: 20 },
      { rank: 15, depth: 50 },
      { rank: 12, depth: 100 },
      { rank: 8, depth: 50 },
      { rank: 10, depth: 20 },
    ]);

    expect(pairs(f1.tracked_keyword_id, f1.created_at)).toEqual([
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: 31, depth: 100 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: 27, depth: 50 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
    ]);

    expect(pairs(f2.tracked_keyword_id, f2.created_at)).toEqual([
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
      { rank: 20, depth: 50 },
      { rank: null, depth: 20 },
      { rank: 25, depth: 100 },
      { rank: null, depth: 20 },
      { rank: null, depth: 20 },
    ]);
  });
  it('is the same every time for the same keyword', () => {
    const a = checksOf(ID, CREATED, NOW);
    const b = checksOf(ID, CREATED, NOW);
    expect(a).toEqual(b);
  });

  it('has up to 30 daily checks, oldest first, none before the keyword existed', () => {
    const checks = checksOf(ID, CREATED, NOW);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.length).toBeLessThanOrEqual(30);
    const times = checks.map((check) => Date.parse(check.observedAt));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(times.every((time) => time >= Date.parse(CREATED))).toBe(true);
    expect(times.every((time) => time <= NOW)).toBe(true);
  });

  it('has no check for a keyword created less than the first check delay ago', () => {
    const created = new Date(NOW - FIRST_CHECK_DELAY_MS + 1000).toISOString();
    expect(checksOf('0192d1a8-e007-7a10-8e07-000000000004', created, NOW)).toEqual([]);
  });

  it('gives a keyword created just over the delay ago its one first check', () => {
    const created = new Date(NOW - FIRST_CHECK_DELAY_MS - 1000).toISOString();
    const checks = checksOf('0192d1a8-e007-7a10-8e07-000000000004', created, NOW);
    expect(checks).toHaveLength(1);
    expect(Date.parse(checks[0]?.observedAt ?? '')).toBe(Date.parse(created) + FIRST_CHECK_DELAY_MS);
  });

  it('keeps ranks within the checked depth or null beyond it', () => {
    const checks = checksOf('0192d1a8-e007-7a10-8e07-000000000005', CREATED, NOW);
    for (const check of checks) {
      expect(check.depth).toBeGreaterThanOrEqual(10);
      if (check.rank !== null) expect(check.rank).toBeLessThanOrEqual(check.depth);
    }
  });

  it('gives a ranked check a URL path and at least one URL, and a check beyond the depth neither', () => {
    const checks = checksOf('0192d1a8-e007-7a10-8e07-000000000006', CREATED, NOW);
    for (const check of checks) {
      if (check.rank === null) {
        expect(check.path).toBeNull();
        expect(check.urlCount).toBe(0);
      } else {
        expect(check.path).toMatch(/^\//);
        expect(check.urlCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('keeps the checks it already has when the clock moves on, so a rank never changes after the fact', () => {
    const today = checksOf(ID, CREATED, NOW);
    const later = checksOf(ID, CREATED, NOW + 3 * DAY_MS);
    // The history grows at the end and the window of 30 slides; what both show is equal
    const overlap = today.slice(3);
    expect(later.slice(0, overlap.length)).toEqual(overlap);
    expect(later.length).toBe(30);
  });

  it('adds the next daily check at 02:00 UTC and not before', () => {
    const before = checksOf(ID, CREATED, Date.parse('2026-10-07T01:59:00Z'));
    const after = checksOf(ID, CREATED, Date.parse('2026-10-07T02:00:00Z'));
    expect(after).toHaveLength(Math.min(before.length + 1, 30));
    expect(after.at(-1)?.observedAt).toBe('2026-10-07T02:00:00.000Z');
  });

  it('gives some keywords a path of 28 characters or more, longer than a mono cell of the URL column holds', () => {
    const paths = new Set(
      Array.from({ length: 60 }, (_, index) =>
        checksOf(`0192d1a8-e007-7a10-8e07-${String(index + 1).padStart(12, '0')}`, CREATED, NOW)
          .map((check) => check.path)
          .find((path) => path !== null),
      ),
    );
    expect([...paths].some((path) => path !== undefined && path.length >= 28)).toBe(true);
  });

  it('gives different keywords different walks', () => {
    const a = checksOf('0192d1a8-e007-7a10-8e07-000000000007', CREATED, NOW).map((check) => check.rank);
    const b = checksOf('0192d1a8-e007-7a10-8e07-000000000008', CREATED, NOW).map((check) => check.rank);
    expect(a).not.toEqual(b);
  });
});

describe('ranking URL walk', () => {
  it('changes the ranking path of some keywords every 17 to 29 days and of the rest never', () => {
    const changing = MOCK_TRACKED_KEYWORDS.filter((row) => {
      const paths = checksOf(row.tracked_keyword_id, row.created_at, NOW).flatMap((c) =>
        c.path === null ? [] : [c.path],
      );
      return new Set(paths).size > 1;
    });
    expect(changing.length).toBeGreaterThan(0);
    expect(changing.length).toBeLessThan(MOCK_TRACKED_KEYWORDS.length / 2);
  });

  it('gives a check the same path whatever the clock says', () => {
    let compared = 0;
    for (const row of MOCK_TRACKED_KEYWORDS.slice(0, 40)) {
      const early = checksOf(row.tracked_keyword_id, row.created_at, NOW);
      const later = checksOf(row.tracked_keyword_id, row.created_at, NOW + 3 * 86_400_000);
      for (const check of early) {
        const same = later.find((candidate) => candidate.observedAt === check.observedAt);
        if (same === undefined) continue; // slid out of the last 30
        expect(same.path).toBe(check.path);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(40 * 20);
  });
});
