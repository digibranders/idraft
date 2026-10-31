import { QueryClient, type InfiniteData } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { applyKeywordWrite } from './keyword-cache';
import {
  allListKey,
  countKey,
  keywordsKey,
  pageListKey,
  refreshKeywords,
  type KeywordFilters,
  type ListPage,
  type ListQuery,
} from './rankings-queries';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { TRACKED_KEYWORD_DETAIL, TRACKED_KEYWORD_ROW } from '@/test/api-shapes';
import { dataOf, mockBrowser } from '@/test/mock-api';
import type { TrackedKeywordDetail, TrackedKeywordRow } from '@/lib/api/types';

const [fynix] = MOCK_PROJECTS;
if (fynix === undefined) throw new Error('The Fynix project fixture is missing');
const SCOPE = { workspaceId: MOCK_WORKSPACE.workspace_id, projectId: fynix.project_id };
const TK = `/api/v1/workspaces/${SCOPE.workspaceId}/projects/${SCOPE.projectId}/tracked-keywords`;
const ACTIVE: KeywordFilters = { 'filter[is_active]': true };
const NO_MORE = { total: 3, has_more: false, next_cursor: null, limit: 200 } as const;

let rows: TrackedKeywordRow[] = [];
let detail: TrackedKeywordDetail;
let client: QueryClient;

beforeEach(async () => {
  const browser = mockBrowser('editor');
  rows = dataOf(
    await browser.call('GET', `${TK}?limit=30&include=metrics&include=groups&include=terms`),
    z.array(TRACKED_KEYWORD_ROW),
  );
  // The keyword written to is the first in a group, so a list of a group holds it
  const first = rows.find((row) => (row.groups ?? []).length > 0);
  if (first === undefined) throw new Error('No mock keyword is in a group');
  rows = [first, ...rows.filter((row) => row !== first).slice(0, 2)];
  detail = dataOf(await browser.call('GET', `${TK}/${first.tracked_keyword_id}`), TRACKED_KEYWORD_DETAIL);
  client = new QueryClient();
});

const pageOfRows = (list: readonly TrackedKeywordRow[]): ListPage => ({ data: [...list], page: NO_MORE });
const seedAll = (filters: KeywordFilters, list: readonly TrackedKeywordRow[] = rows): void => {
  client.setQueryData(allListKey(SCOPE, filters), { pages: [pageOfRows(list)], pageParams: [null] });
};
const readAll = (filters: KeywordFilters): InfiniteData<ListPage, string | null> | undefined =>
  client.getQueryData(allListKey(SCOPE, filters));
const invalidated = (filters: KeywordFilters): boolean =>
  client.getQueryState(allListKey(SCOPE, filters))?.isInvalidated === true;

