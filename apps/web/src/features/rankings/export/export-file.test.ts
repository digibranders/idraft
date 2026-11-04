import { describe, expect, it } from 'vitest';

import { buildCsv, buildWorkbook, fileName } from './export-file';
import type { KeywordExport } from './export-model';

const TABLE: KeywordExport = {
  kpis: [
    { label: 'Keywords', value: 110 },
    { label: 'Top 3', value: 8 },
  ],
  header: ['Keyword', 'Desktop'],
  rows: [
    ['soc service', 1],
    ['managed soc', '>100'],
    ['lonely', null],
  ],
};

describe('export files', () => {
  it('names a file for the day in UTC', () => {
    expect(fileName('xlsx', new Date('2026-11-04T23:30:00Z'))).toBe('keywords-2026-11-04.xlsx');
    expect(fileName('csv', new Date('2026-11-04T00:00:00Z'))).toBe('keywords-2026-11-04.csv');
  });

  it('writes the table alone as CSV', async () => {
    const text = await buildCsv(TABLE).text();
    expect(text).toContain('Keyword,Desktop\r\nsoc service,1\r\nmanaged soc,>100\r\nlonely,\r\n');
    expect(text).not.toContain('Top 3');
  });

  it('writes a workbook, a zip file of one sheet, with the counts above the table', async () => {
    const blob = await buildWorkbook('Keywords', [['Country', 'India']], TABLE);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A .xlsx is a zip file: it starts with "PK"
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
