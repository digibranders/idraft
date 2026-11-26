import { describe, expect, it } from 'vitest';

import { overviewCsv } from './overview-csv';
import type { OverviewModel, OverviewRow } from './overview-model';

const row = (id: string, count: number, extra: Partial<OverviewRow> = {}): OverviewRow => ({
  id,
  count,
  share: null,
  base: 'live',
  href: null,
  ...extra,
});

const model: OverviewModel = {
  strip: [row('addresses', 9)],
  status: [row('live', 5), row('blocked', 0)],
  funnel: [row('addresses', 9), row('live', 5)],
  sections: [row('/blog/', 3), row('other_sections', 2, { folded: 4 })],
  tiers: [row('untiered', 5)],
  depth: [row('depth_0', 1), row('unreachable', 2)],
  sitemap: [row('in_sitemap_indexable', 4)],
};

const labels = {
  header: ['Card', 'Row', 'Count'] as const,
  card: (card: string): string => `card:${card}`,
  row: (card: string, item: OverviewRow): string => `${card}/${item.id}`,
};

describe('overviewCsv', () => {
  it('writes the header and one line per row of every card, in card order, folded row included', () => {
    const table = overviewCsv(model, labels);
    expect(table.header).toEqual(['Card', 'Row', 'Count']);
    expect(table.rows.map((line) => line.join('|'))).toEqual([
      'card:status|status/live|5',
      'card:status|status/blocked|0',
      'card:funnel|funnel/addresses|9',
      'card:funnel|funnel/live|5',
      'card:sections|sections//blog/|3',
      'card:sections|sections/other_sections|2',
      'card:tiers|tiers/untiered|5',
      'card:depth|depth/depth_0|1',
      'card:depth|depth/unreachable|2',
      'card:sitemap|sitemap/in_sitemap_indexable|4',
    ]);
  });

  it('writes a label that a spreadsheet would read as a formula as text', () => {
    const table = overviewCsv(
      { ...model, sections: [row('=SUM(1)', 3)] },
      { ...labels, row: (_card, item) => item.id },
    );
    const line = table.rows.find((entry) => entry[0] === 'card:sections');
    expect(line?.[1]).toBe("'=SUM(1)");
  });

  it('writes no sitemap lines when the crawl found no sitemap', () => {
    const table = overviewCsv({ ...model, sitemap: null }, labels);
    expect(table.rows.some((line) => line[0] === 'card:sitemap')).toBe(false);
  });
});
