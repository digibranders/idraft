import { bestWorst, engineGapOf, engineValue, type BestWorst, type EngineValue } from './engine-values';
import type { TopicNode } from './model-types';
import { NO_TOPIC } from './topic-nodes';
import { averageRate, sortByKeys, type AverageRate, type CellMetric } from '@/lib/rates/rate-model';

/**
 * What each topic is, engine by engine: one value per asked engine, their equal weight average (from the engines that
 * have a rate, and it says how many), and the gap between the best and the weakest engine. Plain data.
 */
export interface TopicEngineRow {
  node: TopicNode;
  /** One per asked engine, in the order of `codes`. */
  values: EngineValue[];
  /** Over the engines with a rate only; `engines` says how many took part ("avg of N"). */
  average: AverageRate;
  /** Best minus weakest in points; `null` under 2 engines with a rate. */
  gap: number | null;
  spread: BestWorst | null;
}

export function topicEngineRows(
  nodes: readonly TopicNode[],
  codes: readonly string[],
  metric: CellMetric,
): TopicEngineRow[] {
  return nodes.map((node) => {
    const values = codes.map((code) => engineValue(node.engines, code, metric));
    return {
      node,
      values,
      average: averageRate(codes.map((code) => node.engines.find((cells) => cells.engine_code === code)?.[metric])),
      gap: engineGapOf(values),
      spread: bestWorst(values),
    };
  });
}

/**
 * The rows by the order asked, high to low: `prompts` the prompts a topic holds, `rate` the average rate, `gap` the
 * gap between engines. A row without a value comes after every row that has one, a tie goes to the name, and the row
 * of no topic is last whatever the order. With `topLevelOnly` the rows below a top level topic are left out. The
 * rows given are not changed.
 */
export function orderRows(
  rows: readonly TopicEngineRow[],
  order: 'prompts' | 'rate' | 'gap',
  topLevelOnly: boolean,
): TopicEngineRow[] {
  const sorted = sortByKeys(
    rows.filter((row) => !topLevelOnly || row.node.level === 1),
    [{ id: order, desc: true }],
    (row) => (order === 'prompts' ? row.node.promptCount : order === 'rate' ? row.average.value : row.gap),
    (row) => row.node.name,
  );
  return [...sorted.filter((row) => row.node.key !== NO_TOPIC), ...sorted.filter((row) => row.node.key === NO_TOPIC)];
}

/** What an export block writes of an engine's rate when it has none: why, as the Numbers file of the page words it. */
const EMPTY_STATUS = {
  noAnswers: 'no_answers',
  noneValid: 'no_valid_answers',
  noBrandNamed: 'no_brand_named',
} as const;

/**
 * The three cells an export block writes for one engine value: the rate as a percent number to two places (an empty
 * cell when it is not known, never 0), the valid answers behind it, and a status that says why a rate is empty.
 */
export function exportCells(value: EngineValue): [rate: number | null, answers: number, status: string] {
  const rate = value.state === 'ok' && value.value !== null ? Math.round(value.value * 10000) / 100 : null;
  const status = value.state === 'none' ? EMPTY_STATUS[value.reason ?? 'noAnswers'] : value.state;
  return [rate, value.answers, status];
}