describe('a write to one keyword reaches the lists in the cache', () => {
  it('replaces the row in place when no filter of the list looks at what changed', () => {
    seedAll(ACTIVE);
    const next: TrackedKeywordDetail = { ...detail, priority: detail.priority === 9 ? 8 : 9 };
    applyKeywordWrite(client, SCOPE, next);
    const row = readAll(ACTIVE)?.pages[0]?.data.find(
      (candidate) => candidate.tracked_keyword_id === detail.tracked_keyword_id,
    );
    expect(row?.priority).toBe(next.priority);
    // The other rows are the same objects as before
    expect(readAll(ACTIVE)?.pages[0]?.data[1]).toBe(rows[1]);
    expect(invalidated(ACTIVE)).toBe(false);
  });

  it('keeps what only the list carries: the row is the detail laid over it', () => {
    seedAll(ACTIVE);
    applyKeywordWrite(client, SCOPE, { ...detail, target_url: null });
    const row = readAll(ACTIVE)?.pages[0]?.data[0];
    expect(row?.target_url).toBeNull();
    expect(row?.keyword).toEqual(detail.keyword);
    expect(row).not.toHaveProperty('competitor_overrides');
    expect(row).not.toHaveProperty('config_history_count');
  });

  it('reads the list again when a filter of it depends on what changed', () => {
    const byPriority: KeywordFilters = { ...ACTIVE, 'filter[priority_lte]': 5 };
    seedAll(byPriority);
    applyKeywordWrite(client, SCOPE, { ...detail, priority: detail.priority === 9 ? 8 : 9 });
    expect(invalidated(byPriority)).toBe(true);
  });

  it('reads the list again when the keyword was archived, and the count with it', () => {
    seedAll(ACTIVE);
    client.setQueryData(countKey(SCOPE), { page: { total: 3 } });
    applyKeywordWrite(client, SCOPE, { ...detail, is_active: false });
    expect(invalidated(ACTIVE)).toBe(true);
    expect(client.getQueryState(countKey(SCOPE))?.isInvalidated).toBe(true);
  });

  it('reads a list again that does not hold the keyword, as it may match now', () => {
    const [, second, third] = rows;
    if (second === undefined || third === undefined) throw new Error('The mock list has too few rows');
    seedAll(ACTIVE, [second, third]);
    applyKeywordWrite(client, SCOPE, { ...detail, priority: 1 });
    expect(invalidated(ACTIVE)).toBe(true);
  });

  it('reads a list again when the group of the keyword changed and the list is of a group', () => {
    const group = detail.groups[0];
    if (group === undefined) throw new Error('The first mock keyword is in no group');
    const byGroup: KeywordFilters = { ...ACTIVE, 'filter[group]': group.group_id };
    seedAll(byGroup);
    applyKeywordWrite(client, SCOPE, { ...detail, groups: [] });
    expect(invalidated(byGroup)).toBe(true);
  });

  it('replaces the row on the page of server mode too, and reads a page again that depends on what changed', () => {
    const query: ListQuery = { ...ACTIVE, include: ['metrics', 'groups', 'terms'], limit: 200 };
    const byPriority: ListQuery = { ...query, 'filter[priority_lte]': 5 };
    client.setQueryData(pageListKey(SCOPE, ACTIVE, query), { offset: 0, page: pageOfRows(rows) });
    client.setQueryData(pageListKey(SCOPE, { ...ACTIVE, 'filter[priority_lte]': 5 }, byPriority), {
      offset: 0,
      page: pageOfRows(rows),
    });
    applyKeywordWrite(client, SCOPE, { ...detail, priority: detail.priority === 9 ? 8 : 9 });
    const patched = client.getQueryData<{ offset: number; page: ListPage }>(pageListKey(SCOPE, ACTIVE, query));
    expect(patched?.page.data[0]?.priority).not.toBe(rows[0]?.priority);
    expect(client.getQueryState(pageListKey(SCOPE, ACTIVE, query))?.isInvalidated).toBe(false);
    expect(
      client.getQueryState(pageListKey(SCOPE, { ...ACTIVE, 'filter[priority_lte]': 5 }, byPriority))?.isInvalidated,
    ).toBe(true);
  });

  it('invalidates strip count queries when write changes membership', async () => {
    const stripKey = [...keywordsKey(SCOPE), { ...ACTIVE, 'filter[priority_lte]': 8 }, 'strip', 'top3'];
    client.setQueryData(stripKey, 42);
    applyKeywordWrite(client, SCOPE, { ...detail, priority: detail.priority === 9 ? 8 : 9 });
    expect(client.getQueryState(stripKey)?.isInvalidated).toBe(true);

    await refreshKeywords(client, SCOPE);
    expect(client.getQueryState(stripKey)?.isInvalidated).toBe(true);
  });

  it('invalidates Top 10 strip count query after removing a keyword from the filtered group', () => {
    const group = detail.groups[0];
    if (group === undefined) throw new Error('The first mock keyword is in no group');
    const byGroup: KeywordFilters = { ...ACTIVE, 'filter[group]': group.group_id };
    seedAll(byGroup);
    const groupTop10Key = [...keywordsKey(SCOPE), byGroup, 'strip', 'top10'];
    client.setQueryData(groupTop10Key, 10);

    applyKeywordWrite(client, SCOPE, { ...detail, groups: [] });
    expect(client.getQueryState(groupTop10Key)?.isInvalidated).toBe(true);
  });
});
