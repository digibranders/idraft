/** The most the API gives in one page (19-api-specification.md section 2.5, `limit`). */
export const MAX_PAGE_SIZE = 200;
/**
 * A bound on the pages read, so an API that kept answering could not keep a screen or a render waiting.
 * With one item of overlap, these pages hold 9,951 items; a longer list is refused, not cut.
 */
export const MAX_PAGES = 50;
/** How many readings a list gets in all before a list that keeps changing is refused. */
const MAX_READINGS = 3;

/** One page of a list the API pages by offset: its items and the size of the whole list. */
export interface OffsetPage<Item> {
  data: readonly Item[];
  page: { total: number };
}

/** Reads the page of `limit` items from `offset`; `first` when it starts a reading of the list. */
export type ReadPage<Item> = (offset: number, limit: number, first: boolean) => Promise<OffsetPage<Item>>;

/** The list changed on every reading, so no reading of it is whole. */
export class ListChangedError extends Error {
  constructor() {
    super(`The list changed while it was read, ${String(MAX_READINGS)} times in a row`);
    this.name = 'ListChangedError';
  }
}

/** The list is longer than `MAX_PAGES` pages hold, so it cannot be read whole. */
export class ListTooLongError extends Error {
  constructor(total: number) {
    super(`The list has ${String(total)} items, more than ${String(MAX_PAGES)} pages hold`);
    this.name = 'ListTooLongError';
  }
}

type Reading<Item> = { items: Item[]; total: number } | 'changed';

async function readOnce<Item>(readPage: ReadPage<Item>, idOf: (item: Item) => string): Promise<Reading<Item>> {
  const items: Item[] = [];
  let total: number | null = null;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const last = items.at(-1);
    // Each page after the first starts at the last item read, which must still be there
    const { data, page } = await readPage(last === undefined ? 0 : items.length - 1, MAX_PAGE_SIZE, index === 0);
    if (total !== null && page.total !== total) return 'changed';
    total = page.total;
    let fresh = data;
    if (last !== undefined) {
      const [overlap, ...rest] = data;
      if (overlap === undefined || idOf(overlap) !== idOf(last)) return 'changed';
      fresh = rest;
    }
    items.push(...fresh);
    if (items.length >= total) return { items, total };
    // A page with nothing new while `total` says there is more: the list and its count disagree
    if (fresh.length === 0) return 'changed';
  }
  if (total === null) throw new Error('No page was read');
  throw new ListTooLongError(total);
}

/**
 * Every item of a list the API pages by offset, read page by page until its `total`. An item added or
 * removed between two reads moves the offsets, which would repeat or skip an item. So each page after the
 * first starts one item early, and that item (by `idOf`) must be the last one read; when it is not, when
 * `total` moved, or when a page brings nothing new before `total` is reached, the list is read again from
 * the start. After three readings that each changed it rejects with `ListChangedError`, and a list longer
 * than `MAX_PAGES` pages hold rejects with `ListTooLongError`: never part of a list.
 */
export async function readAllPages<Item>(
  readPage: ReadPage<Item>,
  idOf: (item: Item) => string,
): Promise<{ items: Item[]; total: number }> {
  for (let reading = 0; reading < MAX_READINGS; reading += 1) {
    const result = await readOnce(readPage, idOf);
    if (result !== 'changed') return result;
  }
  throw new ListChangedError();
}
