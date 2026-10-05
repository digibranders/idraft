import { describe, expect, it } from 'vitest';

import { readCsvHead } from './csv-head';

const file = (parts: BlobPart[], name = 'k.csv'): File => new File(parts, name, { type: 'text/csv' });

describe('readCsvHead', () => {
  it('reads the headers and up to three sample rows', async () => {
    const head = await readCsvHead(file(['﻿Keyword,Tags\ncrm,"a|b"\nseo,x\nppc,y\nlast,z\n']));
    expect(head).toEqual({
      kind: 'ok',
      headers: ['Keyword', 'Tags'],
      samples: [
        ['crm', 'a|b'],
        ['seo', 'x'],
        ['ppc', 'y'],
      ],
    });
  });

  it('stops at the last whole line of the bytes it reads', async () => {
    const long = `Keyword\n${'a'.repeat(70_000)}\nshort\n`;
    const head = await readCsvHead(file([long]), 65_536);
    expect(head).toEqual({ kind: 'ok', headers: ['Keyword'], samples: [] });
  });

  it('does not cut a multi-byte character in half at the end of the bytes it reads', async () => {
    const head = await readCsvHead(file(['Keyword\nkäse\nbäume\n']), 14);
    expect(head).toEqual({ kind: 'ok', headers: ['Keyword'], samples: [['käse']] });
  });

  it('refuses a file that is not UTF-8', async () => {
    expect(await readCsvHead(file([new Uint8Array([0x4b, 0x65, 0x79, 0x0a, 0xff, 0xfe, 0x0a])]))).toEqual({
      kind: 'not_utf8',
    });
  });

  it('refuses a file with no header line', async () => {
    expect(await readCsvHead(file(['']))).toEqual({ kind: 'empty' });
  });

  it('reads a file whose lines end in a lone CR, and cuts a long one at its last CR', async () => {
    expect(await readCsvHead(file(['Keyword,Tags\rseo,blog\rppc,x\r']))).toEqual({
      kind: 'ok',
      headers: ['Keyword', 'Tags'],
      samples: [
        ['seo', 'blog'],
        ['ppc', 'x'],
      ],
    });
    const long = `Keyword\r${'a'.repeat(70_000)}\rshort\r`;
    expect(await readCsvHead(file([long]), 65_536)).toEqual({ kind: 'ok', headers: ['Keyword'], samples: [] });
  });

  it('says so when the header line alone is longer than the bytes it reads', async () => {
    const wide = `${'a'.repeat(70_000)}\nrow\n`;
    expect(await readCsvHead(file([wide]), 65_536)).toEqual({ kind: 'header_too_long' });
  });

  it('refuses two headers that read the same once trimmed and without case', async () => {
    expect(await readCsvHead(file(['Keyword, keyword ,Tags\nseo,seo,x\n']))).toEqual({ kind: 'duplicate_headers' });
    expect(await readCsvHead(file(['a,,\nx,y,z\n']))).toEqual({ kind: 'duplicate_headers' });
  });

  it('refuses a file that holds a header line and no rows', async () => {
    expect(await readCsvHead(file(['Keyword,Tags\n']))).toEqual({ kind: 'no_rows' });
    expect(await readCsvHead(file(['Keyword,Tags\n\n  \n']))).toEqual({ kind: 'no_rows' });
  });

  it('does not call a file without rows in the bytes it read a file without rows', async () => {
    const head = await readCsvHead(file([`Keyword\n${'a'.repeat(70_000)}\n`]), 1_024);
    expect(head).toEqual({ kind: 'ok', headers: ['Keyword'], samples: [] });
  });
});
