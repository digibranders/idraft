import type { Schemas } from '@/lib/api/types';

export type PageNumbers = Schemas['PageNumbers'];
export type PageHealth = Schemas['PageHealth'];
/** What the list answers about the period and the connection (`meta` of `GET fp/tracked-pages`). */
export type TrackedPagesMeta = Schemas['TrackedPagesMeta'];
/** What the detail answers about the period, the connection and the history (`meta` of `GET fp/page-search/{url_id}`). */
export type PageSearchMeta = Schemas['PageSearchMeta'];
export type SearchState = PageSearchMeta['state'];
export type TrackedPageRow = Schemas['TrackedPageRow'];
export type PageQueries = Schemas['PageQueries'];
/** Reserved: the API returns null on every row until the Cannibalization feature fills it (spec D22). */
export type PageCannibalization = Schemas['PageCannibalization'];
export type TrackOutcome = Schemas['TrackOutcome'];
export type TrackPagesAnswer = Schemas['TrackPagesResponse'];
export type SuggestionRow = Schemas['SuggestionRow'];
export type PageSearchDetail = Schemas['PageSearchData'];
export type SeriesPoint = Schemas['SeriesPoint'];
export type BreakdownRow = Schemas['BreakdownRow'];
export type SearchWindow = Schemas['SearchWindow'];
export type Verdict = PageHealth['verdict'];
export type BreakdownDimension = Schemas['BreakdownDimension'];
export type CompareParam = 'previous_period' | 'previous_year' | 'none';
export type MetricKey = 'clicks' | 'impressions' | 'ctr' | 'position';

export interface SearchScope {
  workspaceId: string;
  projectId: string;
}

/** The period and the comparison a read asks for; `from` and `to` left out means the last full month. */
export interface PeriodParams {
  from?: string;
  to?: string;
  compare: CompareParam;
}
