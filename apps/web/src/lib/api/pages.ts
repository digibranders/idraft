/** The most the API gives in one page (19-api-specification.md section 2.5, `limit`). */
export const MAX_PAGE_SIZE = 200;
/** A bound on the pages read, so an API that kept answering could not keep a screen or a render waiting. */
export const MAX_PAGES = 50;
/** How many times a list that changed while it was read is read again from the start. */
const MAX_RESTARTS = 2;

/** One page of a list the API pages by offset: its items and the size of the whole list. */
export interface OffsetPage<Item> {
  data: readonly Item[];
  page: { total: number };
}

/** Reads the page of `limit` items from `offset`. */
export type ReadPage<Item> = (offset: number, limit: number) => Promise<OffsetPage<Item>>;

interface Reading<Item> {
  items: Item[];
  total: number;
  /** The list's `total` moved between two pages, so its offsets moved too. */
  changed: boolean;
}

async function readOnce<Item>(readPage: ReadPage<Item>): Promise<Reading<Item>> {
  const items: Item[] = [];
  let total: number | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const { data, page } = await readPage(index * MAX_PAGE_SIZE, MAX_PAGE_SIZE);
    if (total !== null && page.total !== total) return { items, total: page.total, changed: true };
    total = page.total;
    items.push(...data);
    if (data.length === 0 || items.length >= total) break;
  }
  return { items, total: total ?? items.length, changed: false };
}

/**
 * Every item of a list the API pages by offset, read page by page until its `total`, at most
 * `MAX_PAGES` pages. An item added or removed between two reads moves the offsets, which would repeat or
 * skip an item; it also changes `total`, so the list is then read again from the start.
 */
export async function readAllPages<Item>(readPage: ReadPage<Item>): Promise<{ items: Item[]; total: number }> {
  let reading = await readOnce(readPage);
  for (let restart = 0; reading.changed && restart < MAX_RESTARTS; restart += 1) {
    reading = await readOnce(readPage);
  }
  return { items: reading.items, total: reading.total };
}
