/**
 * The generated component schemas the app names, under their API names. Import from here, not from
 * ./schema, so a rename in the OpenAPI document breaks one file.
 */
import type { components } from './schema';

export type Schemas = components['schemas'];

export type Me = Schemas['Me'];
export type MeMembership = Schemas['MeMembership'];
export type Role = Schemas['Role'];
export type Problem = Schemas['Problem'];
export type ValidationItem = Schemas['ValidationItem'];
export type SessionItem = Schemas['SessionItem'];
export type Project = Schemas['Project'];
export type Workspace = Schemas['Workspace'];
export type Member = Schemas['Member'];
export type Invitation = Schemas['Invitation'];
export type DomainRef = Schemas['DomainRef'];
export type Entity = Schemas['Entity'];
export type EntityDetail = Schemas['EntityDetail'];
export type EntityRef = Schemas['EntityRef'];
export type Alias = Schemas['Alias'];
export type AliasInput = Schemas['AliasInput'];
export type EntityDomain = Schemas['EntityDomain'];
export type ProjectEntity = Schemas['ProjectEntity'];
export type ProjectDomain = Schemas['ProjectDomain'];
export type Location = Schemas['Location'];
export type Vocabulary = Schemas['Vocabulary'];
export type Term = Schemas['Term'];
export type TermNode = Schemas['TermNode'];
export type DomainCategory = Schemas['DomainCategory'];
export type AliasTestResult = Schemas['AliasTestResult'];

// Step 5 part 1: keywords, groups, terms and the project's keyword defaults
export type Keyword = Schemas['Keyword'];
export type KeywordDetail = Schemas['KeywordDetail'];
export type KeywordMetrics = Schemas['KeywordMetrics'];
export type KeywordMetricsHistory = Schemas['KeywordMetricsHistory'];
export type MetricValue = Schemas['MetricValue'];
export type MonthlySearches = Schemas['MonthlySearches'];
export type TrackedVariant = Schemas['TrackedVariant'];
export type TrackedKeyword = Schemas['TrackedKeyword'];
export type TrackedKeywordRow = Schemas['TrackedKeywordRow'];
export type CompetitorRank = Schemas['CompetitorRank'];
export type TrackedKeywordDetail = Schemas['TrackedKeywordDetail'];
export type TrackedKeywordCreate = Schemas['TrackedKeywordCreate'];
export type TrackedKeywordPatch = Schemas['TrackedKeywordPatch'];
export type TrackedKeywordFilter = Schemas['TrackedKeywordFilter'];
export type TrackedKeywordPageInfo = Schemas['TrackedKeywordPageInfo'];
export type TrackedKeywordBulkCreate = Schemas['TrackedKeywordBulkCreate'];
export type TrackedKeywordBulkUpdate = Schemas['TrackedKeywordBulkUpdate'];
export type TrackedKeywordBulkArchive = Schemas['TrackedKeywordBulkArchive'];
export type BulkCreateResult = Schemas['BulkCreateResult'];
export type BulkUpdateResult = Schemas['BulkUpdateResult'];
export type BulkArchiveResult = Schemas['BulkArchiveResult'];
export type CompetitorOverride = Schemas['CompetitorOverride'];
export type CompetitorSet = Schemas['CompetitorSet'];
export type ConfigVersion = Schemas['ConfigVersion'];
export type GroupRef = Schemas['GroupRef'];
export type TermRef = Schemas['TermRef'];
export type UrlRef = Schemas['UrlRef'];
export type RankCell = Schemas['RankCell'];
export type AioStateInfo = Schemas['AioStateInfo'];
export type RankChange = Schemas['RankChange'];
export type TrackedKeywordState = Schemas['TrackedKeywordState'];
export type Sparkline = Schemas['Sparkline'];
export type SparklinePoint = Schemas['SparklinePoint'];
export type KeywordGroup = Schemas['KeywordGroup'];
export type KeywordGroupNode = Schemas['KeywordGroupNode'];
export type KeywordGroupCreate = Schemas['KeywordGroupCreate'];
export type KeywordGroupUpdate = Schemas['KeywordGroupUpdate'];
export type TermAssignment = Schemas['TermAssignment'];
export type TermAssignmentResult = Schemas['TermAssignmentResult'];
export type ProjectSettings = Schemas['ProjectSettings'];
export type SeoSettings = Schemas['SeoSettings'];
export type SeoSettingsPatch = Schemas['SeoSettingsPatch'];

// Step 5 part 1: imports, schedules, runs and costs
export type KeywordImport = Schemas['KeywordImport'];
export type KeywordImportCreate = Schemas['KeywordImportCreate'];
export type KeywordImportUpdate = Schemas['KeywordImportUpdate'];
export type KeywordImportConfirm = Schemas['KeywordImportConfirm'];
export type ImportDefaults = Schemas['ImportDefaults'];
export type ImportField = Schemas['ImportField'];
export type ImportRow = Schemas['ImportRow'];
export type RowActionInput = Schemas['RowActionInput'];
export type Operation = Schemas['Operation'];
export type Schedule = Schemas['Schedule'];
export type ScheduleInput = Schemas['ScheduleInput'];
export type ScheduleUpdate = Schemas['ScheduleUpdate'];
export type ScheduleRef = Schemas['ScheduleRef'];
export type Selector = Schemas['Selector'];
export type Run = Schemas['Run'];
export type RunDetail = Schemas['RunDetail'];
export type ManualRuns = Schemas['ManualRuns'];
export type MetricsRefresh = Schemas['MetricsRefresh'];
export type Actor = Schemas['Actor'];
export type CostRow = Schemas['CostRow'];
export type CostList = Schemas['CostList'];
export type CostMeta = Schemas['CostMeta'];
export type CostSources = Schemas['CostSources'];
export type CostWorkload = Schemas['CostWorkload'];
export type Budget = Schemas['Budget'];
export type BudgetStatus = Schemas['BudgetStatus'];
export type BudgetStatusList = Schemas['BudgetStatusList'];
export type Price = Schemas['Price'];
export type RankHistory = Schemas['RankHistory'];
export type HistorySeries = Schemas['HistorySeries'];
export type HistoryPoint = Schemas['HistoryPoint'];
export type HistoryBand = Schemas['HistoryBand'];

/** Runtime lists from the OpenAPI enums: a form checks a slug against them before it asks the API. */
export { reservedProjectSlugValues, reservedWorkspaceSlugValues, roleValues } from './schema';
