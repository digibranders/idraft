import { SORT_ID } from '../prompt-model';
import { rateMetricColumn, type RateColumnSpec, type RateFigure } from './rate-metric-column';
import type { MetricContext } from './metric-shared';
import type { DataTableColumn } from '@/components/app/data-table/types';
import type { EngineSummary } from '@/lib/api/types';
import { brandMentionCounts, shareOfCounts } from '@/lib/rates/brand-mentions';
import { equalWeightAverage } from '@/lib/stats';

/** The preview's Share of voice column is 140 px; the rate column type starts at 152. */
const SOV_WIDTH = 140;

/**
 * The share of voice of a row (D17): each platform's brand mentions over all tracked-brand mentions ("x of y brand
 * mentions"), then the equal-weight average of the platforms with at least 4 brand mentions. `cells` are the row's
 * platform cells; `undefined` while the counts are not loaded. The counts come from the entity cells of the read, so a
 * read without them (or without the own brand's) has no figure: "Not collected yet", never a percent without its counts.
 */
export function shareOfVoiceFigure(context: MetricContext, cells: readonly EngineSummary[] | undefined): RateFigure {
  if (cells === undefined) return { state: 'unknown', kind: 'not_loaded' };
  const ownIds = context.ownEntityIds;
  const platforms = context.scope.map((code) => ({
    code,
    counts:
      ownIds === undefined
        ? null
        : brandMentionCounts(
            cells.find((engine) => engine.engine_code === code),
            ownIds,
            context.trackedCount,
          ),
  }));
  const counted = platforms.flatMap(({ code, counts }) => (counts === null ? [] : [{ code, counts }]));
  if (counted.length === 0) {
    // Platforms that answered, without the counts of the brands: not collected. No platform answered: no answers
    const answered = context.scope.some((code) => cells.some((engine) => engine.engine_code === code));
    return { state: 'unknown', kind: answered ? 'not_collected' : 'no_answers' };
  }
  const rated = counted.flatMap(({ code, counts }) => {
    const share = shareOfCounts(counts);
    return share === null ? [] : [{ code, counts, share }];
  });
  const { value } = equalWeightAverage(rated.map((entry) => entry.share));
  if (value !== null) {
    return {
      state: 'ok',
      value,
      parts: rated.map(({ code, counts }) => ({
        code,
        count: context.t('prompts.metrics.shareOfVoice.basis', { k: counts.k, n: counts.n }),
      })),
    };
  }
  const mentions = Math.max(...counted.map(({ counts }) => counts.n));
  return mentions === 0 ? { state: 'unknown', kind: 'no_brand' } : { state: 'insufficient', answers: mentions };
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
