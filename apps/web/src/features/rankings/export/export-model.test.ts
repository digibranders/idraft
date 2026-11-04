import { describe, expect, it } from 'vitest';

import type { RankCell, TrackedKeywordRow } from '@/lib/api/types';
import type { PairedRow } from '../keyword-pairs';
import { buildExport, rankCell, safeText, toCsv, type ExportLabels } from './export-model';

const LABELS: ExportLabels = {
  keyword: 'Keyword',
  desktop: 'Desktop',
  mobile: 'Mobile',
  url: 'Ranking URL',
  volume: 'Volume',
  difficulty: 'KD',
  cpc: 'CPC (USD)',
  intent: 'Intent',
  priority: 'Priority',
  groups: 'Groups',
  checked: 'Last checked',
  keywords: 'Keywords',
  top3: 'Top 3',
  top10: 'Top 10',
  top20: 'Top 20',
};

const cell = (over: Partial<RankCell>): RankCell => ({
  absolute_rank: null,
  depth_requested: 100,
  depth_returned: 100,
  observed_at: '2026-11-04T05:00:00Z',
  rank: null,
  serp_snapshot_id: null,
  state: 'beyond_depth',
  url: null,
  ...over,
});

function tracked(device: 'desktop' | 'mobile', current: RankCell): TrackedKeywordRow {
  return {
    device,
    state: { current },
    keyword: { text: 'soc service', keyword_id: 'k1' },
    metrics: { search_volume: { value: 8100 }, keyword_difficulty: 13, cpc_usd: '2.660000' },
    groups: [{ group_id: 'g', name: 'Cybersecurity', path: 'Cybersecurity' }],
    intent: 'informational',
    priority: 3,
  } as unknown as TrackedKeywordRow;
}

function paired(desktop: RankCell | null, mobile: RankCell | null, text = 'soc service'): PairedRow {
  const d = desktop === null ? null : tracked('desktop', desktop);
  const m = mobile === null ? null : tracked('mobile', mobile);
  const primary = (d ?? m) as TrackedKeywordRow;
  return { ...primary, keyword: { ...primary.keyword, text }, devices: { desktop: d, mobile: m } };
}

const url = {
  canonical_url: 'https://eventussecurity.com/soc',
  host: 'h',
  path: '/',
  registrable_domain: 'r',
  url_id: '1',
};
const ranked = (rank: number): RankCell => cell({ state: 'ranked', rank, url });

describe('rankCell', () => {
  it('is a number up to the depth, `>` and the depth beyond it, and nothing before a check', () => {
    expect(rankCell(ranked(7))).toBe(7);
    expect(rankCell(cell({}))).toBe('>100');
    expect(rankCell(cell({ state: 'not_checked', depth_requested: null }))).toBeNull();
    expect(rankCell(undefined)).toBeNull();
  });
});

describe('buildExport', () => {
  const rows = [
    paired(ranked(1), cell({})),
    paired(ranked(8), ranked(2), 'managed soc'),
    paired(cell({}), null, 'lonely'),
  ];

  it('counts the tracked keywords of both devices, as the strip does', () => {
    const { kpis } = buildExport(rows, 'both', LABELS);
    expect(kpis).toEqual([
      { label: 'Keywords', value: 5 },
      { label: 'Top 3', value: 2 },
      { label: 'Top 10', value: 3 },
      { label: 'Top 20', value: 3 },
    ]);
  });

  it('counts only the device chosen, and drops the other device’s column', () => {
    const mobile = buildExport(rows, 'mobile', LABELS);
    expect(mobile.kpis.map((kpi) => kpi.value)).toEqual([2, 1, 1, 1]);
    expect(mobile.header).not.toContain('Desktop');
    expect(mobile.header).toContain('Mobile');
    const desktop = buildExport(rows, 'desktop', LABELS);
    expect(desktop.kpis[0]?.value).toBe(3);
    expect(desktop.header).not.toContain('Mobile');
  });

  it('writes a row for each keyword with a rank for each device, the volume and the ranking address', () => {
    const { header, rows: body } = buildExport(rows, 'both', LABELS);
    expect(header.slice(0, 3)).toEqual(['Keyword', 'Desktop', 'Mobile']);
    expect(body[0]).toEqual([
      'soc service',
      1,
      '>100',
      'https://eventussecurity.com/soc',
      8100,
      13,
      2.66,
      'informational',
      3,
      'Cybersecurity',
      '2026-11-04 05:00 UTC',
    ]);
    expect(body[2]?.slice(0, 3)).toEqual(['lonely', '>100', null]);
  });
});

describe('text written to a file', () => {
  it('keeps a spreadsheet from reading a keyword as a formula', () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(safeText('+1 soc')).toBe("'+1 soc");
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
    expect(csv).toBe('﻿Keyword,Desktop\r\n"a, ""b""",3\r\n"line\nbreak",\r\n');
  });
});
