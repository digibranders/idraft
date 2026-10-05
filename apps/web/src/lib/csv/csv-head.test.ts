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
});
