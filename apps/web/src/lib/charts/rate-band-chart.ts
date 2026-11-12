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
}

const BAND_OPACITY = { light: 0.12, dark: 0.18 } as const;
const HOLLOW_SIZE = 5;

interface SeriesOption {
  id?: string;
  name?: string;
  color?: string;
  data?: readonly unknown[];
  [key: string]: unknown;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => `&#${String(character.codePointAt(0) ?? 0)};`);

interface TooltipParam {
  dataIndex?: number;
  axisValueLabel?: string;
}

export function rateBandOption(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  { points, ceiling, dark }: RateBandExtras,
): Record<string, unknown> {
  const shown = (Array.isArray(base.series) ? base.series : []) as SeriesOption[];
  const opacity = dark ? BAND_OPACITY.dark : BAND_OPACITY.light;

  const lines = shown.map((entry) => {
    const own = points[entry.id ?? ''] ?? [];
    return {
      ...entry,
      data: (entry.data ?? []).map((value, index) => {
        const at = own[index];
        return at?.thin === true && typeof value === 'number'
          ? {
              value,
              symbol: 'circle',
              symbolSize: HOLLOW_SIZE,
              itemStyle: { color: tokens.surfaceElevated, borderColor: entry.color, borderWidth: 2 },
            }
          : value;
      }),
    };
  });

  // The lower edge is a stacked series with no line and no fill, the span above it is filled: the area between them
  const bands = shown.flatMap((entry) => {
    const own = points[entry.id ?? ''] ?? [];
    if (!own.some((at) => at?.band != null)) return [];
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
    const rows = shown.flatMap((entry) => {
      const at = points[entry.id ?? '']?.[index];
      if (at == null) return [];
      return `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${escapeHtml(entry.color ?? tokens.other)}"></span><span style="color:${tokens.foregroundSecondary}">${escapeHtml(entry.name ?? '')}</span><span style="margin-left:auto;font-variant-numeric:tabular-nums">${escapeHtml(at.tip)}</span></div>`;
    });
    return `<div style="font-size:14px;line-height:20px;font-weight:600;margin-bottom:4px">${escapeHtml(first?.axisValueLabel ?? '')}</div>${rows.join('')}`;
  };

  return {
    ...base,
    yAxis: { ...((base.yAxis as Record<string, unknown> | undefined) ?? {}), min: 0, max: ceiling },
    tooltip: { ...baseTooltip, formatter },
    series: [...lines, ...bands],
  };
}
