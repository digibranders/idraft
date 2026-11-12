import { describe, expect, it } from 'vitest';

import { chartCsv } from './chart-csv';
import type { CategorySeries } from './category-chart';

const SERIES: CategorySeries[] = [
  { id: 'volume', name: 'Search volume', role: { kind: 'brand' }, values: [8100, null, 'failed'] },
  { id: 'previous', name: 'Previous year', role: { kind: 'reference' }, values: [7400, 7100, 8800] },
];

const base = { categoryHeader: 'Month', categories: ['Jul', 'Aug', 'Sep'], series: SERIES, failedText: 'Failed' };

describe('chartCsv', () => {
  it('starts with the category header, then one column per series', () => {
    expect(chartCsv(base).header).toEqual(['Month', 'Search volume', 'Previous year']);
  });

  it('writes a number as the raw number, a gap as an empty cell and a failed point as its word', () => {
    expect(chartCsv(base).rows).toEqual([
      ['Jul', 8100, 7400],
      ['Aug', null, 7100],
      ['Sep', 'Failed', 8800],
    ]);
  });

  it('writes a missing index as a gap, never as zero', () => {
    const table = chartCsv({ ...base, categories: ['Jul', 'Aug', 'Sep', 'Oct'] });
    expect(table.rows[3]).toEqual(['Oct', null, null]);
  });

  it('puts the words of a point in place of its value, guarded against formulas', () => {
    const table = chartCsv({
      ...base,
      cellText: (seriesId, index) =>
        seriesId === 'volume' && index === 0
          ? '40%, 4 of 10 answers'
          : seriesId === 'previous' && index === 1
            ? '=SUM(A1)'
            : null,
    });
    expect(table.rows[0]).toEqual(['Jul', '40%, 4 of 10 answers', 7400]);
    expect(table.rows[1]).toEqual(['Aug', null, "'=SUM(A1)"]);
  });

  it('guards a header or a category that looks like a formula', () => {
    const table = chartCsv({
      ...base,
      categoryHeader: '=HYPERLINK("x")',
      categories: ['+Jul', '@Aug', '-Sep'],
      series: [{ id: 'volume', name: '-Search volume', role: { kind: 'brand' }, values: [1, 2, 3] }],
    });
    expect(table.header).toEqual(['\'=HYPERLINK("x")', "'-Search volume"]);
    expect(table.rows.map((row) => row[0])).toEqual(["'+Jul", "'@Aug", "'-Sep"]);
  });

  it('keeps the series a person hid in the legend', () => {
    expect(chartCsv(base).header).toHaveLength(3);
  });
});
