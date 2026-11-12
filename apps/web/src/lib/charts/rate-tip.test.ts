import { describe, expect, it } from 'vitest';

import { rateTipRow, rateTipText, type RateTipValue, type RateTipWords } from './rate-tip';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

const words: RateTipWords = {
  value: (ratio) => `${(ratio * 100).toFixed(1)}%`,
  answers: (k, n) => `${k.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} answers`,
  interval: (band) => `${String(Math.round(band.low * 100))}% to ${String(Math.round(band.high * 100))}%`,
  prompts: (count) => `${String(count)} prompts, each counts once`,
  thin: (n) => `${String(n)} answers, fewer than 4`,
  pooled: (weeks) => `pooled over ${String(weeks)} weeks`,
  noAnswers: 'No answers',
};

const full: RateTipValue = { value: 0.34, k: 612, n: 1800, band: { low: 0.28, high: 0.41 }, thin: false };

describe('rateTipText', () => {
  it('says the value, the answers behind it and the interval', () => {
    expect(rateTipText(full, words)).toBe('34.0%, 612 of 1,800 answers, 28% to 41%');
  });

  it('adds the prompts and then the pooled weeks', () => {
    expect(rateTipText({ ...full, prompts: 250, pooledWeeks: 4 }, words)).toBe(
      '34.0%, 612 of 1,800 answers, 28% to 41%, 250 prompts, each counts once, pooled over 4 weeks',
    );
  });

  it('leaves out the interval a point does not have', () => {
    expect(rateTipText({ ...full, band: null }, words)).toBe('34.0%, 612 of 1,800 answers');
  });

  it('says only the answers of a thin point: no percent and no interval', () => {
    const text = rateTipText({ value: 0.5, k: 1, n: 3, band: { low: 0.1, high: 0.9 }, thin: true }, words);
    expect(text).toBe('3 answers, fewer than 4');
    expect(text).not.toContain('%');
  });

  it('says there are no answers when n is 0, whatever else it holds', () => {
    expect(rateTipText({ value: 0, k: 0, n: 0, band: null, thin: false }, words)).toBe('No answers');
    expect(rateTipText({ value: null, k: null, n: 0, band: null, thin: true }, words)).toBe('No answers');
  });

  it('never writes an unknown value as 0%', () => {
    const text = rateTipText({ value: null, k: null, n: 12, band: null, thin: false }, words);
    expect(text).not.toContain('0.0%');
    expect(text).not.toContain('%');
  });

  it('never writes a percent without the answers behind it (R1)', () => {
    expect(rateTipText({ value: 0.34, k: null, n: 1800, band: null, thin: false }, words)).toBe('');
    expect(
      rateTipText({ value: 0.34, k: null, n: 1800, band: { low: 0.28, high: 0.41 }, thin: false }, words),
    ).not.toContain('%');
  });
});

describe('rateTipRow', () => {
  it('is a tooltip row of the dot, the name and the text', () => {
    const html = rateTipRow({ ...full, name: 'ChatGPT', color: '#c1' }, words, tokens);
    expect(html).toContain('background:#c1');
    expect(html).toContain('>ChatGPT</span>');
    expect(html).toContain('>34.0%, 612 of 1,800 answers, 28% to 41%</span>');
  });

  it('escapes the name', () => {
    const html = rateTipRow({ ...full, name: '<img src=x>', color: '#c1' }, words, tokens);
    expect(html).not.toContain('<img');
  });
});
