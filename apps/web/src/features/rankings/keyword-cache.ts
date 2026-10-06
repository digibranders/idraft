import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';

import { countKey, keywordsKey, type KeywordFilters, type ListPage, type ProjectScope } from './rankings-queries';
import type { TrackedKeywordDetail, TrackedKeywordRow } from '@/lib/api/types';

/**
 * Keeps the lists in the cache right after a write to one keyword, without reading them again. Reading
 * the whole list of client mode costs a request per 200 rows (up to 50), so a save in the inspector lays
 * the keyword it just read over its row instead. A list is read again only where the write can change
 * which keywords it holds: one of its filters looks at a value that changed, or the keyword is not in it.
 */

type AllData = InfiniteData<ListPage, string | null>;
interface PageData {
  offset: number;
  page: ListPage;
}

/** What each filter of the list looks at in a row: a filter is affected when this changes. */
const LOOKS_AT = {
  'filter[is_active]': (row) => row.is_active,
  'filter[group]': (row) => (row.groups ?? []).map((group) => group.group_id).sort(),
  'filter[term]': (row) => (row.terms ?? []).map((term) => term.term_id).sort(),
  'filter[term_in]': (row) => (row.terms ?? []).map((term) => term.term_id).sort(),
  'filter[device]': (row) => row.device,
  'filter[location_id]': (row) => row.location_id,
  'filter[language_code]': (row) => row.language_code,
  'filter[search_engine]': (row) => row.search_engine,
  'filter[intent_in]': (row) => row.intent,
  'filter[funnel_stage_in]': (row) => row.funnel_stage,
  'filter[priority_lte]': (row) => row.priority,
  'filter[source_in]': (row) => row.source,
  'filter[depth_profile_in]': (row) => row.depth_profile,
  'filter[search_volume_gte]': (row) => row.metrics?.search_volume ?? null,
  'filter[keyword_difficulty_lte]': (row) => row.metrics?.keyword_difficulty ?? null,
} satisfies Record<keyof KeywordFilters, (row: TrackedKeywordRow) => unknown>;

/** The filters whose answer for the row differs between `before` and `after`. */
function changedFilters(before: TrackedKeywordRow, after: TrackedKeywordRow): string[] {
  return Object.entries(LOOKS_AT)
    .filter(([, looksAt]) => JSON.stringify(looksAt(before)) !== JSON.stringify(looksAt(after)))
    .map(([name]) => name);
}

/** The row with what the keyword's detail says laid over it (the detail carries every field of a row). */
function rowFromDetail(row: TrackedKeywordRow, detail: TrackedKeywordDetail): TrackedKeywordRow {
  return {
    ...row,
    business_value: detail.business_value,
    config_version: detail.config_version,
    created_at: detail.created_at,
    created_by: detail.created_by,
    depth_profile: detail.depth_profile,
    device: detail.device,
    frequency: detail.frequency,
    funnel_stage: detail.funnel_stage,
    groups: detail.groups,
    intent: detail.intent,
    intent_source: detail.intent_source,
    is_active: detail.is_active,
    keyword: detail.keyword,
    language_code: detail.language_code,
    location: detail.location,
    location_id: detail.location_id,
    metrics: detail.metrics,
    os: detail.os,
    priority: detail.priority,
    project_id: detail.project_id,
    schedule_id: detail.schedule_id,
    search_engine: detail.search_engine,
    source: detail.source,
    target_url: detail.target_url,
    terms: detail.terms,
    updated_at: detail.updated_at,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The kind of list query a key is, with the filters it was read for; `null` for any other query. */
function listOf(key: QueryKey, prefix: number): { kind: 'all' | 'page'; filters: Record<string, unknown> } | null {
  const filters = key[prefix];
  const kind = key[prefix + 1];
  // The list's filters always carry `filter[is_active]` (keywordFilters), which no other query's key has
  if (!isRecord(filters) || !('filter[is_active]' in filters)) return null;
  if (kind === 'all' && key.length === prefix + 2) return { kind, filters };
  if (kind === 'page' && key.length === prefix + 3) return { kind, filters };
  return null;
}

const findIn = (pages: readonly ListPage[], id: string): TrackedKeywordRow | undefined => {
  for (const page of pages) {
    const row = page.data.find((candidate) => candidate.tracked_keyword_id === id);
    if (row !== undefined) return row;
  }
  return undefined;
};

const replaceIn = (pages: readonly ListPage[], id: string, next: TrackedKeywordRow): ListPage[] =>
  pages.map((page) =>
    page.data.some((row) => row.tracked_keyword_id === id)
      ? { ...page, data: page.data.map((row) => (row.tracked_keyword_id === id ? next : row)) }
      : page,
  );

/**
 * Applies the keyword as the API now has it (its detail, read after the write) to every list of the
 * project in the cache. A list that cannot take it in place is invalidated: it reads again if a screen
 * shows it, and otherwise on its next use.
 */
export function applyKeywordWrite(queryClient: QueryClient, scope: ProjectScope, detail: TrackedKeywordDetail): void {
  const prefix = keywordsKey(scope).length;
  const id = detail.tracked_keyword_id;
  let membershipChanged = false;
  for (const query of queryClient.getQueryCache().findAll({ queryKey: keywordsKey(scope) })) {
    const list = listOf(query.queryKey, prefix);
    if (list === null) continue;
    const pages =
      list.kind === 'all'
        ? queryClient.getQueryData<AllData>(query.queryKey)?.pages
        : [queryClient.getQueryData<PageData>(query.queryKey)?.page].filter((page) => page !== undefined);
    const before = pages === undefined ? undefined : findIn(pages, id);
    if (pages === undefined || before === undefined) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      continue;
    }
    const after = rowFromDetail(before, detail);
    const changed = changedFilters(before, after);
    if (changed.includes('filter[is_active]')) membershipChanged = true;
    if (changed.some((name) => name in list.filters)) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
      continue;
    }
    // The list keeps the age of its data: the rows this write did not touch are no fresher than they were
    const options = { updatedAt: query.state.dataUpdatedAt };
    if (list.kind === 'all') {
      queryClient.setQueryData<AllData>(
        query.queryKey,
        (data) => (data === undefined ? data : { ...data, pages: replaceIn(data.pages, id, after) }),
        options,
      );
    } else {
      queryClient.setQueryData<PageData>(
        query.queryKey,
        (data) => (data === undefined ? data : { ...data, page: replaceIn([data.page], id, after)[0] ?? data.page }),
        options,
      );
    }
  }
  if (membershipChanged) void queryClient.invalidateQueries({ queryKey: countKey(scope), exact: true });
}
