import type { PromptsSummary, Schemas } from '@/lib/api/types';

/**
 * The comparison period as the address and the response say it (WP-19, decision D8). Pure: no React, no feature.
 * `cmp` absent is on (D-03: compare is on by default) and `cmp=off` is off; nothing else is ever written.
 */

type Compared = Pick<PromptsSummary, 'compare_window'> | null | undefined;

/** Whether the address asks for the comparison: only `cmp=off` turns it off, any other value reads as on. */
export const parseCompare = (value: string | null | undefined): boolean => value !== 'off';

/** What a comparison is with: the days just before the window, or the same dates a year earlier (the API's `compare`). */
export type CompareKind = 'previous_period' | 'previous_year';

/** The value of `cmp` that says the same dates a year earlier (on a page that compares by default and on one that does not). */
export const CMP_YEAR = 'year';

/** What `cmp` compares with: `year` is the same dates a year earlier, anything else the period before. */
export const compareKindOf = (value: string | null | undefined): CompareKind =>
  value === CMP_YEAR ? 'previous_year' : 'previous_period';

/**
 * The value of `cmp` that says `compare` on a page that compares by default: nothing for the period before (a default
 * writes nothing), `year` for the same dates a year earlier, `off` for off.
 */
export const cmpParam = (compare: boolean, kind: CompareKind = 'previous_period'): 'off' | 'year' | null =>
  !compare ? 'off' : kind === 'previous_year' ? CMP_YEAR : null;

/**
 * The query of a read that asks for the previous period (or `kind`) while `compare` is on, and nothing while off
 * (API default `none`).
 */
export function compareParams(compare: boolean): { readonly compare?: 'previous_period' };
export function compareParams(compare: boolean, kind: CompareKind | undefined): { readonly compare?: CompareKind };
export function compareParams(
  compare: boolean,
  kind: CompareKind | undefined = 'previous_period',
): { readonly compare?: CompareKind } {
  return compare ? { compare: kind } : {};
}

/** Whether a response was compared with another window: only one that carries `compare_window` was. */
export const isCompared = (summary: Compared): boolean => comparedWindow(summary) !== null;

/** The days a response was compared with, or `null` when it was not compared. */
export const comparedWindow = (summary: Compared): Schemas['MetricWindow'] | null => summary?.compare_window ?? null;
