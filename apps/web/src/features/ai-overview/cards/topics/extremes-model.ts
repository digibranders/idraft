import type { EngineValue } from './engine-values';
import { MIN_PROMPTS_TO_RANK, type TopicNode } from './model-types';
import { leavesOf } from './topic-nodes';
import { topicEngineRows, type TopicEngineRow } from './topic-rows';
import type { CellMetric } from '@/lib/rates/rate-model';

/** One engine's reading of one topic, ranked. */
export interface RankedTopic {
  row: TopicEngineRow;
  /** The engine's value of the topic: always a rate (`state` `ok`). */
  value: EngineValue;
}

/** The columns of the card's export block: data names, not words for a person. */
export const EXTREMES_EXPORT_HEADER = [
  'engine',
  'group',
  'topic',
  'rate_percent',
  'answers',
  'prompts',
  'status',
] as const;

export const extremesFileName = (metric: string): string => `strongest-weakest-topics-${metric}`;

export interface Extremes {
  /** The highest rates above 0, best first. */
  strongest: RankedTopic[];
  /** The lowest rates of the topics the strongest list left, weakest first; a topic is never in both lists. */
  weakest: RankedTopic[];
  /** Leaf topics left out: under the minimum answers, under the minimum prompts, or no answer. */
  notRanked: number;
  /** Every leaf topic the engine did not rank, with its value, for the table and the export. */
  unranked: TopicEngineRow[];
  /** Leaf topics with a rate on the engine, ranked or not: none means the engine has nothing to show here. */
  rated: number;
  /** Whether any leaf topic has a valid answer on the engine, however few. */
  answered: boolean;
}

/** A topic is ranked on an engine from 4 valid answers (`ok`) over at least `MIN_PROMPTS_TO_RANK` prompts. */
const isRanked = (value: EngineValue | undefined): value is EngineValue =>
  value !== undefined && value.state === 'ok' && value.value !== null && (value.prompts ?? 0) >= MIN_PROMPTS_TO_RANK;

const rateOf = (entry: RankedTopic): number => entry.value.value ?? 0;
/** Higher prompts first, then the name: a tie in the rate goes to the topic that holds more prompts. */
const byPromptsThenName = (a: RankedTopic, b: RankedTopic): number =>
  b.row.node.promptCount - a.row.node.promptCount || a.row.node.name.localeCompare(b.row.node.name);

/**
 * The strongest and the weakest topics of one engine on one metric. Only leaf topics are ranked (a parent is not
 * ranked beside its own children, the row of no topic is not a topic); `count` is the length of each list.
 */
export function extremesModel(nodes: readonly TopicNode[], code: string, metric: CellMetric, count: number): Extremes {
  const rows = topicEngineRows(leavesOf(nodes), [code], metric);
  const ranked: RankedTopic[] = [];
  const unranked: TopicEngineRow[] = [];
  for (const row of rows) {
    const [value] = row.values;
    if (isRanked(value)) ranked.push({ row, value });
    else unranked.push(row);
  }
  const strongestFirst = [...ranked].sort((a, b) => rateOf(b) - rateOf(a) || byPromptsThenName(a, b));
  const strongest = strongestFirst.filter((entry) => rateOf(entry) > 0).slice(0, count);
  const rest = strongestFirst.filter((entry) => !strongest.includes(entry));
  const weakest = [...rest].sort((a, b) => rateOf(a) - rateOf(b) || byPromptsThenName(a, b)).slice(0, count);
  const values = rows.flatMap((row) => row.values);
  return {
    strongest,
    weakest,
    notRanked: unranked.length,
    unranked,
    rated: values.filter((value) => value.state === 'ok').length,
    answered: values.some((value) => value.answers > 0),
  };
}
