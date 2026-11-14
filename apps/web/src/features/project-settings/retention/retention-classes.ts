/** The kinds of raw data the platform stores, by the retention class of the raw store (doc 23 section 9.2). */
export type RetentionClass = 'serp_raw' | 'ai_raw' | 'first_party_raw' | 'error';

export interface RetentionRule {
  key: RetentionClass;
  /** The class's name in the message catalog, whose keys are camelCase. */
  message: 'serpRaw' | 'aiRaw' | 'firstPartyRaw' | 'error';
  /** How many days it is kept, or `null` for ever. */
  days: number | null;
}

/**
 * How long each kind is kept: fixed for every workspace, so the page states it and reads nothing. The source
 * is `RETENTION` in backend/src/idraft/storage/raw.py; retention-classes.test.ts fails when the two differ.
 */
export const RETENTION_CLASSES: readonly RetentionRule[] = [
  { key: 'serp_raw', message: 'serpRaw', days: 400 },
  { key: 'ai_raw', message: 'aiRaw', days: null },
  { key: 'first_party_raw', message: 'firstPartyRaw', days: 90 },
  { key: 'error', message: 'error', days: 30 },
];
