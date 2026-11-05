import { describe, expect, it } from 'vitest';

import { addPlan, chunkKeywords, checkPriceUsd, costOf, MAX_ADD_COUNTRIES } from './add-plan';

describe('addPlan', () => {
  it('multiplies keywords, devices and countries into the checks a day', () => {
    expect(addPlan({ keywords: 12, device: 'both', countries: 2 })).toEqual({
      keywords: 12,
      devices: 2,
      countries: 2,
      checksPerDay: 48,
    });
  });
  it('counts one device for desktop or mobile, and for a default not yet known', () => {
    expect(addPlan({ keywords: 3, device: 'mobile', countries: 4 }).checksPerDay).toBe(12);
    expect(addPlan({ keywords: 3, device: null, countries: 4 }).checksPerDay).toBe(12);
  });
  it('counts nothing without keywords or countries', () => {
    expect(addPlan({ keywords: 0, device: 'both', countries: 3 }).checksPerDay).toBe(0);
    expect(addPlan({ keywords: 5, device: 'both', countries: 0 }).checksPerDay).toBe(0);
  });
});

describe('costOf', () => {
  it('gives the cost a day and a month (30 days) of the checks', () => {
    const cost = costOf(48, 0.0066);
    expect(cost?.day).toBeCloseTo(0.3168, 6);
    expect(cost?.month).toBeCloseTo(9.504, 6);
  });
  it('gives nothing when the price is not known', () => {
    expect(costOf(48, null)).toBeNull();
  });
});

describe('checkPriceUsd', () => {
  const page = {
    endpoint: 'serp/google/organic',
    price_unit: 'page',
    conditions: { queue: 'standard' },
    unit_price_usd: '0.0006',
  };
  const task = {
    endpoint: 'serp/google/organic',
    price_unit: 'task',
    conditions: { queue: 'standard', async_ai_overview: true },
    unit_price_usd: '0.0006',
  };
  it('is ten pages of results plus the AI Overview task at depth 100', () => {
    expect(checkPriceUsd([page, task])).toBeCloseTo(0.0066, 6);
  });
  it('is null when a price is missing', () => {
    expect(checkPriceUsd([page])).toBeNull();
    expect(checkPriceUsd([])).toBeNull();
  });
});

describe('chunkKeywords', () => {
  it('keeps keywords x countries within the 1,000 items one request takes', () => {
    const keywords = Array.from({ length: 250 }, (_, index) => `k${String(index)}`);
    const chunks = chunkKeywords(keywords, 10);
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
    expect(chunks.flat()).toEqual(keywords);
  });
  it('is one chunk when everything fits', () => {
    expect(chunkKeywords(['a', 'b'], 3)).toEqual([['a', 'b']]);
  });
  it('allows ten countries at most', () => {
    expect(MAX_ADD_COUNTRIES).toBe(10);
  });
});
