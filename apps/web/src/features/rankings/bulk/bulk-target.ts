import type { KeywordFilters, ListQuery } from '../rankings-queries';
import type { ApiInit } from '@/lib/api/query';
import type { TrackedKeywordRow } from '@/lib/api/types';
import { queryTextOf } from '@/lib/keywords/query-text';

export const BULK_UPDATE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-update';
export const BULK_ARCHIVE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-archive';
export const BULK_DELETE = '/api/v1/workspaces/{workspace_id}/projects/{project_id}/tracked-keywords/bulk-delete';
type BulkUpdateBody = NonNullable<ApiInit<'post', typeof BULK_UPDATE>['body']>;
/** The list's filters as a body: what a bulk change selects by when every matching keyword is chosen. */
export type BodyFilter = NonNullable<BulkUpdateBody['filter']>;

/** What a bulk action applies to: the chosen keywords by id, or every keyword the filters match. */
export type BulkTarget = { ids: string[] } | { filter: BodyFilter };

/** A member of the body only when the list's query has it. */
const given = <K extends string, V>(name: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [name]: value }) as { [P in K]?: V };

/**
 * The list's query filters as the body filter of a bulk change (`TrackedKeywordFilter`): the same names
 * without the brackets, with the search as `q`. `is_active` always goes along, so a change never reaches
 * the archived keywords the list does not show (a body filter without it takes both).
 */
export function bodyFilterOf(filters: KeywordFilters, search: string): BodyFilter {
  const q = queryTextOf(search);
  return {
    is_active: filters['filter[is_active]'] ?? true,
    ...given('group', filters['filter[group]']),
    ...given('term', filters['filter[term]']),
    ...given('device', filters['filter[device]']),
    ...given('location_id', filters['filter[location_id]']),
    ...given('language_code', filters['filter[language_code]']),
    ...given('intent_in', filters['filter[intent_in]']),
    ...given('funnel_stage_in', filters['filter[funnel_stage_in]']),
    ...given('source_in', filters['filter[source_in]']),
    ...given('depth_profile_in', filters['filter[depth_profile_in]']),
    ...given('priority_lte', filters['filter[priority_lte]']),
    ...given('search_volume_gte', filters['filter[search_volume_gte]']),
    ...given('keyword_difficulty_lte', filters['filter[keyword_difficulty_lte]']),
    ...given('rank_gte', filters['filter[rank_gte]']),
    ...given('rank_lte', filters['filter[rank_lte]']),
    ...given('rank_is_null', filters['filter[rank_is_null]']),
    ...given('rank_change_label_in', filters['filter[rank_change_label_in]']),
    ...given('improved', filters['filter[improved]']),
    ...given('declined', filters['filter[declined]']),
    ...given('is_stale', filters['filter[is_stale]']),
    ...given('feature_present', filters['filter[feature_present]']),
    ...given('feature_owned', filters['filter[feature_owned]']),
    ...given('aio_state', filters['filter[aio_state]']),
    ...(q === '' ? {} : { q }),
  };
}

/**
 * The list read that counts what a body filter will match: the list's filters and its search, one row. A rank
 * filter matches what the latest check says, and a check runs every day, so what a person chose and what the
 * API matches when the action arrives can differ: the screen counts again just before it acts.
 */
export function matchCountQuery(filters: KeywordFilters, search: string): ListQuery {
  const q = queryTextOf(search);
  return { ...filters, ...(q === '' ? {} : { 'filter[q]': q }), limit: 1 };
}

/** The API takes this many ids in one bulk request. */
export const MAX_IDS = 5000;
/** The groups and terms one change may gain or lose in all, the rows chosen times the links (backend `LINK_CHANGES_MAX`). */
export const LINK_CHANGES_MAX = 200_000;

/**
 * The ids one request may name when each keyword gains or loses `links` groups and terms: 5,000, and fewer
 * as the links grow, so that ids times links stay within 200,000. A link counts for every keyword chosen,
 * whether or not the keyword has it, so naming fewer groups is what keeps the batches large.
 */
export const batchSizeFor = (links: number): number =>
  links <= 0 ? MAX_IDS : Math.max(1, Math.min(MAX_IDS, Math.floor(LINK_CHANGES_MAX / links)));

/**
 * The groups the keywords of a target are in, so that a move names only those to leave; `null` when that is
 * not known and every group must be named. Ids are known when each is among `rows` with its groups read; a
 * filter's matches are known only when `rows` is the whole list (`complete`), and then they are all of them
 * or fewer (the search narrows the match, never widens it).
 */
export function groupsHeldBy(
  target: BulkTarget,
  rows: readonly Pick<TrackedKeywordRow, 'tracked_keyword_id' | 'groups'>[],
  complete: boolean,
): ReadonlySet<string> | null {
  const held = new Set<string>();
  if ('filter' in target) {
    if (!complete) return null;
    for (const row of rows) {
      if (row.groups === undefined || row.groups === null) return null;
      for (const group of row.groups) held.add(group.group_id);
    }
    return held;
  }
  const byId = new Map(rows.map((row) => [row.tracked_keyword_id, row]));
  for (const id of target.ids) {
    const groups = byId.get(id)?.groups;
    if (groups === undefined || groups === null) return null;
    for (const group of groups) held.add(group.group_id);
  }
  return held;
}

/**
 * The requests a target takes: a filter in one, ids in groups of 5,000 (client mode holds up to 10,000
 * keywords, so the header checkbox can choose more than one request takes).
 */
export function targetBatches(target: BulkTarget, size: number = MAX_IDS): BulkTarget[] {
  if (!('ids' in target)) return [target];
  const batches: BulkTarget[] = [];
  for (let at = 0; at < target.ids.length; at += size) batches.push({ ids: target.ids.slice(at, at + size) });
  return batches;
}

/** The target of an action on the chosen ids, or on every keyword the filters match. */
export function bulkTarget(
  scope: { ids: ReadonlySet<string>; allMatching: boolean },
  filters: KeywordFilters,
  search: string,
): BulkTarget {
  return scope.allMatching ? { filter: bodyFilterOf(filters, search) } : { ids: [...scope.ids] };
}
