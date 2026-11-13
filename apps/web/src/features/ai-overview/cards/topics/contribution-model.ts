import type { TopicNode } from './model-types';
import { NO_TOPIC, overlapCount, topLevelOf } from './topic-nodes';
import type { PromptSummaryRow } from '@/lib/api/types';
import { formatDecimal } from '@/lib/format';
import { engineRates } from '@/lib/rates/strip-model';
import type { RateState } from '@/lib/stats';

/**
 * What each top level topic adds to the mention rate of one engine (CH-46). The rate is the strip's own: the mean of
 * the rates of the prompts that have a valid answer on the engine, each prompt counting once. A topic adds the sum of
 * its prompts' rates over the same prompt count, in points, so a prompt in two topics is in both bars and the bars can
 * add up to more than the rate; the model counts those prompts so a card can say it.
 */

export interface ContributionBar {
  /** The topic's key, `__none` for the prompts without a topic. */
  key: string;
  node: TopicNode;
  /** The prompts the bar counts; `null` when the tree does not tell which prompts the topic holds. */
  prompts: number | null;
  /** Points; `null` (n/a, never 0) when the topic's prompts are not known or none of them has an answer. */
  points: number | null;
}

/** `none`: no valid answer, `insufficient`: fewer than 4 valid answers in all, no rate and so nothing to split. */
export type ContributionState = RateState;

export interface LevelModel {
  state: ContributionState;
  /** The engine's mention rate over the prompts in scope (0 to 1) with the counts behind it. */
  headline: { value: number | null; answers: number; prompts: number };
  /** The top level topics by what they add, the prompts without a topic last. Empty unless `state` is `ok`. */
  bars: ContributionBar[];
  /** The bars added up, in points. */
  sumPoints: number;
  /** Prompts that are in more than one top level topic. */
  overlapping: number;
}

export interface ChangeModel {
  state: ContributionState;
  /** Prompts with a valid answer on the engine in both windows. */
  common: number;
  /** The change of the mention rate over those prompts, in points; `null` with none. */
  headlinePoints: number | null;
  /** The change of the strip's rate over all the prompts of each window, in points. */
  totalPoints: number | null;
  /** The part of the total that comes from prompts added or left (total minus `headlinePoints`); never allocated. */
  remainderPoints: number | null;
  /** Each topic's part of the change over the common prompts, in points, signed. Empty without common prompts. */
  bars: ContributionBar[];
  overlapping: number;
}

/**
 * A prompt's mention rate on the engine; `null` with no valid answer (not a rate of 0). A count that is not whole is
 * refused: a prompt's cell holds whole counts, and a guess would make the bars disagree with the strip.
 */
