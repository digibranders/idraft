import type { ProjectEntity } from '@/lib/api/types';

/** What the project's entity list says of one entity: its role and the color its charts draw it in. */
export type ProjectEntry = ProjectEntity;

/** The summary gives entity cells for at most this many tracked entities, so a 21st competitor would show no number. */
export const TRACKED_LIMIT = 20;

/** Whether the project follows as many entities as the summary can give cells for. */
export const atTrackedLimit = (tracked: number): boolean => tracked >= TRACKED_LIMIT;
