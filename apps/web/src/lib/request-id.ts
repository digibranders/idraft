/**
 * Request ids (25-observability.md section 3.3): `req_` plus a UUIDv7 in upper-case Crockford base32, the
 * format the API owns (backend/src/idraft/api/request_id.py). The API keeps an incoming `X-Request-Id`
 * only in this exact format, so a page render and the API calls it makes share one id in both logs.
 * Ids sort by creation time; within one millisecond a counter keeps them increasing (RFC 9562 6.2).
 */

export const REQUEST_ID_HEADER = 'x-request-id';
const PREFIX = 'req_';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODED_LENGTH = 26;
/** 12 bits after the version nibble and 62 after the variant bits. */
const RANDOM_BITS = 74n;
const LOW_BITS = 62n;

let lastMillisecond = 0n;
let lastRandom = 0n;

/** 74 random bits with the top one clear, so the counter has room to grow within a millisecond. */
function freshRandom(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const value = bytes.reduce((number, byte) => (number << 8n) | BigInt(byte), 0n);
  return value >> (80n - RANDOM_BITS + 1n);
}

function uuid7(now: number): bigint {
  const millisecond = BigInt(now);
  if (millisecond > lastMillisecond) {
    lastMillisecond = millisecond;
    lastRandom = freshRandom();
  } else {
    lastRandom += 1n;
  }
  const high = lastRandom >> LOW_BITS;
  const low = lastRandom & ((1n << LOW_BITS) - 1n);
  return (lastMillisecond << 80n) | (0x7n << 76n) | (high << 64n) | (0b10n << 62n) | low;
}

/** A new request id. `now` is for tests; the clock is used otherwise. */
export function newRequestId(now: number = Date.now()): string {
  const number = uuid7(now);
  let encoded = '';
  for (let shift = 125n; shift >= 0n; shift -= 5n) encoded += CROCKFORD[Number((number >> shift) & 31n)];
  return PREFIX + encoded;
}

/** Whether `value` is a request id in the API's format: 128 bits, version 7, the RFC 9562 variant. */
export function isRequestId(value: string): boolean {
  if (!value.startsWith(PREFIX) || value.length !== PREFIX.length + ENCODED_LENGTH) return false;
  let number = 0n;
  for (const character of value.slice(PREFIX.length)) {
    const digit = CROCKFORD.indexOf(character);
    if (digit === -1) return false;
    number = number * 32n + BigInt(digit);
  }
  return number < 1n << 128n && ((number >> 76n) & 0xfn) === 0x7n && ((number >> 62n) & 0b11n) === 0b10n;
}
