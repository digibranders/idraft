import type { EngineCode, Schemas } from '@/lib/api/types';

/**
 * The types of the citation and source reads, taken from the generated client so a schema change breaks the
 * code that reads a field (`lib/api/types.ts` has no alias for them). The prompt tab and the Citations page
 * both import this folder, because a feature never imports another feature.
 */

export type { EngineCode };

/** The workspace and project every read is under. */
export interface SourceScope {
  workspaceId: string;
  projectId: string;
}

export type DomainRole = Schemas['SourceDomainRow']['domain_role'];

export type SourceDomainPage = Schemas['SourceDomainPage'];
export type SourceDomainRow = Schemas['SourceDomainRow'];
export type SourceDomainDetail = Schemas['SourceDomainDetail'];
export type SourceDomainDetailData = Schemas['SourceDomainDetailData'];
export type DomainEngineSeries = Schemas['DomainEngineSeries'];
export type DomainEngineWeek = Schemas['DomainEngineWeek'];
export type DomainPrompt = Schemas['DomainPrompt'];
export type SourcePagePage = Schemas['SourcePagePage'];
export type SourcePageRow = Schemas['SourcePageRow'];
export type SourcesMeta = Schemas['SourcesMeta'];
export type SourcesWeek = Schemas['SourcesWeek'];
export type SourceWeekUnits = Schemas['SourceWeekUnits'];
export type CitationPage = Schemas['CitationPage'];
export type CitationRow = Schemas['CitationRow'];
export type SourceChangePage = Schemas['SourceChangePage'];
export type SourceChangeRow = Schemas['SourceChangeRow'];
export type SourceDiversity = Schemas['SourceDiversity'];
export type SourceDiversityEngine = Schemas['SourceDiversityEngine'];
export type PromptOwnPagesPage = Schemas['PromptOwnPagesPage'];
export type PromptOwnPagesRow = Schemas['PromptOwnPagesRow'];
export type MetricCell = Schemas['MetricCell'];
export type EngineUnits = Schemas['EngineUnits'];
export type RoleUnits = Schemas['RoleUnits'];
export type EngineRoleUnits = Schemas['EngineRoleUnits'];
export type CitedWith = Schemas['CitedWith'];
