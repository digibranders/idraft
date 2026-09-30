import { describe, expect, it } from 'vitest';
import {
  MINUS,
  classifyRankChange,
  displayUrl,
  formatBusinessDate,
  formatCompact,
  formatCount,
  formatCurrency,
  formatDateRange,
  formatDetailDateTime,
  formatInteger,
  formatInterval,
  formatMetricDelta,
  formatPercent,
  formatPointsDelta,
  formatRankCell,
  formatRankChange,
  formatRankInline,
  formatRelative,
  formatSampleCount,
  formatSignedInteger,
  formatTableDateTime,
  rankBucket,
  truncatePath,
} from './index';

describe('numbers', () => {
  it('formats exact integers with grouping', () => {
    expect(formatInteger(1240)).toBe('1,240');
    expect(formatInteger(-1240)).toBe(`${MINUS}1,240`);
    expect(formatInteger(null)).toBe('n/a');
    expect(formatInteger(Number.NaN)).toBe('n/a');
  });

  it('keeps values under 10,000 exact in compact form and abbreviates above', () => {
    expect(formatCompact(9870)).toBe('9,870');
    expect(formatCompact(12_400)).toBe('12.4K');
    expect(formatCompact(1_240_000)).toBe('1.24M');
    expect(formatCompact(3_180_000)).toBe('3.18M');
  });

  it('chooses exact or compact by context', () => {
    expect(formatCount(12_480, 'table')).toBe('12,480');
    expect(formatCount(12_480, 'summary')).toBe('12.5K');
    expect(formatCount(12_480, 'tooltip')).toBe('12,480');
  });

  it('formats percentages and point deltas', () => {
    expect(formatPercent(0.472)).toBe('47.2%');
    expect(formatPercent(0.34, { decimals: 0 })).toBe('34%');
    expect(formatPointsDelta(0.053)).toBe('+5.3 pts');
    expect(formatPointsDelta(-0.009)).toBe(`${MINUS}0.9 pts`);
    expect(formatPointsDelta(0.0004)).toBe('0 pts');
  });

  it('formats signed integers with a typographic minus and no sign on zero', () => {
    expect(formatSignedInteger(3)).toBe('+3');
    expect(formatSignedInteger(-12)).toBe(`${MINUS}12`);
    expect(formatSignedInteger(0)).toBe('0');
  });

  it('formats currency with unit-cost precision below one cent', () => {
    expect(formatCurrency(24.18)).toBe('$24.18');
    expect(formatCurrency(14.2)).toBe('$14.20');
    expect(formatCurrency(0.0042)).toBe('$0.0042');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(1_240_000, { context: 'summary' })).toBe('$1.24M');
    expect(formatCurrency(1_240_000, { context: 'table' })).toBe('$1,240,000.00');
  });

  it('formats intervals and sample counts without dashes', () => {
    expect(formatInterval(0.29, 0.39)).toBe('29% to 39%');
    expect(formatSampleCount(612, 1800)).toBe('612 of 1,800');
  });
});

describe('ranks', () => {
  it('renders ranks and depth-aware nulls', () => {
    expect(formatRankCell({ rank: 3, depth: 20 })).toBe('3');
    expect(formatRankCell({ rank: null, depth: 20 })).toBe('>20');
    expect(formatRankInline({ rank: 3, depth: 20 })).toBe('#3');
    expect(formatRankInline({ rank: null, depth: 100 })).toBe('not in top 100');
  });

  it('buckets ranks', () => {
    expect(rankBucket({ rank: 1, depth: 20 })).toBe('top3');
    expect(rankBucket({ rank: 10, depth: 20 })).toBe('top10');
    expect(rankBucket({ rank: 57, depth: 100 })).toBe('top100');
    expect(rankBucket({ rank: null, depth: 20 })).toBe('beyond');
  });

  it('treats a numeric decrease as an improvement', () => {
    const change = classifyRankChange({ rank: 8, depth: 20 }, { rank: 3, depth: 20 });
    expect(change).toEqual({ kind: 'improved', positions: 5, emphasized: true });
    expect(formatRankChange(change)).toEqual({ text: '↑5', label: 'improved 5 positions', tone: 'positive' });
  });

  it('keeps small moves neutral relative to the keyword volatility', () => {
    const small = classifyRankChange({ rank: 5, depth: 20 }, { rank: 7, depth: 20 });
    expect(small.emphasized).toBe(false);
    expect(formatRankChange(small).tone).toBe('neutral');
    const volatile = classifyRankChange({ rank: 5, depth: 20 }, { rank: 10, depth: 20 }, 3);
    expect(volatile.emphasized).toBe(false); // 5 positions is inside 2 x 3 = 6 for this volatile keyword
  });

  it('handles entering, dropping and staying beyond depth', () => {
    expect(classifyRankChange({ rank: null, depth: 20 }, { rank: 12, depth: 20 }).kind).toBe('entered');
    expect(classifyRankChange({ rank: 12, depth: 20 }, { rank: null, depth: 20 }).kind).toBe('dropped');
    expect(classifyRankChange({ rank: 45, depth: 100 }, { rank: null, depth: 20 }).kind).toBe('unchanged_beyond');
    expect(classifyRankChange(null, { rank: 4, depth: 20 }).kind).toBe('first_check');
  });
});

