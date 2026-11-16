import type { ReactElement } from 'react';

import type { LinkedKeywordVolume } from '../facts';
import { absenceOf, HatchedPill, Missing, notCollected, platformList, tipOf } from './metric-shared';
import type { MetricContext, UnknownCell } from './metric-shared';
import { col } from '@/components/app/data-table/columns';
import type { CellTip, DataTableColumn } from '@/components/app/data-table/types';
import { EMPTY_VALUE, formatList, formatPercent } from '@/lib/format';
import { MIN_OBSERVATIONS } from '@/lib/stats';

/**
 * A rate the metric columns of this folder show, whatever the source: the percent and the platforms it rests on with
 * the count behind each, a figure too thin for a rate, or the reason there is none (R2, R6).
 */
export type RateFigure =
  | { state: 'ok'; value: number; parts: readonly { code: string; count: string }[] }
  | { state: 'insufficient'; answers: number }
  | {
      state: 'unknown';
      /**
       * `not_collected`: the backend sends none. `not_loaded`: the counts have not arrived. `not_classified`: no platform in
       * view classifies the metric. `no_answers`: no valid answer. `no_brand`: valid answers, none naming a brand.
       */
      kind: 'not_collected' | 'not_loaded' | 'not_classified' | 'no_answers' | 'no_brand';
    };

export interface RateColumnSpec<TRow> {
  id: string;
  header: string;
  headerTooltip: string;
  priority: 1 | 2 | 3 | 4;
  width: number;
  figureOf: (row: TRow) => RateFigure;
  /** The keyword the row is linked to, for the reason of a Google AI Overview without answers. */
  link: (row: TRow) => LinkedKeywordVolume | null | undefined;
}

/**
 * A rate column: the equal-weight average of the platforms in view shown as a whole percent with no "average of N"
 * (which platforms it covers is in the tooltip), sorted high to low with the rows that have none last. The tooltip
 * lists each platform's own count: a pooled count beside an equal-weight percent would read as another rate (R3).
 */
export function rateMetricColumn<TRow>(context: MetricContext, spec: RateColumnSpec<TRow>): DataTableColumn<TRow> {
  const { t, locale } = context;
  const unknownOf = (row: TRow, figure: Extract<RateFigure, { state: 'unknown' }>): UnknownCell => {
    switch (figure.kind) {
      case 'not_collected':
        return notCollected(context);
      case 'not_loaded':
        return { label: EMPTY_VALUE, tip: t('prompts.columns.notLoadedTip') };
      case 'not_classified':
        return {
          label: EMPTY_VALUE,
          tip: t('prompts.metrics.notClassifiedTip', { platforms: platformList(context, context.scope) }),
        };
      case 'no_brand':
        return { label: EMPTY_VALUE, tip: t('prompts.columns.noBrandTip') };
      case 'no_answers': {
        const { label, tip } = absenceOf(context, spec.link(row));
        return { label, tip };
      }
    }
  };
  const base = col.volumeTrend<TRow>(
    spec.id,
    (row) => {
      const figure = spec.figureOf(row);
      return figure.state === 'ok' ? figure.value : null;
    },
    {
      header: spec.header,
      headerTooltip: spec.headerTooltip,
      priority: spec.priority,
      width: spec.width,
      // The cell is drawn below, for it has the thin state too
      known: () => null,
    },
  );
  return {
    ...base,
    cell: (row): ReactElement => {
      const figure = spec.figureOf(row);
      if (figure.state === 'ok') return <span className="num">{formatPercent(figure.value, { decimals: 0 })}</span>;
      if (figure.state === 'insufficient') return <HatchedPill>{t('prompts.metrics.notEnough')}</HatchedPill>;
      return <Missing label={unknownOf(row, figure).label} />;
    },
    cellTip: (row): CellTip => {
      const figure = spec.figureOf(row);
      if (figure.state === 'insufficient') {
        return { content: t('prompts.metrics.notEnoughTip', { answers: figure.answers, min: MIN_OBSERVATIONS }) };
      }
      if (figure.state === 'unknown') return tipOf(unknownOf(row, figure));
      const names = platformList(
        context,
        figure.parts.map((part) => part.code),
      );
      const counts = formatList(
        figure.parts.map((part) =>
          t('prompts.columns.engineCount', { engine: platformList(context, [part.code]), count: part.count }),
        ),
        locale,
      );
      return {
        content: counts,
        detail:
          figure.parts.length === 1
            ? t('prompts.rate.onlyTip', { engines: names })
            : t('prompts.rate.avgTip', { engines: names }),
      };
    },
  };
}
