import { isPageRowPage } from '@/lib/internal-links/queries';
import type { PageRowPage } from '@/lib/internal-links/types';

/** The pages answer as a page of rows (its generated type is `unknown`, see `isPageRowPage`): anything else is a failed read. */
export function readPageRows(data: unknown): PageRowPage {
  if (isPageRowPage(data)) return data;
  throw new Error('The pages answer is not a page of rows');
}
