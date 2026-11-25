import { describe, expect, it } from 'vitest';

import { MAX_SLICES, shareOf, toSlices } from './donut-model';
import { donutOption } from './donut-option';
import type { ChartTokens } from '@/lib/design/read-tokens';

const item = (id: string, value: number | null): never =>
  ({ id, name: id, value, role: { kind: 'palette', index: 2 } }) as never;

describe('toSlices', () => {
  it('leaves out an unknown value and a zero, and puts the largest first', () => {
    const slices = toSlices([item('a', 0.1), item('b', null), item('c', 0), item('d', 0.4)], 'Other');
    expect(slices.map((slice) => slice.id)).toEqual(['d', 'a']);
  });

  it('sums every brand past the sixth slice into one other slice', () => {
    const many = Array.from({ length: 9 }, (_, index) => item(`b${String(index)}`, 0.1 * (index + 1)));
    const slices = toSlices(many, 'Other brands');
    expect(slices).toHaveLength(MAX_SLICES);
    const other = slices.at(-1);
    expect(other?.name).toBe('Other brands');
    expect(other?.role).toEqual({ kind: 'other' });
    // The four smallest of nine: 0.1 + 0.2 + 0.3 + 0.4
    expect(other?.value).toBeCloseTo(1.0);
  });

  it('draws nothing when no brand has a value', () => {
    expect(toSlices([item('a', null)], 'Other')).toEqual([]);
  });
});

describe('shareOf', () => {
  it('is the slice over the whole, and 0 for an empty whole', () => {
    const slices = toSlices([item('a', 1), item('b', 3)], 'Other');
    expect(shareOf(1, slices)).toBeCloseTo(0.25);
    expect(shareOf(1, [])).toBe(0);
  });
});

describe('donutOption', () => {
  const tokens = {
    palette: ['one', 'two', 'three', 'four', 'five', 'six'],
    other: 'grey',
    surfaceElevated: 'plate',
    border: 'edge',
    foreground: 'ink',
    fontFamily: 'sans-serif',
  } as unknown as ChartTokens;
  const option = donutOption({
    slices: toSlices([item('a', 0.6), item('b', 0.4)], 'Other'),
    tokens,
    formatValue: (value) => `${String(value)}!`,
  });
  const series = (
    option['series'] as { type: string; data: { name: string; value: number; itemStyle: { color: string } }[] }[]
  )[0];

  it('is one pie with a slice per brand, coloured by its role', () => {
    expect(series?.type).toBe('pie');
    expect(series?.data.map((entry) => entry.name)).toEqual(['a', 'b']);
    expect(series?.data[0]?.itemStyle.color).toBe('two');
  });

  it('writes a tooltip as escaped text', () => {
    const tooltip = option['tooltip'] as { formatter: (point: { name: string; value: number }) => string };
    const text = tooltip.formatter({ name: '<b>x</b>', value: 1 });
    expect(text).not.toContain('<b>');
    expect(text).toContain('1!');
  });
});
