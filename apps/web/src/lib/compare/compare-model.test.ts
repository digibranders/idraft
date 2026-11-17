import { describe, expect, it } from 'vitest';

import { cmpParam, compareKindOf, compareParams, comparedWindow, isCompared, parseCompare } from './compare-model';

const WINDOW = { from: '2026-09-18', to: '2026-10-15', timezone: 'Asia/Kolkata' };

describe('parseCompare', () => {
  it('reads cmp=off as off and anything else as on', () => {
    expect(parseCompare('off')).toBe(false);
    expect(parseCompare(null)).toBe(true);
    expect(parseCompare(undefined)).toBe(true);
    expect(parseCompare('')).toBe(true);
    expect(parseCompare('previous_period')).toBe(true);
    expect(parseCompare('previous_year')).toBe(true);
    expect(parseCompare('OFF')).toBe(true);
  });
});

describe('cmpParam', () => {
  it('is null for on and off for off', () => {
    expect(cmpParam(true)).toBeNull();
    expect(cmpParam(false)).toBe('off');
  });

  it('round trips through parseCompare', () => {
    expect(parseCompare(cmpParam(true))).toBe(true);
    expect(parseCompare(cmpParam(false))).toBe(false);
  });

  it('writes year for the same dates a year earlier, and off whatever the kind', () => {
    expect(cmpParam(true, 'previous_year')).toBe('year');
    expect(cmpParam(true, 'previous_period')).toBeNull();
    expect(cmpParam(false, 'previous_year')).toBe('off');
    expect(compareKindOf(cmpParam(true, 'previous_year'))).toBe('previous_year');
  });
});

describe('compareKindOf', () => {
  it('is the year only for cmp=year', () => {
    expect(compareKindOf('year')).toBe('previous_year');
    for (const value of ['previous', 'off', null, undefined, '', 'YEAR']) {
      expect(compareKindOf(value)).toBe('previous_period');
    }
  });
});

describe('compareParams', () => {
  it('asks previous_period while on and sends nothing while off', () => {
    expect(compareParams(true)).toEqual({ compare: 'previous_period' });
    expect(compareParams(false)).toEqual({});
  });
});

describe('isCompared', () => {
  it('is true only for a response that carries compare_window', () => {
    expect(isCompared({ compare_window: WINDOW })).toBe(true);
    expect(isCompared({})).toBe(false);
    expect(isCompared({ compare_window: null })).toBe(false);
    expect(isCompared(undefined)).toBe(false);
    expect(isCompared(null)).toBe(false);
  });
});

describe('comparedWindow', () => {
  it('returns the window or null', () => {
    expect(comparedWindow({ compare_window: WINDOW })).toEqual(WINDOW);
    expect(comparedWindow({})).toBeNull();
    expect(comparedWindow({ compare_window: null })).toBeNull();
    expect(comparedWindow(undefined)).toBeNull();
  });
});
