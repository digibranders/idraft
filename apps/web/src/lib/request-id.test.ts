import { describe, expect, it } from 'vitest';

import { isRequestId, newRequestId } from './request-id';

const CROCKFORD = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The 128-bit number an id encodes. */
function decode(id: string): bigint {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return [...id.slice(4)].reduce((number, character) => number * 32n + BigInt(alphabet.indexOf(character)), 0n);
}

describe('newRequestId', () => {
  it('is req_ plus 26 upper-case Crockford base32 characters', () => {
    const id = newRequestId();
    expect(id).toMatch(CROCKFORD);
    expect(isRequestId(id)).toBe(true);
  });

  // Ids never go back in time, so each test below uses a later moment than every test before it
  it('encodes a UUIDv7: the millisecond, version 7 and the RFC 9562 variant', () => {
    const now = Date.now() + 60_000;
    const number = decode(newRequestId(now));
    expect(number >> 80n).toBe(BigInt(now));
    expect((number >> 76n) & 0xfn).toBe(7n);
    expect((number >> 62n) & 0b11n).toBe(0b10n);
  });

  it('keeps increasing within one millisecond, and sorts by time across milliseconds', () => {
    const now = Date.now() + 120_000;
    const within = Array.from({ length: 50 }, () => newRequestId(now));
    expect([...within].sort()).toEqual(within);
    expect(new Set(within).size).toBe(within.length);
    const last = within.at(-1) ?? '';
    const next = newRequestId(now + 1);
    expect(next > last).toBe(true);
    expect(decode(next) >> 80n).toBe(BigInt(now + 1));
  });

  it('keeps increasing when the clock steps back', () => {
    const now = Date.now() + 180_000;
    const before = newRequestId(now);
    const after = newRequestId(now - 5_000);
    expect(after > before).toBe(true);
    expect(isRequestId(after)).toBe(true);
  });

  it('matches the example in 19-api-specification.md section 2.7 in shape', () => {
    expect('req_01J9ZC4W8Q2T6V3K5M7N9P1R3S').toMatch(CROCKFORD);
  });
});

describe('isRequestId', () => {
  it('refuses anything that is not the API format', () => {
    const valid = newRequestId();
    for (const value of [
      '',
      valid.slice(4),
      valid.toLowerCase(),
      `${valid}0`,
      valid.slice(0, -1),
      `req_${'I'.repeat(26)}`,
      `req_${'Z'.repeat(26)}`,
      `req_${'0'.repeat(26)}`,
      '2f6d0a5e-8a1c-4e2b-9c1d-5a7e3b9f0c12',
    ]) {
      expect(isRequestId(value), value).toBe(false);
    }
  });
});
