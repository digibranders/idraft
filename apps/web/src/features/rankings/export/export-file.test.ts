import { describe, expect, it } from 'vitest';

import type { WorkbookColors } from './export-colors';
import { buildCsv, buildWorkbook, fileName, tileSpans } from './export-file';
import type { KeywordExport } from './export-model';

const TABLE: KeywordExport = {
  kpis: [
    { label: 'Keywords', value: 110 },
    { label: 'Top 3', value: 8 },
  ],
  header: ['Keyword', 'Desktop'],
  kinds: ['keyword', 'rank'],
  rows: [
    ['soc service', 1],
    ['managed soc', '>100'],
    ['lonely', null],
  ],
};

// Where no stylesheet is loaded no token resolves, and the workbook keeps the sheet's own colors
const NO_COLORS: WorkbookColors = {
  ink: '',
  muted: '',
  onInk: '',
  brand: '',
  brandSubtle: '',
  stripe: '',
  line: '',
  surface: '',
  positive: '',
  positiveSubtle: '',
  warning: '',
  warningSubtle: '',
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

  it('shares the columns out between four tiles of about the same width, each with a column at least', () => {
    const widths = [46, 12, 12, 46, 15, 9, 12, 16, 10, 20, 22];
    const spans = tileSpans(widths);
    expect(spans).toHaveLength(4);
    expect(spans.reduce((sum, span) => sum + span, 0)).toBe(widths.length);
    expect(spans.every((span) => span >= 1)).toBe(true);
    // A table with no more columns than tiles gives each tile one column
    expect(tileSpans([20, 10, 10, 10])).toEqual([1, 1, 1, 1]);
    expect(tileSpans([20, 10, 10, 10, 10])).toEqual([1, 1, 1, 2]);
  });

  it('writes a workbook, a zip file of one sheet, with the counts above the table', async () => {
    const blob = await buildWorkbook('Keywords', [['Country', 'India']], TABLE, NO_COLORS);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A .xlsx is a zip file: it starts with "PK"
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('writes a keyword that has no metrics yet, with every figure empty', async () => {
    const table: KeywordExport = {
      kpis: [
        { label: 'Keywords', value: 1 },
        { label: 'Top 3', value: 0 },
        { label: 'Top 10', value: 0 },
        { label: 'Top 20', value: 0 },
      ],
      header: ['Keyword', 'Desktop', 'Ranking URL', 'Volume', 'KD', 'CPC', 'Intent', 'Priority', 'Groups', 'Checked'],
      kinds: ['keyword', 'rank', 'url', 'volume', 'difficulty', 'cpc', 'intent', 'priority', 'groups', 'checked'],
      rows: [['new keyword', null, null, null, null, null, null, 0, null, null]],
    };
    const blob = await buildWorkbook('Keywords', [['Country', 'India']], table, NO_COLORS);
    expect(blob.size).toBeGreaterThan(1000);
  });
});
