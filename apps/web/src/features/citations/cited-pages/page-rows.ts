import type { Owner } from '../board-state';
import type { BoardSort } from '@/components/app/table/board-table';
import type { CitedPageRow, CitedPagesSort, DomainRole } from '@/lib/citations/board-queries';
import { displayDomain, displayUrl } from '@/lib/format';

/** Citations descending; a header click sorts descending, a second click ascending (C 32, C 351). */
export const PAGE_SORT_DEFAULT: BoardSort = { key: 'citations', dir: 'desc' };

type ApiKey = 'citations' | 'change' | 'prompts' | 'last_cited' | 'page';

const API_KEYS: Readonly<Record<string, ApiKey>> = {
  citations: 'citations',
  change: 'change',
  prompts: 'prompts',
  last: 'last_cited',
  page: 'page',
};

/** The API's `sort` for a header sort; ties are the API's: most citations, then the address (C 455). */
export function apiSort(sort: BoardSort): CitedPagesSort {
  const key = API_KEYS[sort.key] ?? 'citations';
  if (sort.dir === 'asc') return key;
  return `-${key}`;
}

/** The API's role for the owner filter; `null` for All. */
export const ownerRole = (owner: Owner): DomainRole | null =>
  owner === 'all' ? null : owner === 'third' ? 'third_party' : owner;

/** The address as the table writes it (C 479 to 481): the host, the path, and both without the scheme. */
export function pageText(row: CitedPageRow): { host: string; path: string; display: string } {
  return { host: displayDomain(row.host), path: row.path, display: displayUrl(row.url).display };
}
