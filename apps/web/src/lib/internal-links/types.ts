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
export type LinkGraph = Schemas['LinkGraph'];
export type GraphNode = Schemas['GraphNode'];
export type GraphEdge = Schemas['GraphEdge'];
export type TierStat = Schemas['TierStat'];
export type TierFlowCell = Schemas['TierFlowCell'];
export type Worklists = Schemas['Worklists'];
export type PageTier = Schemas['PageTier'];
export type TierRef = Schemas['TierRef'];
export type TierRuleView = Schemas['TierRuleView'];
export type TierRulePreview = Schemas['TierRulePreview'];
export type TierImportResult = Schemas['TierImportResult'];
export type PageFilter = Schemas['PageFilter'];
export type PageView = NonNullable<PageFilter['view']>;
export type PagesOverview = Schemas['PagesOverview'];
export type PageSearchDaily = Schemas['PageSearchDaily'];
export type PageAi = Schemas['PageAi'];
export type PageNote = Schemas['PageNote'];
export type PageNoteList = Schemas['PageNoteList'];
export type PageNoteMention = Schemas['PageNoteMention'];
export type PageNoteFile = Schemas['PageNoteFile'];
export type PageOutline = Schemas['PageOutline'];
export type PageOutlineBody = Schemas['PageOutlineBody'];
export type CrawlRun = Schemas['CrawlRun'];
export type CrawlRunPage = Schemas['CrawlRunPage'];
export type CrawlState = CrawlRun['state'];
export type CrawlTrigger = CrawlRun['trigger'];
export type InternalLinksSettings = Schemas['InternalLinksSettings'];
export type InternalLinksSettingsPatch = Schemas['InternalLinksSettingsPatch'];
export type CrawlSchedule = InternalLinksSettings['schedule'];

export type ChangesSummary = Schemas['ChangesSummary'];
export type ChangeAlert = Schemas['ChangeAlert'];
/** `pending` until the crawl's changes are worked out, `unavailable` when enrichment failed first. */
export type ChangesState = ChangesSummary['state'];
export type ChangeLink = Schemas['ChangeLink'];
export type ChangePage = Schemas['ChangePage'];
export type ChangeLinkPage = Schemas['ChangeLinkPage'];
export type MovedPage = Schemas['MovedPage'];
export type MovedPageList = Schemas['MovedPageList'];
export type PageChange = Schemas['PageChange'];
export type PageExtras = Schemas['PageExtras'];
export type PageDetailExtras = Schemas['PageDetailExtras'];
/** `pending` means the clicks are not in yet (null), `not_connected` that Search Console is not linked. */
export type GscState = Schemas['GscPage']['state'];
export type Opportunity = Schemas['Opportunity'];
export type OpportunityPage = Schemas['OpportunityPage'];
export type OpportunityPair = Schemas['OpportunityPair'];
export type OpportunityStatus = Opportunity['status'];
export type TierSuggestionRow = Schemas['TierSuggestionRow'];
export type TierSuggestionList = Schemas['TierSuggestionList'];
export type SuggestionSelection = Schemas['SuggestionSelection'];
/** `ok`: clicks were used with the ranks; otherwise only ranks were. */
export type SuggestionGscState = Schemas['TierSuggestionMeta']['gsc_state'];
/** `any` and `editorial` are null when the page is not reached in 12 clicks. */
export type Routes = Schemas['Routes'];
export type Route = Schemas['Route'];
export type RouteStep = Schemas['RouteStep'];
/** All members are required in the read; the patch (`InternalLinksSettingsPatch.alerts`) has them optional. */
export type AlertSettings = Schemas['AlertSettings'];
export type AlertSettingsPatch = Schemas['AlertSettingsPatch'];
export type ChangeKind = 'lost' | 'added';
export type ChangeScope = 'editorial' | 'all';
export type ChangeOnly = 'top' | 'all';
/** The parts of a page row the Pages tab can ask for (`include`). */
export type PageInclude = 'changes' | 'keywords' | 'citations' | 'anchors' | 'gsc';

/** The workspace and project every read is under. */
export interface LinksScope {
  workspaceId: string;
  projectId: string;
}

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'blocked';
export type PageFlagFilter =
  | 'orphan'
  | 'editorial_orphan'
  | 'deep_only_through_auto'
  | 'placement_unknown'
  | 'has_broken_outlinks'
  | 'generic_anchors'
  | 'variant';
export type PageWorklist =
  'under_linked_t1' | 'orphans' | 'editorial_orphans' | 'deep_only_through_auto' | 'lost_links_top' | 'weak_outlinks';
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
  | '-outlinks'
  | 'change'
  | '-change'
  | 'rank'
  | '-rank'
  | 'citations'
  | '-citations'
  | 'anchor'
  | '-anchor'
  | 'tier'
  | '-tier'
  | 'clicks'
  | '-clicks'
  | 'impressions'
  | '-impressions'
  | 'indexable'
  | '-indexable'
  | 'in_sitemap'
  | '-in_sitemap';

export type Share = Schemas['Share'];
export type CreatedShare = Schemas['CreatedShare'];
export type ShareState = Schemas['ShareState'];
export type ExpiryDays = Schemas['ExpiryDays'];
export type ClientSummary = Schemas['ClientSummary'];
