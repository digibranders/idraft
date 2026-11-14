/**
 * The public entry of the Competitors page (WP-39). The route imports the screen and composes the Add competitor
 * dialog into it; the sections of the tabs read the project, the scope and the reads through `useCompetitors`.
 */
export { CompetitorsScreen } from './competitors-screen';
export type { CompetitorsScreenProps } from './competitors-screen';
export { AddCompetitorControlProvider, useAddCompetitorControl } from './add-competitor-control';
export type { AddCompetitorControl } from './add-competitor-control';
export { CompetitorsProvider, useCompetitors } from './competitors-context';
export type { CompetitorsContextValue, CompetitorsEngine, CompetitorsProject } from './competitors-context';
export type { CompetitorsReads, CompetitorsRead, InspectedCompetitor } from './data/use-competitors-reads';
export type { Read, ReadStatus } from './data/read-state';
export type { CompetitorsScope, CompetitorTab } from './scope/scope-model';
export type { ScopePatch } from './scope/use-competitors-scope';
