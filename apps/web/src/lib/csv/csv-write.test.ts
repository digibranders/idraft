import { describe, expect, it } from 'vitest';

import { csvBlob, CSV_TYPE, safeText, toCsv } from './csv-write';

const BOM = String.fromCodePoint(0xfeff);

describe('text written to a file', () => {
  it('keeps a spreadsheet from reading a cell as a formula', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeText('+1 soc')).toBe("'+1 soc");
    expect(safeText('-1')).toBe("'-1");
    expect(safeText('@cmd')).toBe("'@cmd");
    expect(safeText('soc service')).toBe('soc service');
  });

  it('quotes a field with a comma, a quote or a line break, and starts with a byte order mark', () => {
    const csv = toCsv({
      header: ['Keyword', 'Desktop'],
      rows: [
        ['a, "b"', 3],
        ['line\nbreak', null],
      ],
    });
    expect(csv).toBe(`${BOM}Keyword,Desktop\r\n"a, ""b""",3\r\n"line\nbreak",\r\n`);
  });

  it('wraps the text in a CSV blob that starts with the three bytes of the byte order mark', async () => {
    const blob = csvBlob({ header: ['a'], rows: [['1']] });
    expect(blob.type).toBe(CSV_TYPE);
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
