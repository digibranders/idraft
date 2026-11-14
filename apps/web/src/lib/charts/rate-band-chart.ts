import { boundaryMarkLines, type ChartBoundary } from './boundaries';
import { smallSamplePoint } from './small-sample';
import { tipRowHtml, tipTitleHtml } from './tooltip-row';
import type { ChartTokens } from '@/lib/design/read-tokens';

/**
 * A line chart of rates (0 to 1) with a 95 percent interval band around each series (15-data-visualization.md
 * sections 4 and 7): the band is the series colour at 12 percent (18 percent in the dark theme); a point over too few
 * answers is a hollow 5 px circle with no band; a week with no value is a gap. It extends the option of
 * `categoryChartOption`, which a `ChartFrame` builds, and says the counts of each point in its tooltip.
 */

/** One point of one series, as the band chart needs it. */
export interface RateBandPoint {
  value: number | null;
  /** `null` for a point with no interval (too few answers, or none). */
  band: { low: number; high: number } | null;
  /** Over too few answers for an interval: drawn hollow. */
  thin: boolean;
  /** The finished words of the point for the tooltip: "62%, 5 of 8 answers". */
  tip: string;
}

export interface RateBandExtras {
  /** By series id; one entry for each category, `null` where the series has no point. */
  points: Readonly<Record<string, readonly (RateBandPoint | null)[]>>;
  /** The top of the axis, a ratio. */
  ceiling: number;
  dark: boolean;
  /** The title of the tooltip for each category, where the category's own label is not all there is to say. */
  titles?: readonly string[] | undefined;
  /**
   * The id of the previous period's series (a `reference` series of the frame, so it has its legend entry, Table
   * column and CSV column): it gets no band, and its tooltip row comes after those of the engines.
   */
  previousId?: string | undefined;
  /** Drawn with `boundaryMarkLines` on the categories of `base.xAxis.data`. */
  boundaries?: readonly ChartBoundary[] | undefined;
}

const BAND_OPACITY = { light: 0.12, dark: 0.18 } as const;

interface SeriesOption {
  id?: string;
  name?: string;
  color?: string;
  symbol?: string;
  data?: readonly unknown[];
  [key: string]: unknown;
}

interface TooltipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}

/** The categories of the x axis, which the boundaries sit on. */
function categoriesOf(base: Record<string, unknown>): string[] {
  const { xAxis } = base;
  const data = typeof xAxis === 'object' && xAxis !== null && 'data' in xAxis ? xAxis.data : undefined;
  return Array.isArray(data) ? data.filter((category): category is string => typeof category === 'string') : [];
}

export function rateBandOption(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  { points, ceiling, dark, titles, previousId, boundaries = [] }: RateBandExtras,
): Record<string, unknown> {
  const shown = (Array.isArray(base.series) ? base.series : []) as SeriesOption[];
  const opacity = dark ? BAND_OPACITY.dark : BAND_OPACITY.light;
  const isPrevious = (entry: SeriesOption): boolean => previousId !== undefined && entry.id === previousId;

  const lines = shown.map((entry) => {
    const own = points[entry.id ?? ''] ?? [];
    return {
      ...entry,
      data: (entry.data ?? []).map((value, index) => {
        const at = own[index];
        // Hollow, and still the marker shape of its engine: the shapes tell the series apart without colour
        return at?.thin === true && typeof value === 'number'
          ? smallSamplePoint(value, entry.symbol ?? 'circle', entry.color ?? tokens.other, tokens)
          : value;
      }),
    };
  });

  // The lower edge is a stacked series with no line and no fill, the span above it is filled: the area between them
  const bands = shown.flatMap((entry) => {
    const own = points[entry.id ?? ''] ?? [];
    if (isPrevious(entry) || !own.some((at) => at?.band != null)) return [];
    const common = { type: 'line', stack: `${entry.id ?? ''}:band`, symbol: 'none', silent: true, connectNulls: false };
    return [
      {
        ...common,
        id: `${entry.id ?? ''}:band-low`,
        data: own.map((at) => at?.band?.low ?? null),
        lineStyle: { opacity: 0 },
      },
      {
        ...common,
        id: `${entry.id ?? ''}:band`,
        data: own.map((at) => (at?.band == null ? null : at.band.high - at.band.low)),
        lineStyle: { opacity: 0 },
        areaStyle: { color: entry.color, opacity },
      },
    ];
  });

  const baseTooltip = (base.tooltip as Record<string, unknown> | undefined) ?? {};
  const formatter = (params: readonly TooltipParam[]): string => {
    const [first] = params;
    const index = first?.dataIndex ?? -1;
    // Best first (15-data-visualization.md, the time series tooltip): a point with no value comes last, and the
    // previous period after every engine
    const ranked = shown
      .flatMap((entry) => {
        const at = points[entry.id ?? '']?.[index];
        return at == null ? [] : [{ entry, at }];
      })
      .sort(
        (a, b) => Number(isPrevious(a.entry)) - Number(isPrevious(b.entry)) || (b.at.value ?? -1) - (a.at.value ?? -1),
      );
    const rows = ranked.map(({ entry, at }) =>
      tipRowHtml(entry.color ?? tokens.other, entry.name ?? '', at.tip, tokens),
    );
    return `${tipTitleHtml(titles?.[index] ?? first?.axisValueLabel ?? '')}${rows.join('')}`;
  };

  const boundary = boundaryMarkLines(boundaries, categoriesOf(base), tokens);

  return {
    ...base,
    yAxis: { ...((base.yAxis as Record<string, unknown> | undefined) ?? {}), min: 0, max: ceiling },
    tooltip: { ...baseTooltip, formatter },
    series: [...lines, ...bands, ...(boundary === null ? [] : [boundary])],
  };
}
