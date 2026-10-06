import { describe, expect, it } from 'vitest';

import { checksOf, FIRST_CHECK_DELAY_MS } from './rank-history';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const CREATED = '2026-06-15T08:00:00Z';
const ID = '0192d1a8-e007-7a10-8e07-000000000003';

describe('mock rank history', () => {
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

  it('gives different keywords different walks', () => {
    const a = checksOf('0192d1a8-e007-7a10-8e07-000000000007', CREATED, NOW).map((check) => check.rank);
    const b = checksOf('0192d1a8-e007-7a10-8e07-000000000008', CREATED, NOW).map((check) => check.rank);
    expect(a).not.toEqual(b);
  });
});