describe('metric deltas', () => {
  it('colors only detectable changes, by polarity', () => {
    expect(
      formatMetricDelta({ value: 0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: true }).tone,
    ).toBe('positive');
    expect(
      formatMetricDelta({ value: -0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: true }).tone,
    ).toBe('negative');
    expect(
      formatMetricDelta({ value: 0.053, unit: 'points', polarity: 'higher_is_better', isDetectable: false }),
    ).toMatchObject({
      tone: 'neutral',
      note: 'Within normal variation',
    });
    expect(formatMetricDelta({ value: 0.2, unit: 'relative', polarity: 'neutral', isDetectable: true }).tone).toBe(
      'neutral',
    );
    expect(formatMetricDelta({ value: 12, unit: 'count', polarity: 'lower_is_better', isDetectable: true }).tone).toBe(
      'negative',
    );
  });
});

describe('dates', () => {
  const now = new Date('2026-09-29T14:00:00Z');
  it('formats table timestamps in the project timezone', () => {
    expect(formatTableDateTime('2026-09-29T13:02:00Z', 'Asia/Kolkata', now)).toBe('Sep 29, 18:32');
    expect(formatTableDateTime('2025-09-29T13:02:00Z', 'Asia/Kolkata', now)).toBe('Sep 29, 2025, 18:32');
  });
  it('formats detail timestamps with a timezone name', () => {
    expect(formatDetailDateTime('2026-09-29T22:32:00Z', 'America/New_York')).toBe('Sep 29, 2026 · 18:32 EDT');
  });
  it('formats relative freshness', () => {
    expect(formatRelative('2026-09-29T13:48:00Z', 'UTC', now)).toBe('12m ago');
    expect(formatRelative('2026-09-29T11:00:00Z', 'UTC', now)).toBe('3h ago');
    expect(formatRelative('2026-09-27T14:00:00Z', 'UTC', now)).toBe('2d ago');
    expect(formatRelative('2026-09-10T14:00:00Z', 'UTC', now)).toBe('Sep 10, 14:00');
  });
  it('never converts business dates and uses words for ranges', () => {
    expect(formatBusinessDate('2026-09-29')).toBe('Sep 29, 2026');
    expect(formatDateRange('2026-09-01', '2026-09-28')).toBe('Sep 1 to Sep 28, 2026');
    expect(formatDateRange('2025-12-15', '2026-01-11')).toBe('Dec 15, 2025 to Jan 11, 2026');
  });
});

describe('urls', () => {
  it('strips scheme, www, tracking parameters and fragments for display', () => {
    const u = displayUrl('https://www.example.com/blog/article-title/?utm_source=chatgpt.com&srsltid=x#:~:text=crm');
    expect(u).toMatchObject({
      host: 'example.com',
      path: '/blog/article-title',
      display: 'example.com/blog/article-title',
      valid: true,
    });
    expect(u.original).toContain('utm_source');
  });
  it('keeps meaningful query parameters and the root path', () => {
    expect(displayUrl('https://shop.example.com/search?q=crm&utm_medium=x').display).toBe(
      'shop.example.com/search?q=crm',
    );
    expect(displayUrl('https://example.com/').path).toBe('/');
  });
  it('marks unparseable input as invalid', () => {
    expect(displayUrl('not a url').valid).toBe(false);
  });
  it('truncates long paths in the middle', () => {
    expect(truncatePath('/blog/2026/09/how-to-choose-a-crm', 28)).toBe('/blog/…/how-to-choose-a-crm');
  });
});
