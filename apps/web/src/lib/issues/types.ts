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
  'security',
  'languages',
  'speed',
  'titles',
  'descriptions',
  'headings',
  'content',
  'images',
  'structured_data',
  'social_tags',
  'addresses',
  'keywords',
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

const CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_IDS);

export const isCategoryId = (value: string): value is CategoryId => CATEGORIES.has(value);

/** `title-long` as the type of its message key, `titleLong`, so a key built from an id is checked against the catalog. */
type CamelKey<Id extends string> = Id extends `${infer Head}-${infer Rest}`
  ? `${Head}${Capitalize<CamelKey<Rest>>}`
  : Id extends `${infer Head}_${infer Rest}`
    ? `${Head}${Capitalize<CamelKey<Rest>>}`
    : Id;

/**
 * The key of an id in `messages/en.json`. Message keys are camelCase, and ids are not (`status-4xx`,
 * `earning_pages`), so `title-long` is `titleLong` and `earning_pages` is `earningPages`. The type says the same, so
 * `t(`checks.${idKey(id)}.name`)` fails to compile when a check has no words; `messages.test.ts` checks the runtime.
 */
export const idKey = <Id extends string>(id: Id): CamelKey<Id> =>
  id.replace(/[-_]([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase()) as CamelKey<Id>;
