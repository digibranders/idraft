import type { KeywordFilters } from './rankings-queries';
import type { FilterValues } from '@/components/app/filters/types';
import { RANK_BUCKETS } from '@/lib/format';
import { FEATURE_TYPES, OWNABLE_FEATURE_TYPES } from '@/lib/keywords/serp-features';

/**
 * The Rank, Change and Stale chips (13-filters-search.md sections 4 and 5, 24-page-templates.md section 9.3)
 * and the API parameters each choice stands for (`backend/src/idraft/api/keywords/filters.py`). The API
 * filters by one range of places (`rank_gte` and `rank_lte`) and the filters join with AND, so each chip is a
 * single choice: several buckets at once cannot be asked for. A keyword never checked matches none of them.
 */

/** The ids of the Rank chip: the buckets of `RANK_BUCKETS`, and the keywords checked but not found. */
export const RANK_CHOICES = ['top3', 'top10', 'top20', 'top50', 'top100', 'beyond'] as const;
/** The ids of the Change chip: `entered` is the API's `new` label. */
export const CHANGE_CHOICES = ['improved', 'declined', 'entered', 'lost'] as const;
export const STALE_CHOICES = ['stale'] as const;

export type RankChoice = (typeof RANK_CHOICES)[number];
export type ChangeChoice = (typeof CHANGE_CHOICES)[number];

/** The parameters of the three chips. */
export type RankFilterParams = Pick<
  KeywordFilters,
  | 'filter[rank_gte]'
  | 'filter[rank_lte]'
  | 'filter[rank_is_null]'
  | 'filter[rank_change_label_in]'
  | 'filter[improved]'
  | 'filter[declined]'
  | 'filter[is_stale]'
  | 'filter[feature_present]'
  | 'filter[feature_owned]'
>;

/** The one value a single choice chip holds, if it is one of `allowed`. */
function choiceOf<T extends string>(values: FilterValues, id: string, allowed: readonly T[]): T | undefined {
  const value = values[id];
  if (value?.kind !== 'enum') return undefined;
  const [first] = value.values;
  return allowed.find((candidate) => candidate === first);
}

/** The API's parameters for the chips' values: only those that are set, never an empty value. */
export function rankFilterParams(values: FilterValues): RankFilterParams {
  const rank = choiceOf(values, 'rank', RANK_CHOICES);
  const change = choiceOf(values, 'chg', CHANGE_CHOICES);
  const stale = choiceOf(values, 'stale', STALE_CHOICES);
  const params: RankFilterParams = {};
  if (rank === 'beyond') {
    params['filter[rank_is_null]'] = true;
  } else if (rank !== undefined) {
    const bucket = RANK_BUCKETS.find((candidate) => candidate.id === rank);
    if (bucket !== undefined) {
      params['filter[rank_gte]'] = bucket.min;
      params['filter[rank_lte]'] = bucket.max;
    }
  }
  if (change === 'improved') params['filter[improved]'] = true;
  if (change === 'declined') params['filter[declined]'] = true;
  if (change === 'entered') params['filter[rank_change_label_in]'] = ['new'];
  if (change === 'lost') params['filter[rank_change_label_in]'] = ['lost'];
  if (stale === 'stale') params['filter[is_stale]'] = true;
  const feature = choiceOf(values, 'feat', FEATURE_TYPES);
  const ownedFeature = choiceOf(values, 'featown', OWNABLE_FEATURE_TYPES);
  if (feature !== undefined) params['filter[feature_present]'] = feature;
  if (ownedFeature !== undefined) params['filter[feature_owned]'] = ownedFeature;
  return params;
}
