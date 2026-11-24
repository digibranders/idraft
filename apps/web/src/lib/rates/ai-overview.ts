import type { PromptAiOverview, Schemas } from '@/lib/api/types';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * Google AI Overview as a platform figure. It is read from the latest rank checks of the keywords the prompts are
 * linked to, not from answers, so it has no window, no valid-answer count and no mention rate: only how many of the
 * prompts whose keyword shows an overview have one that cites the own site. It is kept out of every equal-weight
 * average of the platforms, which are over answers.
 */
export type AiOverviewTotals = Schemas['AiOverviewTotals'];

/** What the figure reads of a prompt row: its Google AI Overview cell, absent when the read did not ask for it. */
export interface AiOverviewRow {
  ai_overview?: PromptAiOverview | undefined;
}

/**
 * The totals over the prompt rows given, so the figure follows the filters of the page that lists them (the API's own
 * `ai_overview` block counts every prompt in scope). `undefined` when no row carries the cell: it was not asked for.
 */
export function aiOverviewTotalsOf(rows: readonly AiOverviewRow[]): AiOverviewTotals | undefined {
  const cells = rows.flatMap((row) => (row.ai_overview === undefined ? [] : [row.ai_overview]));
  if (cells.length === 0) return undefined;
  const tracked = cells.filter((cell) => cell.source_state === 'ok' || cell.source_state === 'no_surface');
  const shown = tracked.filter((cell) => cell.shown === true);
  const cited = shown.filter((cell) => cell.cited_own === true);
  const keywordsOf = (list: readonly PromptAiOverview[]): number => new Set(list.map((cell) => cell.keyword)).size;
  const observed = tracked.flatMap((cell) => (cell.observed_at === null ? [] : [cell.observed_at])).sort();
  return {
    prompts: cells.length,
    linked: cells.filter((cell) => cell.source_state !== 'no_linked_keyword').length,
    tracked: tracked.length,
    shown: shown.length,
    cited_own: cited.length,
    keywords_shown: keywordsOf(shown),
    keywords_cited: keywordsOf(cited),
    observed_at: observed.at(-1) ?? null,
  };
}

/** Why there is no rate: no linked keyword has a usable check, or the overview was shown for none of them. */
export type AiOverviewNone = 'notTracked' | 'noOverview';

export interface AiOverviewFigure {
  state: 'ok' | 'insufficient' | 'none';
  /** Prompts whose overview cites the own site over prompts whose keyword shows one; only when `state` is `ok`. */
  value: number | null;
  /** Prompts whose keyword shows an overview (the denominator). */
  shown: number;
  /** Of those, prompts whose overview cites the own site. */
  cited: number;
  /** The distinct keywords behind `shown`: prompts can share one, so the floor is held to this. */
  keywords: number;
  /** Prompts whose keyword has a usable check. */
  tracked: number;
  /** When the newest check counted was made. */
  observedAt: string | null;
  reason: AiOverviewNone | null;
}

/** The figure of the totals; `null` while the read does not carry them (the backend has not built them). */
export function aiOverviewFigure(totals: AiOverviewTotals | undefined): AiOverviewFigure | null {
  if (totals === undefined) return null;
  const base = {
    shown: totals.shown,
    cited: totals.cited_own,
    keywords: totals.keywords_shown,
    tracked: totals.tracked,
    observedAt: totals.observed_at,
  };
  if (totals.tracked === 0) return { ...base, state: 'none', value: null, reason: 'notTracked' };
  if (totals.shown === 0) return { ...base, state: 'none', value: null, reason: 'noOverview' };
  if (totals.keywords_shown < MIN_OBSERVATIONS) return { ...base, state: 'insufficient', value: null, reason: null };
  return { ...base, state: 'ok', value: totals.cited_own / totals.shown, reason: null };
}
