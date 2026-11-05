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
  const row = (
    price_unit: string,
    unit_price_usd: string,
    conditions: Record<string, unknown>,
    valid_from = '2026-07-01',
  ) => ({ endpoint: 'serp/google/organic', price_unit, conditions, unit_price_usd, valid_from });
  const page = row('page', '0.0006', { queue: 'standard' });
  const task = row('task', '0.0006', { queue: 'standard', async_ai_overview: true });
  /** The rows the backend seeds besides the standard ones (migration 0013). */
  const seed = [page, row('page', '0.0012', { queue: 'priority' }), row('page', '0.002', { queue: 'live' }), task];

  it('is ten pages of results plus the AI Overview task at depth 100', () => {
    expect(checkPriceUsd([page, task])).toBeCloseTo(0.0066, 6);
  });
  it('takes the standard queue, whatever other queues are in the book and in whatever order', () => {
    expect(checkPriceUsd(seed)).toBeCloseTo(0.0066, 6);
    expect(checkPriceUsd([...seed].reverse())).toBeCloseTo(0.0066, 6);
  });
  it('prices the task by its own row, not by the page', () => {
    const dearTask = row('task', '0.0009', { queue: 'standard', async_ai_overview: true });
    expect(checkPriceUsd([page, dearTask])).toBeCloseTo(0.0069, 6);
  });
  it('never takes an AI Overview row as the price of a page', () => {
    const aiPage = row('page', '0.0100', { queue: 'standard', async_ai_overview: true });
    expect(checkPriceUsd([aiPage, page, task])).toBeCloseTo(0.0066, 6);
    expect(checkPriceUsd([aiPage, task])).toBeNull();
  });
  it('takes the newest of two overlapping rows, in either order', () => {
    const older = row('page', '0.0004', { queue: 'standard' }, '2026-01-01');
    const newer = row('page', '0.0008', { queue: 'standard' }, '2026-09-01');
    const olderTask = row('task', '0.0001', { queue: 'standard', async_ai_overview: true }, '2026-01-01');
    expect(checkPriceUsd([older, newer, olderTask, task])).toBeCloseTo(0.008 + 0.0006, 6);
    expect(checkPriceUsd([newer, older, task, olderTask])).toBeCloseTo(0.008 + 0.0006, 6);
  });
  it('charges the page price for the AI Overview when the book has no task row, as the backend does', () => {
    expect(checkPriceUsd([page])).toBeCloseTo(0.0066, 6);
    expect(checkPriceUsd([page, row('task', '0.0006', { queue: 'priority', async_ai_overview: true })])).toBeCloseTo(
      0.0066,
      6,
    );
  });
  it('is null without a standard page price', () => {
    expect(checkPriceUsd([task])).toBeNull();
    expect(checkPriceUsd([row('page', '0.0012', { queue: 'priority' }), task])).toBeNull();
    expect(checkPriceUsd([])).toBeNull();
  });
  it('ignores the prices of other endpoints', () => {
    expect(checkPriceUsd([{ ...page, endpoint: 'dataforseo_labs/google/keyword_overview/live' }, task])).toBeNull();
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
  it('gives 333 keywords to a chunk of three countries, which is 999 items', () => {
    const keywords = Array.from({ length: 700 }, (_, index) => index);
    expect(chunkKeywords(keywords, 3).map((chunk) => chunk.length)).toEqual([333, 333, 34]);
  });
  it('fills a request to exactly 1,000 items and starts a new one after that', () => {
    const items = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
    expect(chunkKeywords(items(100), 10).map((chunk) => chunk.length)).toEqual([100]);
    expect(chunkKeywords(items(101), 10).map((chunk) => chunk.length)).toEqual([100, 1]);
    expect(chunkKeywords(items(1000), 1).map((chunk) => chunk.length)).toEqual([1000]);
    expect(chunkKeywords(items(1001), 1).map((chunk) => chunk.length)).toEqual([1000, 1]);
  });
  it('makes no chunk of no keywords', () => {
    expect(chunkKeywords([], 5)).toEqual([]);
  });
  it('allows ten countries at most', () => {
    expect(MAX_ADD_COUNTRIES).toBe(10);
  });
});
