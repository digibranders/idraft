import { describe, expect, it, vi } from 'vitest';

import { ListChangedError, MAX_PAGE_SIZE, MAX_PAGES, readAllPages, type OffsetPage } from './pages';

/** A list served as the API pages it. */
const pageOf = (items: readonly number[], offset: number, limit: number): OffsetPage<number> => ({
  data: items.slice(offset, offset + limit),
  page: { total: items.length },
});

const numbers = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

const idOf = (item: number): string => String(item);

describe('readAllPages', () => {
  it('reads one page when the list fits in it, and nothing more for an empty list', async () => {
    const readPage = vi.fn((offset: number, limit: number) => Promise.resolve(pageOf(numbers(3), offset, limit)));
    await expect(readAllPages(readPage, idOf)).resolves.toEqual({ items: [0, 1, 2], total: 3 });
    expect(readPage.mock.calls).toEqual([[0, MAX_PAGE_SIZE]]);
    const empty = vi.fn((offset: number, limit: number) => Promise.resolve(pageOf([], offset, limit)));
    await expect(readAllPages(empty, idOf)).resolves.toEqual({ items: [], total: 0 });
    expect(empty).toHaveBeenCalledTimes(1);
  });

  it('reads page after page until the total, each one from the last item read', async () => {
    const list = numbers(MAX_PAGE_SIZE * 2 + 5);
    const readPage = vi.fn((offset: number, limit: number) => Promise.resolve(pageOf(list, offset, limit)));
    await expect(readAllPages(readPage, idOf)).resolves.toEqual({ items: list, total: list.length });
    expect(readPage.mock.calls).toEqual([
      [0, MAX_PAGE_SIZE],
      [MAX_PAGE_SIZE - 1, MAX_PAGE_SIZE],
      [MAX_PAGE_SIZE * 2 - 2, MAX_PAGE_SIZE],
    ]);
  });

  it('stops at a page with nothing new, even when the total says there is more', async () => {
    const readPage = vi.fn((offset: number) =>
      Promise.resolve({
        data: offset === 0 ? numbers(MAX_PAGE_SIZE) : [MAX_PAGE_SIZE - 1],
        page: { total: MAX_PAGE_SIZE * 3 },
      }),
    );
    await expect(readAllPages(readPage, idOf)).resolves.toEqual({
      items: numbers(MAX_PAGE_SIZE),
      total: MAX_PAGE_SIZE * 3,
    });
    expect(readPage).toHaveBeenCalledTimes(2);
  });

  it('reads at most MAX_PAGES pages', async () => {
    let next = 0;
    const readPage = vi.fn(() => {
      // Each page repeats the last item read, then one new item
      const data = next === 0 ? [next] : [next - 1, next];
      next += 1;
      return Promise.resolve({ data, page: { total: Number.MAX_SAFE_INTEGER } });
    });
    const { items } = await readAllPages(readPage, idOf);
    expect(items).toHaveLength(MAX_PAGES);
    expect(readPage).toHaveBeenCalledTimes(MAX_PAGES);
  });

  it('reads again from the start when an item was added between two pages', async () => {
    let list = numbers(MAX_PAGE_SIZE + 1);
    const readPage = vi.fn((offset: number, limit: number) => {
      const page = pageOf(list, offset, limit);
      // Someone joins at the top after the first page was read
      if (offset === 0 && list.length === MAX_PAGE_SIZE + 1) list = [-1, ...list];
      return Promise.resolve(page);
    });
    const { items, total } = await readAllPages(readPage, idOf);
    expect(items).toEqual([-1, ...numbers(MAX_PAGE_SIZE + 1)]);
    expect(total).toBe(MAX_PAGE_SIZE + 2);
  });

  it('notices one added and one removed between two pages, though the total is the same', async () => {
    let list = numbers(MAX_PAGE_SIZE + 10);
    let changed = false;
    const readPage = vi.fn((offset: number, limit: number) => {
      const page = pageOf(list, offset, limit);
      if (offset === 0 && !changed) {
        // The tenth item leaves and a new one arrives at the end: offsets after it move by one
        list = [...list.filter((item) => item !== 10), 999];
        changed = true;
      }
      return Promise.resolve(page);
    });
    const { items } = await readAllPages(readPage, idOf);
    expect(items).toEqual(list);
    expect(new Set(items).size).toBe(items.length);
    expect(readPage.mock.calls[2]).toEqual([0, MAX_PAGE_SIZE]);
  });

  it('rejects a list that changes on every reading rather than answer part of it', async () => {
    let size = MAX_PAGE_SIZE + 5;
    const readPage = vi.fn((offset: number, limit: number) => {
      const page = pageOf(numbers(size), offset, limit);
      size += 1;
      return Promise.resolve(page);
    });
    await expect(readAllPages(readPage, idOf)).rejects.toBeInstanceOf(ListChangedError);
    expect(readPage).toHaveBeenCalledTimes(6);
  });

  it('stops reading when a page fails, as when the request is cancelled', async () => {
    const list = numbers(MAX_PAGE_SIZE * 3);
    const readPage = vi.fn((offset: number, limit: number) =>
      offset === 0
        ? Promise.resolve(pageOf(list, offset, limit))
        : Promise.reject(new DOMException('The request was cancelled', 'AbortError')),
    );
    await expect(readAllPages(readPage, idOf)).rejects.toThrow('The request was cancelled');
    expect(readPage).toHaveBeenCalledTimes(2);
  });
});
