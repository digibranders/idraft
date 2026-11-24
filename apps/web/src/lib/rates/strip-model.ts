import { shareNoteOf } from './brand-mention-share';
import type { EngineSummary, MetricCell, PromptSummaryRow } from '@/lib/api/types';
import { pooledCounts, promptWeightedRate, rateState, type RateState } from '@/lib/stats';

/**
 * The numbers of the metric strip (ADR-DS-022 decision 12): per engine the Mentioned, Cited and Share of voice
 * of the prompts in scope, and how many topics those prompts span. Plain data: the strip puts words to it.
 */

/** What the strip reads of a prompt in scope: its topics, and its cells when the summary has a row for it. */
export type StripPrompt = Pick<PromptSummaryRow, 'topic_term_ids' | 'engines'> &
  Pick<Partial<PromptSummaryRow>, 'ai_overview'>;

/** Why a rate is not there; the key of `prompts.rate.reasons`. */
export type RateReason = 'noAnswers' | 'noneValid' | 'noBrandNamed' | 'notCollected' | 'capped';

/** One rate of one engine over the prompts in scope, and the counts behind it. */
export interface RateFigure {
  /** `insufficient`: fewer valid answers than `MIN_OBSERVATIONS`, so no rate is shown (17 section 4). */
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The valid answers behind the rate; for share of voice, the mentions of every tracked brand (the y of "x of y brand mentions"). */
  answers: number;
  /** The answers that count ("4" of 8); for share of voice, the mentions of the own brand (x). `null` where the count is not whole. */
  successes: number | null;
  /** The prompts the rate is the mean over (those with a valid answer): each counts once. */
  prompts: number;
  /** Only when `state` is `none`. */
  reason: RateReason | null;
}

/** What the words of a rate need: a figure over prompts, or an average over engines (`rate-model.ts`). */
export type RateReading = Omit<RateFigure, 'prompts'>;

export interface EngineRates {
  mentioned: RateFigure;
  cited: RateFigure;
  shareOfVoice: RateFigure;
}

const cellsOf = (
  prompts: readonly StripPrompt[],
  engineCode: string,
  metric: 'mentioned' | 'cited' | 'share_of_voice',
): MetricCell[] =>
  prompts.flatMap((prompt) => {
    const cell = prompt.engines.find((engine) => engine.engine_code === engineCode)?.[metric];
    return cell === undefined ? [] : [cell];
  });

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const figure = (
  state: RateState,
  value: number | null,
  answers: number,
  successes: number | null,
  prompts: number,
  reason: RateReason | null,
): RateFigure => ({ state, value: state === 'ok' ? value : null, answers, successes, prompts, reason });

/**
 * Mentioned and Cited are prompt weighted like a Topics row (ADR-DS-022 decision 3, docs/17 section 4.1): the mean
 * of each prompt's own rate over the prompts with a valid answer. The answers the state is judged on are all of
 * them pooled: fewer than `MIN_OBSERVATIONS` and the rate is not shown. `reason` says why a rate is missing, as
 * the tables do: no answer at all, or none valid.
 */
export function weightedFigure(cells: readonly MetricCell[]): RateFigure {
  const counts = cells.map((cell) => ({ k: cell.numerator, n: cell.denominator }));
  const { k, n } = pooledCounts(counts);
  const state = rateState(n);
  if (state === 'none') {
    const reason = sum(cells.map((cell) => cell.n_observations)) === 0 ? 'noAnswers' : 'noneValid';
    return figure(state, null, 0, null, 0, reason);
  }
  return figure(state, promptWeightedRate(counts), n, k, counts.filter((count) => count.n >= 1).length, null);
}

/**
 * Share of voice (D17) from the count share cells of a block (`withBrandMentionShare`): `successes` of `answers` is the
 * brand's mentions of all tracked-brand mentions, summed over the cells, so one mention is one weight whatever the prompt it
 * belongs to. A cell that says its counts are not collected or were cut by the cap makes the figure say so: it has no
 * value, never a percent without its counts. `mentioned` gives the reason a figure has no brand mention at all.
 */
export function shareFigureOf(cells: readonly MetricCell[], mentioned: RateFigure): RateFigure {
  const note = cells.map(shareNoteOf).find((entry) => entry !== undefined);
  if (note !== undefined) return figure('none', null, 0, null, 0, note);
  const k = sum(cells.map((cell) => cell.numerator));
  const n = sum(cells.map((cell) => cell.denominator));
  const state = rateState(n);
  // Without a valid answer the reason is the Mentioned one; with answers, that none of them names a tracked brand
  const reason: RateReason = mentioned.state === 'none' ? (mentioned.reason ?? 'noAnswers') : 'noBrandNamed';
  return state === 'none'
    ? figure(state, null, 0, null, 0, reason)
    : figure(state, k / n, n, k, mentioned.prompts, null);
}

/**
 * The strip's three rates of one engine over `prompts`; none of the prompts having a cell on it is no answers. Share of
 * voice is read from the engine's block of the `total` row when it is given (a read whose prompt rows carry no entity
 * cells), else from the prompt rows.
 */
export function engineRates(prompts: readonly StripPrompt[], engineCode: string, total?: EngineSummary): EngineRates {
  const mentioned = weightedFigure(cellsOf(prompts, engineCode, 'mentioned'));
  const cited = weightedFigure(cellsOf(prompts, engineCode, 'cited'));
  const share = total === undefined ? cellsOf(prompts, engineCode, 'share_of_voice') : [total.share_of_voice];
  return { mentioned, cited, shareOfVoice: shareFigureOf(share, mentioned) };
}
