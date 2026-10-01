import { describe, expect, it } from 'vitest';

import { readKeywordLines } from './keyword-lines';

describe('readKeywordLines', () => {
  it('keeps each keyword once in any casing, skips blank lines and counts the repeats', () => {
    const read = readKeywordLines('SEO Agency\n\n  seo   agency \r\nlocal seo\nLOCAL SEO\n');
    expect(read.keywords).toEqual([
      { line: 1, keyword: 'SEO Agency' },
      { line: 4, keyword: 'local seo' },
    ]);
    expect(read.repeats).toBe(2);
    expect(read.problems).toEqual([]);
  });

  it('reports the lines the API would refuse, by their number', () => {
    const read = readKeywordLines(`crm\nsite:fynix.io seo\n${'a'.repeat(701)}`);
    expect(read.keywords.map((line) => line.keyword)).toEqual(['crm']);
    expect(read.problems).toEqual([
      { line: 2, problem: 'search_operator_not_allowed' },
      { line: 3, problem: 'keyword_too_long' },
    ]);
  });

  it('reads nothing from an empty list', () => {
    expect(readKeywordLines('  \n\n')).toEqual({ keywords: [], repeats: 0, problems: [] });
  });
});
