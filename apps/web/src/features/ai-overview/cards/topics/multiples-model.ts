import type { EngineInfo, TopicNode } from './model-types';
import {
  buildTrend,
  trendPanels,
  TREND_EXPORT_HEADER,
  type TrendModel,
  type TrendPanel,
  type TrendWords,
} from './trend-model';

/**
 * The small multiples of the mention rate of the top topics on one engine (CH-33): the trend model with a single
 * engine, one panel for each topic. An engine the view does not ask is no model at all: the card says why.
 */

/** The columns of the card's export block: the same as the trend card's. */
export const MULTIPLES_EXPORT_HEADER = TREND_EXPORT_HEADER;

export const multiplesFileName = (engineCode: string): string => `topic-trends-${engineCode}`;

export type MultiplesModel = { state: 'not_asked' } | { state: 'ok'; engine: EngineInfo; trend: TrendModel };

export interface MultiplesInput {
  nodes: readonly TopicNode[];
  /** The engines the view asks. */
  engines: readonly EngineInfo[];
  /** The engine of the card. */
  code: string;
  /** How many topics to draw. */
  count: number;
}

export function multiplesModel({ nodes, engines, code, count }: MultiplesInput): MultiplesModel {
  const engine = engines.find((entry) => entry.code === code);
  if (engine === undefined) return { state: 'not_asked' };
  return { state: 'ok', engine, trend: buildTrend({ nodes, engines: [engine], metric: 'mentioned', count }) };
}

export interface MultiplesWords extends TrendWords {
  /** "CRM (17 prompts)": the name of a panel. */
  panelName: (topic: string, prompts: number) => string;
}

/** One panel for each topic, in the colour of the card's engine. */
export const multiplesPanels = (model: Extract<MultiplesModel, { state: 'ok' }>, words: MultiplesWords): TrendPanel[] =>
  trendPanels(model.trend, 'mentioned', words, (row) => words.panelName(row.node.name, row.node.promptCount));
