import type { KeywordFilters } from '../rankings-queries';
import type { ApiInit } from '@/lib/api/query';

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
  const q = search.trim();
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
    ...(q === '' ? {} : { q }),
  };
}

/** The API takes this many ids in one bulk request. */
export const MAX_IDS = 5000;

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
