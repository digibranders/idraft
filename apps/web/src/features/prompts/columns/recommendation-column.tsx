import { recommendedOf, type FactsRow } from '../facts';
import { countText, SORT_ID } from '../prompt-model';
import { rateMetricColumn, type RateFigure } from './rate-metric-column';
import type { RateColumnSpec } from './rate-metric-column';
import { unanswered, type MetricContext } from './metric-shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE } from '@/lib/format';

/** The preview's Recommendation rate column: 196 px. */
const RECOMMENDATION_WIDTH = 196;

/**
 * The recommendation rate of a row: each platform that classifies recommendations has its own rate, then the
 * equal-weight average of those with enough valid answers. A platform that does not classify them (Google AI Mode,
 * Google AI Overview) takes no part, and with none in view that classifies, the cell says so. `facts` is `undefined`
 * while the facts are not read.
 */
export function recommendationFigure(facts: FactsRow | undefined, scope: readonly string[]): RateFigure {
  if (facts === undefined) return { state: 'unknown', kind: 'not_collected' };
  if (unanswered(facts, scope)) return { state: 'unknown', kind: 'no_answers' };
  const reading = recommendedOf([facts], scope);
  if (reading.state === 'ok') {
    return {
      state: 'ok',
      value: reading.value,
      parts: reading.codes.map((code) => ({
        code,
        count:
          countText(facts.engines.find((engine) => engine.engine_code === code)?.recommended ?? undefined) ??
          EMPTY_VALUE,
      })),
    };
  }
  if (reading.reason === 'too_few_answers') {
    return reading.answers > 0
      ? { state: 'insufficient', answers: reading.answers }
      : { state: 'unknown', kind: 'no_answers' };
  }
  return { state: 'unknown', kind: reading.reason };
}

export type RecommendationRows<TRow> = Pick<RateColumnSpec<TRow>, 'link'> & {
  facts: (row: TRow) => FactsRow | undefined;
};

export function recommendationColumn<TRow>(
  context: MetricContext,
  rows: RecommendationRows<TRow>,
): DataTableColumn<TRow> {
  return rateMetricColumn(context, {
    id: SORT_ID.recommendation,
    header: context.t('prompts.metrics.recommendation.header'),
    headerTooltip: context.t('prompts.metrics.recommendation.tip'),
    priority: 2,
    width: RECOMMENDATION_WIDTH,
    figureOf: (row) => recommendationFigure(rows.facts(row), context.scope),
    link: rows.link,
  });
}
