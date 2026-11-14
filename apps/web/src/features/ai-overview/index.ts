/**
 * The public entry of the AI visibility Overview (WP-33). The route imports the screen; the card packages
 * (WP-34 to 37) import the context and the reads below, and fill their family maps in `cards/*` (plan section 5).
 */
export { AiOverviewScreen } from './ai-overview-screen';
export type { AiOverviewScreenProps } from './ai-overview-screen';
export {
  OverviewProvider,
  useOverview,
  useOverviewEngines,
  useOverviewFanout,
  useOverviewFreshness,
  useOverviewPeriods,
  useOverviewSchedule,
  useOverviewSources,
  useOverviewSummary,
} from './overview-context';
export type { OverviewContextValue, OverviewProject, OverviewProviderProps } from './overview-context';
export type { OverviewScope, ScopePatch } from './scope/scope-model';
export type { Read, ReadStatus } from './data/read-state';
export type { SourcesOptions, SummaryOptions } from './data/overview-queries';
export { ExportProvider, useExportBlock } from './export/export-registry';
export type { ExportRead, GetExportBlock } from './export/export-registry';
export type { ExportBlock } from './export/export-model';
export type {
  OverviewEngines,
  OverviewFanoutMeta,
  OverviewFreshness,
  OverviewPeriods,
  OverviewSchedule,
  OverviewSourcesMeta,
  ReadOptions,
  SourcesReadOptions,
  SummaryReadOptions,
} from './data/use-overview-reads';
export { DRILL_SUPPORT, drillHref } from './drilldown/drill-links';
export type { DrillExtra, DrillKind, DrillMetric, DrillProject, DrillSupport } from './drilldown/drill-links';
export { buildAggregates } from './data/aggregates';
export type { OverviewAggregates } from './data/aggregates';
