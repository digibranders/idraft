import { record, type SeriesOption, type TooltipParam } from './chart-parts';
import { boundaryMarkLines, type ChartBoundary } from '@/lib/charts/boundaries';
import { escapeHtml } from '@/lib/charts/category-chart';
import { tipRowHtml, tipTitleHtml } from '@/lib/charts/tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';
import { formatInteger } from '@/lib/format';

/**
 * The rank axis of the share of voice rank card (D-8): the card's own `extendOption`, not `rankAxis` of
 * `lib/charts/rank-chart.ts`, which is a SERP depth axis with guide lines at 3, 10 and 20 and "Top 3" words. A share
 * rank has whole numbers from 1 (the highest share) down to the lowest rank drawn, and nothing else on the plot.
 */

/** One drawn brand in a week's tooltip: its rank (`null` when the week gives none) and the words of its row. */
export interface RankTipRow {
  seriesId: string;
  rank: number | null;
  text: string;
}

/** The words of one week's tooltip, finished by the card: the axis only orders and draws them. */
export interface RankTip {
  title: string;
  rows: readonly RankTipRow[];
  /** The denominator of the shares, or the sentence of a week with no rank. */
  footer: string | null;
}

export interface RankAxisExtras {
  /** The lowest rank drawn: the bottom of the axis. */
  maxRank: number;
  /** One per category of the x axis, in its order. */
  tips: readonly RankTip[];
  /** Drawn with `boundaryMarkLines`, on the categories of `base.xAxis.data`. */
  boundaries?: readonly ChartBoundary[] | undefined;
}

/** The categories of the x axis, which the boundaries sit on. */
function categoriesOf(base: Record<string, unknown>): string[] {
  const { data } = record(base.xAxis);
  return Array.isArray(data) ? data.filter((category): category is string => typeof category === 'string') : [];
}

/** Rank 1 first, a row with no rank last, equal ranks in the order the card gave them. */
const byRank = (a: RankTipRow, b: RankTipRow): number =>
  (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY);

export function rankAxisOption(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  { maxRank, tips, boundaries = [] }: RankAxisExtras,
): Record<string, unknown> {
  const shown = (Array.isArray(base.series) ? base.series : []) as SeriesOption[];
  const yAxis = record(base.yAxis);
  const formatter = (params: readonly TooltipParam[]): string => {
    const [first] = params;
    const index = first?.dataIndex ?? -1;
    const tip = tips[index];
    if (tip === undefined) return tipTitleHtml(first?.axisValueLabel ?? '');
    const rows = tip.rows
      .map((row) => ({ row, entry: shown.find((candidate) => candidate.id === row.seriesId) }))
      .filter(({ entry }) => entry !== undefined)
      .sort((a, b) => byRank(a.row, b.row))
      .map(({ row, entry }) => tipRowHtml(entry?.color ?? tokens.other, entry?.name ?? '', row.text, tokens));
    const footer =
      tip.footer === null
        ? ''
        : `<div style="margin-top:4px;color:${escapeHtml(tokens.foregroundSecondary)}">${escapeHtml(tip.footer)}</div>`;
    return `${tipTitleHtml(tip.title)}${rows.join('')}${footer}`;
  };
  const boundary = boundaryMarkLines(boundaries, categoriesOf(base), tokens);
  return {
    ...base,
    yAxis: {
      ...yAxis,
      inverse: true,
      min: 1,
      max: Math.max(2, maxRank),
      interval: 1,
      minInterval: 1,
      axisLabel: { ...record(yAxis.axisLabel), formatter: (rank: number): string => formatInteger(rank) },
    },
    tooltip: { ...record(base.tooltip), formatter },
    series: [...shown, ...(boundary === null ? [] : [boundary])],
  };
}
