import { describe, expect, it } from 'vitest';

import { groupVolumeOf, promptVolumeOf } from './volume';

describe('promptVolumeOf', () => {
  it('is the monthly searches of the linked keyword', () => {
    expect(promptVolumeOf({ keyword: 'crm', search_volume: 1200 })).toEqual({
      state: 'ok',
      value: 1200,
      keyword: 'crm',
    });
  });

  it('keeps the three unknowns apart, and 0 searches is a number', () => {
    expect(promptVolumeOf(undefined)).toEqual({ state: 'unknown', reason: 'not_collected' });
    expect(promptVolumeOf(null)).toEqual({ state: 'unknown', reason: 'no_link' });
    expect(promptVolumeOf({ keyword: 'crm', search_volume: null })).toEqual({ state: 'unknown', reason: 'no_volume' });
    expect(promptVolumeOf({ keyword: 'rare', search_volume: 0 })).toMatchObject({ state: 'ok', value: 0 });
  });
});

describe('groupVolumeOf', () => {
  it('counts each linked keyword once, however many prompts share it', () => {
    const shared = { keyword: 'crm', search_volume: 1000 };
    const reading = groupVolumeOf([shared, shared, { keyword: 'sales crm', search_volume: 250 }, null]);
    expect(reading).toEqual({ state: 'ok', value: 1250, keywords: 2, missing: 0, prompts: 4 });
  });

  it('reports a keyword without a volume as missing, so the sum is a lower bound, never a zero', () => {
    const reading = groupVolumeOf([
      { keyword: 'a', search_volume: 100 },
      { keyword: 'b', search_volume: null },
    ]);
    expect(reading).toMatchObject({ state: 'ok', value: 100, keywords: 2, missing: 1 });
  });

  it('is unknown with a reason', () => {
    expect(groupVolumeOf([undefined, undefined])).toMatchObject({ state: 'unknown', reason: 'not_collected' });
    expect(groupVolumeOf([null, null])).toMatchObject({ state: 'unknown', reason: 'no_link', keywords: 0, prompts: 2 });
    expect(groupVolumeOf([{ keyword: 'a', search_volume: null }])).toMatchObject({
      state: 'unknown',
      reason: 'no_volume',
      keywords: 1,
    });
    expect(groupVolumeOf([])).toMatchObject({ state: 'unknown', reason: 'no_link' });
  });
});
