import type { PromptsSummary, Schemas } from '@/lib/api/types';

/**
 * The comparison period as the address and the response say it (WP-19, decision D8). Pure: no React, no feature.
 * `cmp` absent is on (D-03: compare is on by default) and `cmp=off` is off; nothing else is ever written.
 */

type Compared = Pick<PromptsSummary, 'compare_window'> | null | undefined;

/** Whether the address asks for the comparison: only `cmp=off` turns it off, any other value reads as on. */
export const parseCompare = (value: string | null | undefined): boolean => value !== 'off';

/** The value of `cmp` that says `compare`: nothing for on (a default writes nothing), `off` for off. */
export const cmpParam = (compare: boolean): 'off' | null => (compare ? null : 'off');

/** The query of a read that asks for the previous period while `compare` is on, and nothing while off (API default `none`). */
export const compareParams = (compare: boolean): { readonly compare?: 'previous_period' } =>
  compare ? { compare: 'previous_period' } : {};

/** Whether a response was compared with another window: only one that carries `compare_window` was. */
export const isCompared = (summary: Compared): boolean => comparedWindow(summary) !== null;

/** The days a response was compared with, or `null` when it was not compared. */
export const comparedWindow = (summary: Compared): Schemas['MetricWindow'] | null => summary?.compare_window ?? null;
