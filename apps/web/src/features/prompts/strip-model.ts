import { topicMembers, topicRowKept, type TopicDescendants } from './prompt-model';
import type { MetricCell, PromptSummaryRow, TopicSummaryRow } from '@/lib/api/types';
import { pooledCounts, promptWeightedRate, rateState, type RateState } from '@/lib/stats';

/**
 * The numbers of the metric strip (ADR-DS-022 decision 12): per engine the Mentioned, Cited and Share of voice
 * of the prompts in scope, and how many topics those prompts span. Plain data: the strip puts words to it.
 */

/** What the strip reads of a prompt in scope: its topics, and its cells when the summary has a row for it. */
export type StripPrompt = Pick<PromptSummaryRow, 'topic_term_ids' | 'engines'>;

/** Why a rate is not there; the key of `prompts.rate.reasons`. */
export type RateReason = 'noAnswers' | 'noneValid' | 'noBrandNamed';

/** One rate of one engine over the prompts in scope, and the counts behind it. */
export interface RateFigure {
  /** `insufficient`: fewer valid answers than `MIN_OBSERVATIONS`, so no rate is shown (17 section 4). */
  state: RateState;
  /** Only when `state` is `ok`. */
  value: number | null;
  /** The valid answers behind the rate; for share of voice, the valid answers that name a tracked brand. */
  answers: number;
  /** The answers that count ("4" of 8). `null` for share of voice, whose numerator is a sum of shares. */
  successes: number | null;
  /** The prompts the rate is the mean over (those with a valid answer): each counts once. */
  prompts: number;
  /** Only when `state` is `none`. */
  reason: RateReason | null;
}

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

/**
 * Share of voice of an engine over the prompts: the sum of the prompts' numerators (shares of one answer each)
 * over the sum of their denominators (answers that name a tracked brand), so one answer is one weight whatever
 * the prompt it belongs to (docs/16 section 5). It is the same as a Topics row's, which sums the same way.
 */
export function shareOfVoiceTotals(
  prompts: readonly StripPrompt[],
  engineCode: string,
): { numerator: number; denominator: number } {
  const cells = cellsOf(prompts, engineCode, 'share_of_voice');
  return {
    numerator: sum(cells.map((cell) => cell.numerator)),
    denominator: sum(cells.map((cell) => cell.denominator)),
  };
}

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
function weightedFigure(cells: readonly MetricCell[]): RateFigure {
  const counts = cells.map((cell) => ({ k: cell.numerator, n: cell.denominator }));
  const { k, n } = pooledCounts(counts);
  const state = rateState(n);
  if (state === 'none') {
    const reason = sum(cells.map((cell) => cell.n_observations)) === 0 ? 'noAnswers' : 'noneValid';
    return figure(state, null, 0, null, 0, reason);
  }
  return figure(state, promptWeightedRate(counts), n, k, counts.filter((count) => count.n >= 1).length, null);
}

/** The strip's three rates of one engine over `prompts`; none of the prompts having a cell on it is no answers. */
export function engineRates(prompts: readonly StripPrompt[], engineCode: string): EngineRates {
  const mentioned = weightedFigure(cellsOf(prompts, engineCode, 'mentioned'));
  const cited = weightedFigure(cellsOf(prompts, engineCode, 'cited'));
  const { numerator, denominator } = shareOfVoiceTotals(prompts, engineCode);
  const state = rateState(denominator);
  // Without a valid answer the reason is the Mentioned one; with answers, that none of them names a brand
  const reason: RateReason = mentioned.state === 'none' ? (mentioned.reason ?? 'noAnswers') : 'noBrandNamed';
  const shareOfVoice =
    state === 'none'
      ? figure(state, null, 0, null, 0, reason)
      : figure(state, numerator / denominator, denominator, null, mentioned.prompts, null);
  return { mentioned, cited, shareOfVoice };
}

/**
 * How many topics the prompts in scope span: the topics of the summary that hold at least one of them, as the
 * Topics tab lists them (the topic a prompt is given, every topic above it, and the row of no topic for the
 * prompts without one), within `kept` when a topic filter is set (`null` otherwise). A topic the vocabulary tree
 * does not hold yet cannot be rolled up, so it counts when a prompt carries it itself.
 */
export function topicsSpanned(
  topics: readonly TopicSummaryRow[],
  prompts: readonly StripPrompt[],
  descendants: TopicDescendants,
  kept: ReadonlySet<string> | null,
): number {
  return topics.filter((topic) => {
    if (kept !== null && !topicRowKept(topic.term_id, kept)) return false;
    const members = topicMembers(topic.term_id, prompts, descendants);
    if (members !== null) return members.length > 0;
    return prompts.some((prompt) => topic.term_id !== null && prompt.topic_term_ids.includes(topic.term_id));
  }).length;
}
