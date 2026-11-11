import { describe, expect, it } from 'vitest';

import { isWithinBounds, serpDomainOf, toTimeBounds, urlRefOf, validateDateWindow } from './serp-views';

const day = (localDate: string) => ({ isInstant: false, localDate });

describe('toTimeBounds', () => {
  it('turns project local days into the instants they start and end at, whatever the zone of the machine', () => {
    // Berlin is UTC+1 in winter and UTC+2 in summer
    expect(toTimeBounds(day('2026-11-02'), day('2026-11-02'), 'Europe/Berlin')).toEqual({
      minMs: Date.parse('2026-11-01T23:00:00.000Z'),
      maxMs: Date.parse('2026-11-02T22:59:59.999Z'),
    });
    expect(toTimeBounds(day('2026-07-01'), day('2026-07-01'), 'Europe/Berlin')).toEqual({
      minMs: Date.parse('2026-06-30T22:00:00.000Z'),
      maxMs: Date.parse('2026-07-01T21:59:59.999Z'),
    });
    expect(toTimeBounds(day('2026-11-02'), day('2026-11-02'), 'America/New_York')).toEqual({
      minMs: Date.parse('2026-11-02T05:00:00.000Z'),
      maxMs: Date.parse('2026-11-03T04:59:59.999Z'),
    });
  });

  it('has a 25 hour day when the clocks go back and a 23 hour day when they go forward', () => {
    const back = toTimeBounds(day('2026-10-25'), day('2026-10-25'), 'Europe/Berlin');
    expect(back).toEqual({
      minMs: Date.parse('2026-10-24T22:00:00.000Z'),
      maxMs: Date.parse('2026-10-25T22:59:59.999Z'),
    });
    const forward = toTimeBounds(day('2026-03-29'), day('2026-03-29'), 'Europe/Berlin');
    expect(forward).toEqual({
      minMs: Date.parse('2026-03-28T23:00:00.000Z'),
      maxMs: Date.parse('2026-03-29T21:59:59.999Z'),
    });
  });

  it('takes a timestamp as the instant it is, leaves an open side open, and reads a range from both sides', () => {
    const instant = { isInstant: true, instantMs: Date.parse('2026-10-05T10:15:00Z'), localDate: '2026-10-05' };
    expect(toTimeBounds(instant, null, 'Europe/Berlin')).toEqual({
      minMs: Date.parse('2026-10-05T10:15:00Z'),
      maxMs: null,
    });
    expect(toTimeBounds(null, instant, 'Europe/Berlin')).toEqual({
      minMs: null,
      maxMs: Date.parse('2026-10-05T10:15:00Z'),
    });
    expect(toTimeBounds(null, null, 'Europe/Berlin')).toEqual({ minMs: null, maxMs: null });
    expect(toTimeBounds(day('2026-10-01'), day('2026-10-03'), 'Europe/Berlin')).toEqual({
      minMs: Date.parse('2026-09-30T22:00:00.000Z'),
      maxMs: Date.parse('2026-10-03T21:59:59.999Z'),
    });
  });
});

describe('isWithinBounds', () => {
  it('includes both edges and excludes the millisecond outside each', () => {
    const bounds = { minMs: 1000, maxMs: 2000 };
    expect([999, 1000, 1500, 2000, 2001].map((ms) => isWithinBounds(ms, bounds))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(isWithinBounds(5, { minMs: null, maxMs: null })).toBe(true);
  });
});

describe('serpDomainOf (N1)', () => {
  it('gives a host one id whatever the url, and different hosts different ids', () => {
    const hosts = ['fynix.digital', 'wikipedia.org', 'rankforge.io', 'a.example', 'b.example'];
    const ids = hosts.map((host) => serpDomainOf(host).domain_id);
    expect(new Set(ids).size).toBe(hosts.length);
    expect(hosts.map((host) => serpDomainOf(host).domain_id)).toEqual(ids);
    // The url of the host does not move it
    expect(urlRefOf('wikipedia.org', '/a').url_id).not.toBe(urlRefOf('wikipedia.org', '/b').url_id);
    expect(serpDomainOf('wikipedia.org')).toEqual({
      domain_id: serpDomainOf('wikipedia.org').domain_id,
      host: 'wikipedia.org',
      registrable_domain: 'wikipedia.org',
    });
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(1_000_000);
    }
  });
});

describe('validateDateWindow', () => {
  it('accepts 400 days and refuses 401 with the limit', () => {
    const clock = Date.parse('2026-11-02T12:00:00Z');
    expect(validateDateWindow('2025-09-29', '2026-11-02', clock, 'Europe/Berlin', 400)).toEqual({
      range: { firstDate: '2025-09-29', lastDate: '2026-11-02' },
    });
    expect(validateDateWindow('2025-09-28', '2026-11-02', clock, 'Europe/Berlin', 400)).toEqual({
      problem: 'window_too_large',
      limit_days: 400,
    });
  });
});