function promptRate(prompt: PromptSummaryRow, code: string): number | null {
  const cell = prompt.engines.find((engine) => engine.engine_code === code)?.mentioned;
  if (cell === undefined) return null;
  if (!Number.isInteger(cell.numerator) || !Number.isInteger(cell.denominator)) {
    throw new RangeError(
      `Prompt ${prompt.prompt_id}: ${String(cell.numerator)} of ${String(cell.denominator)} is not a whole count`,
    );
  }
  return cell.denominator < 1 ? null : cell.numerator / cell.denominator;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The bars' rows: every top level topic, then the prompts without a topic when there are any. */
function barNodes(nodes: readonly TopicNode[]): TopicNode[] {
  const none = nodes.filter((node) => node.key === NO_TOPIC && (node.members?.length ?? 1) > 0);
  return [...topLevelOf(nodes), ...none];
}

/** By points, high to low; an n/a bar after every bar with a value; a tie to the name; no topic always last. */
function orderBars(bars: readonly ContributionBar[]): ContributionBar[] {
  const rank = (bar: ContributionBar): number => (bar.key === NO_TOPIC ? 2 : bar.points === null ? 1 : 0);
  return [...bars].sort(
    (a, b) => rank(a) - rank(b) || (b.points ?? 0) - (a.points ?? 0) || a.node.name.localeCompare(b.node.name),
  );
}

export function levelModel(
  nodes: readonly TopicNode[],
  prompts: readonly PromptSummaryRow[],
  code: string,
): LevelModel {
  const strip = engineRates(prompts, code).mentioned;
  const rates = new Map(
    prompts.flatMap((prompt) => {
      const rate = promptRate(prompt, code);
      return rate === null ? [] : [[prompt.prompt_id, rate] as const];
    }),
  );
  const counted = rates.size;
  const headline = {
    value: strip.state === 'ok' && counted > 0 ? sum([...rates.values()]) / counted : null,
    answers: strip.answers,
    prompts: counted,
  };
  if (strip.state !== 'ok')
    return { state: strip.state, headline, bars: [], sumPoints: 0, overlapping: overlapCount(prompts, nodes) };
  const bars = orderBars(
    barNodes(nodes).map((node): ContributionBar => {
      const answered = (node.members ?? []).filter((member) => rates.has(member.prompt_id));
      const known = node.members !== null && answered.length > 0;
      return {
        key: node.key,
        node,
        prompts: node.members === null ? null : answered.length,
        points: known ? (sum(answered.map((member) => rates.get(member.prompt_id) ?? 0)) / counted) * 100 : null,
      };
    }),
  );
  return {
    state: 'ok',
    headline,
    bars,
    sumPoints: sum(bars.map((bar) => bar.points ?? 0)),
    overlapping: overlapCount(prompts, nodes),
  };
}

export function changeModel(
  nodes: readonly TopicNode[],
  prompts: readonly PromptSummaryRow[],
  previousPrompts: readonly PromptSummaryRow[],
  code: string,
): ChangeModel {
  const now = engineRates(prompts, code).mentioned;
  const before = engineRates(previousPrompts, code).mentioned;
  const state: ContributionState =
    now.state === 'none' || before.state === 'none'
      ? 'none'
      : now.state === 'insufficient' || before.state === 'insufficient'
        ? 'insufficient'
        : 'ok';
  const overlapping = overlapCount(prompts, nodes);
  const empty: ChangeModel = {
    state,
    common: 0,
    headlinePoints: null,
    totalPoints: null,
    remainderPoints: null,
    bars: [],
    overlapping,
  };
  if (state !== 'ok') return empty;

  const earlier = new Map(previousPrompts.map((prompt) => [prompt.prompt_id, promptRate(prompt, code)] as const));
  // What each common prompt moved: its rate now minus its rate before, over the prompts with an answer in both windows
  const moved = new Map(
    prompts.flatMap((prompt) => {
      const rate = promptRate(prompt, code);
      const was = earlier.get(prompt.prompt_id) ?? null;
      return rate === null || was === null ? [] : [[prompt.prompt_id, rate - was] as const];
    }),
  );
  const common = moved.size;
  if (common === 0) return empty;

  const headlinePoints = (sum([...moved.values()]) / common) * 100;
  const totalPoints = now.value === null || before.value === null ? null : (now.value - before.value) * 100;
  const bars = orderBars(
    barNodes(nodes).map((node): ContributionBar => {
      const shared = (node.members ?? []).filter((member) => moved.has(member.prompt_id));
      return {
        key: node.key,
        node,
        prompts: node.members === null ? null : shared.length,
        points:
          node.members === null || shared.length === 0
            ? null
            : (sum(shared.map((member) => moved.get(member.prompt_id) ?? 0)) / common) * 100,
      };
    }),
  );
  return {
    state,
    common,
    headlinePoints,
    totalPoints,
    remainderPoints: totalPoints === null ? null : totalPoints - headlinePoints,
    bars,
    overlapping,
  };
}

/** Points to one place ("35.0"); with `signed` a gain carries its plus ("+13.3"), a loss its minus. */
export function formatPoints(points: number, signed: boolean): string {
  const text = formatDecimal(points, 1);
  return signed && Math.round(points * 10) > 0 ? `+${text}` : text;
}

/** The columns of the card's export block: data names, not words for a person. */
export const CONTRIBUTION_EXPORT_HEADER = ['topic', 'prompts', 'contribution_points'] as const;

export const contributionFileName = (view: string, engine: string): string => `topic-contribution-${view}-${engine}`;
