import { entityTotals } from './entity-totals';
import { UNREAD, type EngineEntityTotals, type MentionFigure, type TrackedEntity, type TrackedSet, type Unread } from './types';
import type { PromptsSummary } from '@/lib/api/types';
import type { RateState } from '@/lib/stats';

/**
 * Share of voice over the platforms the page scope asks for (the three competitor cards follow the scope, there is no
 * engine option). One platform is its own shares. All platforms is the equal-weight average of the platforms that have
 * a share (R3, R12): never a ratio of pooled counts, and a platform with fewer than 4 answers naming a tracked brand
 * is left out, not counted as 0.
 */

export interface ScopeEntityShare {
  entity: TrackedEntity;
  /** The share, 0 to 1; `null` when no platform has enough answers. */
  value: number | null;
  /** Mentioned of one platform, for the count beside the share; `null` for an average, which has no single count. */
  mention: MentionFigure | null;
}

export interface ScopeShares {
  status: 'read';
  /** `ok` when at least one platform has a share; else `insufficient` (some platform has answers) or `none`. */
  state: RateState;
  /** The platforms the shares are of: the N of "avg of N". Empty unless `state` is `ok`. */
  used: readonly string[];
  /** The answers that name a tracked brand: the platform's own, or the largest one a platform reached for an average. */
  answers: number;
  /** Every valid answer of the platforms read, naming a tracked brand or not. */
  validAnswers: number;
  entities: ScopeEntityShare[];
}

export type ScopeShareRead = ScopeShares | Unread;

/** `average` is true for All platforms: the average of the platforms, whatever their number. */
export function shareAcrossPlatforms(
  summary: PromptsSummary,
  codes: readonly string[],
  set: TrackedSet,
  average: boolean,
): ScopeShareRead {
  const read = codes
    .map((code) => entityTotals(summary, code, set))
    .filter((totals): totals is EngineEntityTotals => totals.status === 'read');
  if (read.length === 0) return UNREAD;
  const rated = read.filter((totals) => totals.state === 'ok');
  const answers = Math.max(...read.map((totals) => totals.answersNamingTracked));
  const validAnswers = read.reduce((total, totals) => total + totals.validAnswers, 0);
  const state: RateState = rated.length > 0 ? 'ok' : answers > 0 ? 'insufficient' : 'none';
  const entities = set.entities.map((entity, index): ScopeEntityShare => {
    const values = rated.flatMap((totals) => {
      const value = totals.entities[index]?.share.value;
      return value === null || value === undefined ? [] : [value];
    });
    const single = !average && read.length === 1 ? (read[0]?.entities[index]?.mention ?? null) : null;
    return {
      entity,
      value: values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length,
      mention: single,
    };
  });
  return {
    status: 'read',
    state,
    used: rated.map((totals) => totals.engineCode),
    answers: average ? answers : (read[0]?.answersNamingTracked ?? 0),
    validAnswers,
    entities,
  };
}
