import type { Schemas } from '@/lib/api/types';

/**
 * The internal links types of the generated client (the backend OpenAPI), under their API names. Import from
 * here, so a rename in the OpenAPI document breaks one file.
 */
export type PageRow = Schemas['PageRow'];
export type PageRowPage = Schemas['PageRowPage'];
export type PageDetail = Schemas['PageDetail'];
export type EdgeRow = Schemas['EdgeRow'];
export type EdgeRowPage = Schemas['EdgeRowPage'];
export type Neighbor = Schemas['Neighbor'];
export type NeighborList = Schemas['NeighborList'];
export type TierFlow = Schemas['TierFlow'];
export type TierStat = Schemas['TierStat'];
export type TierFlowCell = Schemas['TierFlowCell'];
export type Worklists = Schemas['Worklists'];
export type PageTier = Schemas['PageTier'];
export type TierRef = Schemas['TierRef'];
export type TierRuleView = Schemas['TierRuleView'];
export type TierImportResult = Schemas['TierImportResult'];
export type PageFilter = Schemas['PageFilter'];
export type CrawlRun = Schemas['CrawlRun'];
export type CrawlRunPage = Schemas['CrawlRunPage'];
export type CrawlState = CrawlRun['state'];
export type CrawlTrigger = CrawlRun['trigger'];
export type InternalLinksSettings = Schemas['InternalLinksSettings'];
export type InternalLinksSettingsPatch = Schemas['InternalLinksSettingsPatch'];
export type CrawlSchedule = InternalLinksSettings['schedule'];

/** The workspace and project every read is under. */
export interface LinksScope {
  workspaceId: string;
  projectId: string;
}

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export type PageFlagFilter =
  'orphan' | 'editorial_orphan' | 'deep_only_through_auto' | 'placement_unknown' | 'has_broken_outlinks';
export type PageWorklist = 'under_linked_t1' | 'orphans' | 'editorial_orphans' | 'deep_only_through_auto';
export type EdgeWorklist = 'broken_and_redirected' | 'links_to_non_indexable';
/** The sorts the Pages tab offers; `equity_share` is never sent (decision W4). */
export type PageSort =
  | 'path'
  | '-path'
  | 'status_code'
  | '-status_code'
  | 'click_depth'
  | '-click_depth'
  | 'linking_pages'
  | '-linking_pages'
  | 'outlinks'
  | '-outlinks';
