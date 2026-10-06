import { describe, expect, it } from 'vitest';

import { isPrintable, QUERY_TEXT_MAX, queryTextOf } from './query-text';

describe('the text of a search sent to the API', () => {
  it('is what the person typed, trimmed', () => {
    expect(queryTextOf('  seo agency ')).toBe('seo agency');
    expect(queryTextOf('')).toBe('');
    expect(queryTextOf('   ')).toBe('');
  });

  it('takes out control, format and separator characters, which the API refuses, leaving a space where one was', () => {
    // A tab, a zero-width space, a line separator and a paragraph separator
    expect(queryTextOf('seo\tagency')).toBe('seo agency');
    expect(queryTextOf('seo​agency ')).toBe('seo agency');
    expect(queryTextOf('a b\u0000c')).toBe('a b c');
    expect(queryTextOf('​\t')).toBe('');
  });

  it('keeps what is printable, accents and other scripts included', () => {
    expect(queryTextOf('café ünïcode 検索')).toBe('café ünïcode 検索');
    expect(isPrintable('café')).toBe(true);
    expect(isPrintable('a\tb')).toBe(false);
    expect(isPrintable('a​b')).toBe(false);
  });

  it('keeps at most 200 characters, counting what a person sees: a character outside the basic plane is one', () => {
    expect(QUERY_TEXT_MAX).toBe(200);
    expect(queryTextOf('x'.repeat(250))).toHaveLength(200);
    expect([...queryTextOf('😀'.repeat(250))]).toHaveLength(200);
    // A cut that leaves a space at the end does not send it
    expect(queryTextOf(`${'x'.repeat(199)} y`)).toBe('x'.repeat(199));
  });
});
