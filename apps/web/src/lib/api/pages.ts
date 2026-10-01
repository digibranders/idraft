/** The most the API gives in one page (19-api-specification.md section 2.5, `limit`). */
export const MAX_PAGE_SIZE = 200;
/**
 * A bound on the pages read, so an API that kept answering could not keep a screen or a render waiting.
 * A list longer than these pages hold (about 10,000 items) is cut, with `total` still the whole list's.
 */
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

/** The list changed on every reading, so no reading of it is whole. */
export class ListChangedError extends Error {
  constructor() {
    super(`The list changed while it was read, ${String(MAX_RESTARTS + 1)} times in a row`);
    this.name = 'ListChangedError';
  }
}

type Reading<Item> = { items: Item[]; total: number } | 'changed';

async function readOnce<Item>(readPage: ReadPage<Item>, idOf: (item: Item) => string): Promise<Reading<Item>> {
  const items: Item[] = [];
  let total: number | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const last = items.at(-1);
    // Each page after the first starts at the last item read, which must still be there
    const { data, page } = await readPage(last === undefined ? 0 : items.length - 1, MAX_PAGE_SIZE);
    if (total !== null && page.total !== total) return 'changed';
    total = page.total;
    let fresh = data;
    if (last !== undefined) {
      const [overlap, ...rest] = data;
      if (overlap === undefined || idOf(overlap) !== idOf(last)) return 'changed';
      fresh = rest;
    }
    items.push(...fresh);
    if (fresh.length === 0 || items.length >= total) break;
  }
  return { items, total: total ?? items.length };
}

/**
 * Every item of a list the API pages by offset, read page by page until its `total`, at most `MAX_PAGES`
 * pages. An item added or removed between two reads moves the offsets, which would repeat or skip an item.
 * So each page after the first starts one item early, and that item (by `idOf`) must be the last one read;
 * when it is not, or `total` moved, the list is read again from the start. A list that keeps changing
 * rejects with `ListChangedError` rather than answering part of it.
 */
export async function readAllPages<Item>(
  readPage: ReadPage<Item>,
  idOf: (item: Item) => string,
): Promise<{ items: Item[]; total: number }> {
  for (let attempt = 0; attempt <= MAX_RESTARTS; attempt += 1) {
    const reading = await readOnce(readPage, idOf);
    if (reading !== 'changed') return reading;
  }
  throw new ListChangedError();
}
