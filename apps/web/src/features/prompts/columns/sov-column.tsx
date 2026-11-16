import { SORT_ID } from '../prompt-model';
import { rateMetricColumn, type RateColumnSpec, type RateFigure } from './rate-metric-column';
import type { MetricContext } from './metric-shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary } from '@/lib/api/types';
import { averageRate, hasRate, validAnswers } from '@/lib/rates/rate-model';

/** The preview's Share of voice column is 140 px; the rate column type starts at 152. */
const SOV_WIDTH = 140;

/**
 * The share of voice of a row: each platform's share of the answers that name a brand, then the equal-weight average of
 * the platforms with enough of them. `cells` are the row's platform cells; `undefined` while the counts are not loaded.
 * The cell's numerator is a sum of shares, not a count of mentions (D17 is open), so a platform's count is the answers
 * that name a brand.
 */
export function shareOfVoiceFigure(context: MetricContext, cells: readonly EngineSummary[] | undefined): RateFigure {
  if (cells === undefined) return { state: 'unknown', kind: 'not_loaded' };
  const shares = context.scope.map((code) => ({
    code,
    cell: cells.find((engine) => engine.engine_code === code)?.share_of_voice,
  }));
  const average = averageRate(shares.map((share) => share.cell));
  if (average.state === 'ok' && average.value !== null) {
    return {
      state: 'ok',
      value: average.value,
      parts: shares.flatMap(({ code, cell }) =>
        cell !== undefined && hasRate(cell)
          ? [{ code, count: context.t('prompts.metrics.shareOfVoice.basis', { answers: validAnswers(cell) }) }]
          : [],
      ),
    };
  }
  if (average.state === 'insufficient') return { state: 'insufficient', answers: average.answers };
  return { state: 'unknown', kind: average.reason === 'noAnswers' ? 'no_answers' : 'no_brand' };
}

export type ShareOfVoiceRows<TRow> = Pick<RateColumnSpec<TRow>, 'link'> & {
  cells: (row: TRow) => readonly EngineSummary[] | undefined;
};

export function shareOfVoiceColumn<TRow>(context: MetricContext, rows: ShareOfVoiceRows<TRow>): DataTableColumn<TRow> {
  return rateMetricColumn(context, {
    id: SORT_ID.shareOfVoice,
    header: context.t('prompts.metrics.shareOfVoice.header'),
    headerTooltip: context.t('prompts.metrics.shareOfVoice.tip'),
    priority: 3,
    width: SOV_WIDTH,
    figureOf: (row) => shareOfVoiceFigure(context, rows.cells(row)),
    link: rows.link,
  });
}
