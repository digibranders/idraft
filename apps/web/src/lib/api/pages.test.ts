import { describe, expect, it, vi } from 'vitest';

import { MAX_PAGE_SIZE, MAX_PAGES, readAllPages, type OffsetPage } from './pages';

/** A list of `total` numbered items, served as the API pages it. */
const listOf =
  (items: readonly number[]) =>
  (offset: number, limit: number): Promise<OffsetPage<number>> =>
    Promise.resolve({ data: items.slice(offset, offset + limit), page: { total: items.length } });

const numbers = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

describe('readAllPages', () => {
  it('reads one page when the list fits in it', async () => {
    const readPage = vi.fn(listOf(numbers(3)));
    await expect(readAllPages(readPage)).resolves.toEqual({ items: [0, 1, 2], total: 3 });
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage).toHaveBeenCalledWith(0, MAX_PAGE_SIZE);
  });

  it('reads page after page until the total', async () => {
    const readPage = vi.fn(listOf(numbers(MAX_PAGE_SIZE * 2 + 5)));
    const { items, total } = await readAllPages(readPage);
    expect(items).toEqual(numbers(MAX_PAGE_SIZE * 2 + 5));
    expect(total).toBe(MAX_PAGE_SIZE * 2 + 5);
    expect(readPage.mock.calls).toEqual([
      [0, MAX_PAGE_SIZE],
      [MAX_PAGE_SIZE, MAX_PAGE_SIZE],
      [MAX_PAGE_SIZE * 2, MAX_PAGE_SIZE],
    ]);
  });

  it('stops at an empty page, even when the total says there is more', async () => {
    const readPage = vi.fn((offset: number) =>
      Promise.resolve({ data: offset === 0 ? numbers(MAX_PAGE_SIZE) : [], page: { total: MAX_PAGE_SIZE * 3 } }),
    );
    await expect(readAllPages(readPage)).resolves.toEqual({ items: numbers(MAX_PAGE_SIZE), total: MAX_PAGE_SIZE * 3 });
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('reads at most MAX_PAGES pages', async () => {
    const readPage = vi.fn(() => Promise.resolve({ data: [1], page: { total: Number.MAX_SAFE_INTEGER } }));
    const { items } = await readAllPages(readPage);
    expect(items).toHaveLength(MAX_PAGES);
    expect(readPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('reads the list again from the start when it changed between two pages', async () => {
    let list = numbers(MAX_PAGE_SIZE + 1);
    const readPage = vi.fn(async (offset: number, limit: number) => {
      const page = await listOf(list)(offset, limit);
      // Someone joins after the first page was read
      if (offset === 0 && list.length === MAX_PAGE_SIZE + 1) list = [-1, ...list];
      return page;
    });
    const { items, total } = await readAllPages(readPage);
    expect(items).toEqual([-1, ...numbers(MAX_PAGE_SIZE + 1)]);
    expect(total).toBe(MAX_PAGE_SIZE + 2);
    expect(new Set(items).size).toBe(items.length);
  });
});
