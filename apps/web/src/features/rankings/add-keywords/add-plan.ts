import type { components } from '@/lib/api/schema';

type Price = Pick<components['schemas']['Price'], 'endpoint' | 'price_unit' | 'conditions' | 'unit_price_usd'>;

/** The device choice of an add; `null` while the project default is not yet known. */
export type AddDevice = 'desktop' | 'mobile' | 'both';

/** Countries one add may name (docs/08 section 3.1.1): one request stays inside the batch limit. */
export const MAX_ADD_COUNTRIES = 10;
/** Items one `bulk-create` request takes (backend `BULK_CREATE_MAX`). */
export const BULK_CREATE_MAX_ITEMS = 1000;
/** Days a month is priced at. */
const DAYS_A_MONTH = 30;
/** The depth the estimate assumes: the deepest check, so the figure is an upper bound. */
const ESTIMATE_DEPTH = 100;
const PAGE_SIZE = 10;

export interface AddPlan {
  keywords: number;
  devices: 1 | 2;
  countries: number;
  /** Rank checks a day: keywords x devices x countries. */
  checksPerDay: number;
}

export function addPlan(input: { keywords: number; device: AddDevice | null; countries: number }): AddPlan {
  const devices = input.device === 'both' ? 2 : 1;
  return {
    keywords: input.keywords,
    devices,
    countries: input.countries,
    checksPerDay: input.keywords * devices * input.countries,
  };
}

export function costOf(checksPerDay: number, perCheckUsd: number | null): { day: number; month: number } | null {
  if (perCheckUsd === null) return null;
  const day = checksPerDay * perCheckUsd;
  return { day, month: day * DAYS_A_MONTH };
}

/** The cost of one depth-100 check on the standard queue with the asynchronous AI Overview, from the price book. */
export function checkPriceUsd(prices: readonly Price[]): number | null {
  const serp = prices.filter((price) => price.endpoint === 'serp/google/organic');
  const standard = (price: Price): boolean => price.conditions['queue'] === 'standard';
  const page = serp.find((price) => price.price_unit === 'page' && standard(price));
  const task = serp.find(
    (price) => price.price_unit === 'task' && standard(price) && price.conditions['async_ai_overview'] === true,
  );
  if (page === undefined || task === undefined) return null;
  return Math.ceil(ESTIMATE_DEPTH / PAGE_SIZE) * Number(page.unit_price_usd) + Number(task.unit_price_usd);
}

/** The keywords in groups, so each request's items (keywords x countries) stay within the request limit. */
export function chunkKeywords<T>(keywords: readonly T[], countries: number): T[][] {
  const size = Math.max(1, Math.floor(BULK_CREATE_MAX_ITEMS / Math.max(1, countries)));
  const chunks: T[][] = [];
  for (let at = 0; at < keywords.length; at += size) chunks.push(keywords.slice(at, at + size));
  return chunks;
}
