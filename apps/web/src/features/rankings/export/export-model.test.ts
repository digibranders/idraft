import { describe, expect, it } from 'vitest';

import type { RankCell, TrackedKeywordRow } from '@/lib/api/types';
import type { PairedRow } from '../keyword-pairs';
import { buildExport, rankCell, safeText, toCsv, type ExportLabels } from './export-model';

const LABELS: ExportLabels = {
  keyword: 'Keyword',
  rank: 'Rank',
  desktop: 'Desktop',
  mobile: 'Mobile',
  url: 'Ranking URL',
  volume: 'Volume',
  clicks: 'Clicks (28 days)',
  impressions: 'Impressions (28 days)',
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
  intents: { informational: 'Informational', commercial: 'Commercial' },
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

  it('counts the tracked keywords of the device chosen, as the strip does', () => {
    const { kpis } = buildExport(rows, 'desktop', LABELS);
    expect(kpis).toEqual([
      { label: 'Keywords', value: 3 },
      { label: 'Top 3', value: 1 },
      { label: 'Top 10', value: 2 },
      { label: 'Top 20', value: 2 },
    ]);
  });

  it('counts only the device chosen, and names it in the one rank column', () => {
    const mobile = buildExport(rows, 'mobile', LABELS);
    expect(mobile.kpis.map((kpi) => kpi.value)).toEqual([2, 1, 1, 1]);
    expect(mobile.header).toContain('Rank (Mobile)');
    expect(mobile.header).not.toContain('Desktop');
    expect(mobile.header).not.toContain('Mobile');
    const desktop = buildExport(rows, 'desktop', LABELS);
    expect(desktop.header).toContain('Rank (Desktop)');
    expect(desktop.header).not.toContain('Desktop');
    expect(desktop.header).not.toContain('Mobile');
  });

  it('writes a row for each keyword with the rank on the device shown, the volume and the ranking address', () => {
    const { header, rows: body } = buildExport(rows, 'desktop', LABELS);
    expect(header.slice(0, 2)).toEqual(['Keyword', 'Rank (Desktop)']);
    expect(body[0]).toEqual([
      'soc service',
      1,
      'https://eventussecurity.com/soc',
      8100,
      null,
      null,
      13,
      2.66,
      'Informational',
      3,
      'Cybersecurity',
      '2026-11-04 05:00 UTC',
    ]);
    expect(body[2]?.slice(0, 2)).toEqual(['lonely', '>100']);
  });

  it('names the kind of each column in the order of the header, for the workbook to format by', () => {
    const desktop = buildExport(rows, 'desktop', LABELS);
    expect(desktop.kinds).toHaveLength(desktop.header.length);
    expect(desktop.kinds.slice(0, 3)).toEqual(['keyword', 'rank', 'url']);
    expect(desktop.kinds.filter((kind) => kind === 'rank')).toHaveLength(1);
    expect(buildExport(rows, 'mobile', LABELS).kinds.filter((kind) => kind === 'rank')).toHaveLength(1);
  });

  it('leaves the intent empty when it has no name', () => {
    const unnamed = paired(ranked(1), null);
    unnamed.intent = 'unknown';
    expect(buildExport([unnamed], 'desktop', LABELS).rows[0]?.[8]).toBeNull();
  });

  it('writes the Search Console counts of the device shown after the volume, and nothing without them', () => {
    const connected = paired(ranked(1), ranked(2));
    connected.gsc = {
      state: 'ok',
      clicks: { desktop: 120, mobile: 30 },
      impressions: { desktop: 4000, mobile: 900 },
    };
    const desktop = buildExport([connected], 'desktop', LABELS);
    expect(desktop.header.slice(3, 6)).toEqual(['Volume', 'Clicks (28 days)', 'Impressions (28 days)']);
    expect(desktop.kinds.slice(3, 6)).toEqual(['volume', 'clicks', 'impressions']);
    expect(desktop.rows[0]?.slice(3, 6)).toEqual([8100, 120, 4000]);
    const waiting = paired(ranked(1), null);
    waiting.gsc = { state: 'pending' };
    expect(buildExport([waiting], 'desktop', LABELS).rows[0]?.slice(4, 6)).toEqual([null, null]);
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
