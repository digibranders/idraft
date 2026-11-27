import { describe, expect, it } from 'vitest';

import {
  changeTable,
  exportFileName,
  exportTableId,
  keywordTable,
  pairTable,
  switchKeywordTable,
  CHANGE_COLUMNS,
  KEYWORD_COLUMNS,
  PAIR_COLUMNS,
  SWITCH_KEYWORD_COLUMNS,
} from './cann-export';
import { toCsv } from '@/lib/csv/csv-write';
import { cannKeyword, cannPage, cannPairs, cannSwitchRow } from '@/mocks/cannibalization-fixture';

const names = <Key extends string>(keys: readonly Key[]): Record<Key, string> =>
  Object.fromEntries(keys.map((key) => [key, `H ${key}`])) as Record<Key, string>;

describe('exportTableId and exportFileName', () => {
  it('names the table in view', () => {
    expect(exportTableId('cannibalization', 'keywords')).toBe('keywords');
    expect(exportTableId('cannibalization', 'pairs')).toBe('pairs');
    expect(exportTableId('switching', 'changes')).toBe('changes');
    expect(exportTableId('switching', 'keywords')).toBe('switch-keywords');
  });

  it('puts the table, the scope and the last day in the file name', () => {
    expect(exportFileName('keywords', { device: 'mobile', days: 90 }, '2026-11-26')).toBe(
      'cannibalization-keywords-mobile-90d-2026-11-26.csv',
    );
    expect(exportFileName('pairs', { device: 'desktop', days: 30 }, undefined)).toBe(
      'cannibalization-pairs-desktop-30d.csv',
    );
  });
});

describe('keywordTable', () => {
  const row = cannKeyword('=cmd', 'likely', {
    volume: null,
    rank_gap: 6.4,
    together_rate: 0.456,
    pages: [cannPage('a', 'A', 10, { path: '/a' }), cannPage('b', 'B', 1, { path: '/b' })],
    current_url_id: 'a',
    current_rank: 4,
  });
  const table = keywordTable([row], { header: names(KEYWORD_COLUMNS), status: (verdict) => `S ${verdict}` });

  it('writes the header words and one line per keyword', () => {
    expect(table.header).toEqual(KEYWORD_COLUMNS.map((key) => `H ${key}`));
    expect(table.rows).toHaveLength(1);
  });

  it('keeps numbers as numbers, leaves what is not known empty and lists the pages that count', () => {
    expect(table.rows[0]).toEqual(["'=cmd", 'S likely', 'A /a', 4, 6, 0, 46, null, '/a']);
  });

  it('is written as CSV text that a spreadsheet reads as text for a formula', () => {
    expect(toCsv(table)).toContain("'=cmd");
  });
});

describe('pairTable', () => {
  it('writes the two addresses, the counts and the overlap as a percent', () => {
    const table = pairTable(cannPairs().items, { header: names(PAIR_COLUMNS) });
    expect(table.rows[0]).toEqual(['/a', '/b', 3, 900, 1, 2, 1, 40]);
  });
});

describe('changeTable', () => {
  it('writes the date, both pages, the ranks, the type and the target status', () => {
    const row = cannSwitchRow('kw', { from_url: 'https://example.com/x?q=1', to_url: 'https://example.com/y' });
    const table = changeTable([{ row, target: 'back' }], {
      header: names(CHANGE_COLUMNS),
      type: (flip) => (flip ? 'Flip' : 'Moved'),
      target: (status) => `T ${status}`,
    });
    expect(table.rows[0]).toEqual(['kw', '2026-11-10', '/x', '/y', 5, 4, 6, 'Moved', 'T back']);
  });
});

describe('switchKeywordTable', () => {
  it('writes the page now and the counts', () => {
    const row = cannKeyword('kw', 'likely', { flip_flops: 2, held_now_days: 5, longest_hold_days: 9 });
    const table = switchKeywordTable([row], { header: names(SWITCH_KEYWORD_COLUMNS) });
    expect(table.rows[0]).toEqual(['kw', '/a', 0, 2, 2, 5, 9]);
  });
});
