import type { components } from '@/lib/api/schema';

type Schemas = components['schemas'];

export type ReportShare = Schemas['Share'];
export type CreatedReportShare = Schemas['CreatedReportShare'];
export type ReportShareState = Schemas['ShareState'];
export type ReportExpiryDays = Schemas['ExpiryDays'];
export type ReportSchedule = Schemas['ReportSchedule'];
export type ReportScheduleFrequency = Schemas['ReportScheduleFrequency'];
export type ClientReport = Schemas['ClientReport'];
export type ReportEngine = Schemas['ReportEngine'];
export type ReportBrand = Schemas['ReportBrand'];

/** The workspace and the project whose links and schedules are read. */
export interface ReportsScope {
  workspaceId: string;
  projectId: string;
}

/** What the API takes of the recipients of a schedule: one to ten addresses. */
export const RECIPIENTS_MAX = 10;
/** What the API takes of a project: ten schedules. */
export const SCHEDULES_MAX = 10;
