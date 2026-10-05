import { describe, expect, it } from 'vitest';

import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    expect(parseCsv('a,"b,c","say ""hi""","one\ntwo"\n')).toEqual([['a', 'b,c', 'say "hi"', 'one\ntwo']]);
  });

  it('ends a line at LF or CRLF, drops a byte order mark and skips blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('ends a line at a lone CR, as a Mac export does', () => {
    expect(parseCsv('keyword,tags\rseo,blog\rppc,x')).toEqual([
      ['keyword', 'tags'],
      ['seo', 'blog'],
      ['ppc', 'x'],
    ]);
  });

  it('keeps a CR inside a quoted field', () => {
    expect(parseCsv('a,"x\ry"\rb,c')).toEqual([
      ['a', 'x\ry'],
      ['b', 'c'],
    ]);
  });

  it('writes what it reads', () => {
    const rows = [
      ['a', 'b,c'],
      ['say "hi"', 'one\ntwo'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
