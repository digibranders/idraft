import { describe, expect, it } from 'vitest';

import { visibleUrlText } from './visible-text';

describe('visibleUrlText', () => {
  it.each([
    [0x061c, '%D8%9C'],
    [0x200e, '%E2%80%8E'],
    [0x200f, '%E2%80%8F'],
    [0x202a, '%E2%80%AA'],
    [0x202b, '%E2%80%AB'],
    [0x202c, '%E2%80%AC'],
    [0x202d, '%E2%80%AD'],
    [0x202e, '%E2%80%AE'],
    [0x2066, '%E2%81%A6'],
    [0x2067, '%E2%81%A7'],
    [0x2068, '%E2%81%A8'],
    [0x2069, '%E2%81%A9'],
  ])('encodes the control U+%s', (code, encoded) => {
    expect(visibleUrlText(`/a${String.fromCodePoint(code)}b`)).toBe(`/a${encoded}b`);
  });

  it('leaves other text alone, including right-to-left letters', () => {
    const text = '/caf\u{E9}/\u{5D0}\u{5D9}\u{5DA}?q=1&r=a b';
    expect(visibleUrlText(text)).toBe(text);
  });
});
