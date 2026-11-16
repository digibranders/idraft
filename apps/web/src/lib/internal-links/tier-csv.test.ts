import { describe, expect, it } from 'vitest';

import { MAX_CSV_ROWS, parseTierCsv } from './tier-csv';

const TIERS = [
  { tier_id: 't1', code: 'T1', name: 'Money pages' },
  { tier_id: 't2', code: 'T2', name: 'Supporting pages' },
];

describe('parseTierCsv (spec 5.2, the Check step)', () => {
  it('reads a URL and a tier code or name per line, with or without a header', () => {
    const result = parseTierCsv('url,tier\nhttps://a.com/pricing,T1\n/contact,money pages\n', TIERS);
    expect(result.rows).toEqual([
      { line: 2, url: 'https://a.com/pricing', tierId: 't1' },
      { line: 3, url: '/contact', tierId: 't1' },
    ]);
    expect(result.errors).toEqual([]);
  });

  it('names unknown tiers and missing columns with their line numbers', () => {
    const result = parseTierCsv('/a,T9\n/b\n\n/c,T2', TIERS);
    expect(result.rows).toEqual([{ line: 4, url: '/c', tierId: 't2' }]);
    expect(result.errors).toEqual([
      { line: 1, code: 'unknown_tier', value: 'T9' },
      { line: 2, code: 'missing_column', value: '' },
    ]);
  });

  it('keeps quoted URLs whole', () => {
    expect(parseTierCsv('"/a,b",T2', TIERS).rows).toEqual([{ line: 1, url: '/a,b', tierId: 't2' }]);
  });

  it('reads lines ended by a lone CR, and a header that follows blank lines', () => {
    expect(parseTierCsv('/a,T1\r/b,T2', TIERS).rows).toEqual([
      { line: 1, url: '/a', tierId: 't1' },
      { line: 2, url: '/b', tierId: 't2' },
    ]);
    expect(parseTierCsv('\n\nurl,tier\n/a,T1', TIERS)).toEqual({
      rows: [{ line: 4, url: '/a', tierId: 't1' }],
      errors: [],
    });
  });

  it('refuses a cell that runs over a line break instead of reading its fragments', () => {
    expect(parseTierCsv('"/a\n/b",T1', TIERS)).toEqual({
      rows: [],
      errors: [
        { line: 1, code: 'missing_column', value: '' },
        { line: 2, code: 'missing_column', value: '' },
      ],
    });
  });

  it('takes a code before a name, and calls a name two tiers share unknown', () => {
    const tiers = [
      { tier_id: 'a', code: 'T1', name: 'Money' },
      { tier_id: 'b', code: 'T2', name: 'T1' },
      { tier_id: 'c', code: 'T3', name: 'Money' },
    ];
    const result = parseTierCsv('/a,T1\n/b,Money', tiers);
    expect(result.rows).toEqual([{ line: 1, url: '/a', tierId: 'a' }]);
    expect(result.errors).toEqual([{ line: 2, code: 'unknown_tier', value: 'Money' }]);
  });

  it('refuses more rows than the API takes', () => {
    const text = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `/p${String(index)},T1`).join('\n');
    expect(parseTierCsv(text, TIERS).errors).toEqual([{ line: MAX_CSV_ROWS + 1, code: 'too_many_rows', value: '' }]);
  });
});
