import { issueCheckIdValues } from '@/lib/api/schema';
import type { Schemas } from '@/lib/api/types';

/**
 * The Issues types of the generated client (the backend OpenAPI), under their API names. Import from here, so a
 * rename in the OpenAPI document breaks one file.
 */
export type IssueCheck = Schemas['IssueCheck'];
export type IssueSummary = Schemas['IssueSummary'];
export type IssueMeta = Schemas['IssueMeta'];
export type IssueGsc = Schemas['IssueGsc'];
export type IssueDetail = Schemas['IssueDetail'];
export type IssueListResponse = Schemas['IssueListResponse'];
export type CheckId = IssueCheck['id'];
export type Severity = IssueCheck['severity'];
export type FoundBy = IssueCheck['found_by'];
/** The tab as the API writes it (`on_page`). The address writes `on-page`: see `tabOfApi`. */
export type ApiTab = IssueCheck['tab'];
export type NotRunReason = NonNullable<IssueCheck['reason']>;

const CHECK_IDS: ReadonlySet<string> = new Set(issueCheckIdValues);

export const isCheckId = (value: string | null | undefined): value is CheckId =>
  value !== null && value !== undefined && CHECK_IDS.has(value);

/**
 * The categories slice 1 returns. The API types a category as a string, so a later slice may add one: the
 * words of a category the web does not know are looked up with `idKey` and fall back to the id.
 */
export const CATEGORY_IDS = [
  'status',
  'earning_pages',
  'redirects',
  'indexing',
  'sitemap',
  'links',
  'titles',
  'addresses',
  'keywords',
] as const;

/**
 * The key of an id in `messages/en.json`. Message keys are camelCase, and ids are not (`status-4xx`,
 * `earning_pages`), so `title-long` is `titleLong` and `earning_pages` is `earningPages`.
 */
export const idKey = (id: string): string =>
  id.replace(/[-_]([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
