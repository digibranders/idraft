import { engineGapOf, engineValue, type EngineValue } from './engine-values';
import type { TopicHead } from './topic-rows';
import { NO_TOPIC, type RateMetric } from '@/features/prompts/prompt-model';
import { averageRate, sortByKeys, type AverageRate, type CellMetric } from '@/lib/rates/rate-model';

/**
 * The model of the heat map of the Topics tab (CH-04, WB-TPE-07): what each row holds per engine, the average over the
 * engines and the gap between them, and the three orders of the rows. Plain data: the component puts words to it.
 */

export const HEAT_ORDERS = ['prompts', 'avg_rate', 'engine_gap'] as const;
export type HeatOrder = (typeof HEAT_ORDERS)[number];

export interface HeatInput {
  head: TopicHead;
  /** One per engine shown, in order. */
  values: EngineValue[];
  /** The equal weight average over the engines that have a rate: it says how many took part (`engines`). */
  average: AverageRate;
  /** Best minus weakest engine in points; `null` under 2 engines with a rate. */
  gap: number | null;
}

export function heatInput(head: TopicHead, metric: CellMetric, codes: readonly string[]): HeatInput {
  const values = codes.map((code) => engineValue(head.engines, code, metric));
  return {
    head,
    values,
    average: averageRate(codes.map((code) => head.engines.find((cell) => cell.engine_code === code)?.[metric])),
    gap: engineGapOf(values),
  };
}

/** The average column is drawn from 2 engines: with one it would repeat that column. */
export const showsAverage = (engineCount: number): boolean => engineCount >= 2;

/**
 * The rows in the order asked for, high to low, a row without the value last, a tie by name, the topics under a parent
 * in the same order among themselves. The prompts without a topic come after every topic, whatever the order.
 */
export function heatOrder(
  heads: readonly TopicHead[],
  order: HeatOrder,
  metric: CellMetric,
  codes: readonly string[],
): TopicHead[] {
  const valueOf = (head: TopicHead): number | null => {
    if (order === 'prompts') return head.promptCount;
    const input = heatInput(head, metric, codes);
    return order === 'avg_rate' ? input.average.value : input.gap;
  };
  const sorted = (rows: readonly TopicHead[]): TopicHead[] =>
    sortByKeys(
      rows,
      [{ id: order, desc: true }],
      (head) => valueOf(head),
      (head) => head.name,
    ).map((head) => ({ ...head, children: sorted(head.children) }));
  const topics = sorted(heads);
  return [...topics.filter((head) => head.key !== NO_TOPIC), ...topics.filter((head) => head.key === NO_TOPIC)];
}

/** The name of the file the heat map's menu downloads, without its extension. */
export const heatFileName = (metric: RateMetric): string => `topics-by-engine-heat-map-${metric}`;

/** The order the `sort` of the address names: an id of the table's columns, or none, is the default (Prompts). */
export function parseHeatOrder(sortText: string | null): HeatOrder {
  const id = sortText?.replace(/^-/, '') ?? null;
  return HEAT_ORDERS.find((order) => order === id) ?? 'prompts';
}

/** The `sort` that names an order; the default needs none. The table reads `-engine_gap` as its own column, high to low. */
export const heatOrderText = (order: HeatOrder): string | null =>
  order === 'prompts' ? null : order === 'engine_gap' ? '-engine_gap' : order;
