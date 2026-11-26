import type { PageSort } from '@/lib/internal-links/types';
import { isCheckId, type ApiTab, type CheckId, type IssueCheck } from './types';

/**
 * What the Issues page keeps in its address (spec 7.1). The page inspector's own keys (`inspect`, `itab`) are
 * not here: they belong to the inspector. `parseIssuesSearch` is pure; the hook that reads and writes the
 * address lives with the screen.
 */

export type IssuesTab = 'technical' | 'on-page';
export type IssuesSeverity = 'all' | 'error' | 'warning' | 'notice';
export type IssuesFoundBy = 'all' | 'crawl' | 'ranks' | 'gsc' | 'ai';

export interface IssuesState {
  tab: IssuesTab;
  /** The open check, or `null` for the list. */
  check: CheckId | null;
  severity: IssuesSeverity;
  by: IssuesFoundBy;
  /** The search text as typed, up to 200 characters: the screens trim it when they use it. */
  q: string;
  showPassed: boolean;
  /** The sort of the pages of the open check; `null` is the default, which the open check decides. */
  sort: PageSort | null;
}

export type IssuesSearch = Readonly<Record<string, string | null | undefined>>;

/** The longest search text the API takes, in code points (an emoji is one, not two). */
const MAX_SEARCH_LENGTH = 200;
const SEVERITIES: readonly IssuesSeverity[] = ['error', 'warning', 'notice'];
const FOUND_BY: readonly IssuesFoundBy[] = ['crawl', 'ranks', 'gsc', 'ai'];
// One entry per sort of the pages list the web sends, so a new sort in the type fails here until it is listed
const PAGE_SORTS: Readonly<Record<PageSort, true>> = {
  path: true,
  '-path': true,
  status_code: true,
  '-status_code': true,
  click_depth: true,
  '-click_depth': true,
  linking_pages: true,
  '-linking_pages': true,
  outlinks: true,
  '-outlinks': true,
  change: true,
  '-change': true,
  rank: true,
  '-rank': true,
  citations: true,
  '-citations': true,
  anchor: true,
  '-anchor': true,
  tier: true,
  '-tier': true,
  clicks: true,
  '-clicks': true,
  indexable: true,
  '-indexable': true,
  in_sitemap: true,
  '-in_sitemap': true,
};

const isPageSort = (value: string | null | undefined): value is PageSort =>
  value !== null && value !== undefined && Object.hasOwn(PAGE_SORTS, value);

/** The tab of the API (`on_page`) as the address writes it (`on-page`). */
export const tabOfApi = (tab: ApiTab): IssuesTab => (tab === 'on_page' ? 'on-page' : 'technical');

/**
 * The state of an address. A `check` that belongs to the other tab switches the tab to its own, which needs the
 * list of checks to know; without it the tab stays as the address says. An unknown value is the default.
 */
export function parseIssuesSearch(search: IssuesSearch, checks: readonly IssueCheck[] = []): IssuesState {
  const check = isCheckId(search.check) ? search.check : null;
  const opened = check === null ? undefined : checks.find((candidate) => candidate.id === check);
  return {
    tab: opened === undefined ? (search.tab === 'on-page' ? 'on-page' : 'technical') : tabOfApi(opened.tab),
    check,
    severity: SEVERITIES.find((severity) => severity === search.severity) ?? 'all',
    by: FOUND_BY.find((found) => found === search.by) ?? 'all',
    q: Array.from(search.q ?? '')
      .slice(0, MAX_SEARCH_LENGTH)
      .join(''),
    showPassed: search.passed !== 'hide',
    sort: isPageSort(search.sort) ? search.sort : null,
  };
}
