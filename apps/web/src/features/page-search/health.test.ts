import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { attentionOrder, HEALTH_ORDER, healthTone, verdictMessage } from './health';
import type { PageHealth } from './types';

const health = (verdict: PageHealth['verdict'], absolute = 0, more: Partial<PageHealth> = {}): PageHealth => ({
  verdict,
  basis: 'clicks',
  change: null,
  absolute,
  small: false,
  flags: [],
  ...more,
});

describe('health', () => {
  it('puts the pages that need attention first, the bigger loss before the smaller', () => {
    const rows = [
      health('stable'),
      health('declining', -30),
      health('lost', -40),
      health('declining', -200),
      health('growing', 80),
      health('sharp_drop', -90),
      health('low_data'),
      health('no_data'),
      health('new', 12),
    ];
    const sorted = [...rows].sort((a, b) => attentionOrder(a) - attentionOrder(b));
    expect(sorted.map((row) => [row.verdict, row.absolute])).toEqual([
      ['lost', -40],
      ['sharp_drop', -90],
      ['declining', -200],
      ['declining', -30],
      ['stable', 0],
      ['growing', 80],
      ['new', 12],
      ['no_data', 0],
      ['low_data', 0],
    ]);
  });

  it('puts the bigger gain first among the pages that grew', () => {
    const sorted = [health('growing', 20), health('growing', 300)].sort(
      (a, b) => attentionOrder(a) - attentionOrder(b),
    );
    expect(sorted.map((row) => row.absolute)).toEqual([300, 20]);
  });

  it('lists the verdicts in the order the filter shows them', () => {
    expect(HEALTH_ORDER).toEqual([
      'lost',
      'sharp_drop',
      'declining',
      'stable',
      'growing',
      'new',
      'no_data',
      'low_data',
    ]);
  });

  it('gives each verdict a badge tone', () => {
    expect(healthTone('lost')).toBe('negative');
    expect(healthTone('sharp_drop')).toBe('negative');
    expect(healthTone('declining')).toBe('warning');
    expect(healthTone('growing')).toBe('positive');
    expect(healthTone('new')).toBe('info');
    expect(healthTone('stable')).toBe('neutral');
    expect(healthTone('no_data')).toBe('neutral');
    // The Badge has no "insufficient" tone, so a page with too little traffic is neutral
    expect(healthTone('low_data')).toBe('neutral');
  });

  it('puts the pages judged on clicks before the ones judged on impressions inside a verdict', () => {
    const rows = [
      health('declining', -9000, { basis: 'impressions' }),
      health('declining', -40),
      health('growing', 5000, { basis: 'impressions' }),
      health('declining', -300),
      health('growing', 60),
      health('declining', -700, { basis: 'impressions' }),
    ];
    const sorted = [...rows].sort((a, b) => attentionOrder(a) - attentionOrder(b));
    expect(sorted.map((row) => [row.verdict, row.basis, row.absolute])).toEqual([
      ['declining', 'clicks', -300],
      ['declining', 'clicks', -40],
      ['declining', 'impressions', -9000],
      ['declining', 'impressions', -700],
      ['growing', 'clicks', 60],
      ['growing', 'impressions', 5000],
    ]);
  });

  it('has its own sentence for a page that grew from nothing, which has no percentage', () => {
    expect(verdictMessage(health('growing', 40, { change: 0.5 }), true)).toBe('growing');
    expect(verdictMessage(health('growing', 40, { change: null }), true)).toBe('growingFromZero');
  });

  it('does not claim a comparison for a stable page with no previous numbers', () => {
    const previous = null;
    expect(verdictMessage(health('stable'), previous !== null)).toBe('stableAlone');
  });

  it('names only sentences the catalog has, for every verdict', () => {
    const sentences: Readonly<Record<string, string>> = messages.pageSearch.verdict;
    for (const verdict of HEALTH_ORDER) {
      for (const more of [{}, { change: 0.3 }, { small: true }]) {
        for (const compared of [true, false]) {
          expect(sentences[verdictMessage(health(verdict, 0, more), compared)]).toEqual(expect.any(String));
        }
      }
    }
  });

  it('names the sentence of a verdict', () => {
    expect(verdictMessage(health('declining'), true)).toBe('declining');
    expect(verdictMessage(health('sharp_drop'), true)).toBe('sharpDrop');
    expect(verdictMessage(health('growing', 0, { change: 0.2 }), true)).toBe('growing');
    expect(verdictMessage(health('stable'), true)).toBe('stable');
    expect(verdictMessage(health('stable'), false)).toBe('stableAlone');
    expect(verdictMessage(health('new'), true)).toBe('new');
    expect(verdictMessage(health('lost'), true)).toBe('lost');
    expect(verdictMessage(health('low_data', 0, { small: true }), true)).toBe('smallNumbers');
    expect(verdictMessage(health('low_data'), true)).toBe('lowData');
    expect(verdictMessage(health('low_data'), false)).toBe('lowDataAlone');
    expect(verdictMessage(health('no_data'), true)).toBe('noData');
  });
});
