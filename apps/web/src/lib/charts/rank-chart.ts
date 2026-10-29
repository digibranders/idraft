import type { ChartTokens } from '@/lib/design/read-tokens';

export interface RankAxisExtras {
  depthMax: number;
  plotHeight: number;
  bands: readonly { from: number; to: number; depth: number }[];
  guide: (rank: number) => string;
  bandLabel: (depth: number) => string;
}

const GUIDES = [3, 10, 20] as const;

/**
 * Customizes an ECharts option for rank history: inverts yAxis, adds guide lines at 3, 10, 20,
 * and hatches beyond-depth bands.
 */
export function rankAxis(
  base: Record<string, unknown>,
  tokens: ChartTokens,
  extras: RankAxisExtras,
): Record<string, unknown> {
  const { depthMax, plotHeight, bands, guide, bandLabel } = extras;
  const customValues = (plotHeight < 200 ? [1, 10, 20] : [1, 3, 10, 20]).filter((v) => v <= depthMax);

  const existingY = (base.yAxis as Record<string, unknown> | undefined) ?? {};
  const existingGrid = (base.grid as Record<string, unknown> | undefined) ?? {};
  const existingSeries = Array.isArray(base.series) ? [...base.series] : [];

  const yAxis = {
    ...existingY,
    inverse: true,
    min: 1,
    max: depthMax,
    interval: undefined,
    axisLabel: {
      ...((existingY.axisLabel as Record<string, unknown> | undefined) ?? {}),
      customValues,
    },
  };

  const grid = {
    ...existingGrid,
    right: 52,
  };

  const visibleGuides = GUIDES.filter((g) => g <= depthMax);
  const markLine = {
    silent: true,
    symbol: 'none',
    data: visibleGuides.map((rank) => ({
      yAxis: rank,
      name: guide(rank),
      lineStyle: { type: 'dashed', width: 1, color: tokens.axis },
      label: {
        show: true,
        position: 'end',
        formatter: guide(rank),
        color: tokens.label,
        fontSize: 12,
        fontFamily: tokens.fontFamily,
      },
    })),
  };

  const markArea =
    bands.length === 0
      ? undefined
      : {
          silent: true,
          itemStyle: {
            color: tokens.rankBandNone,
            decal: {
              symbol: 'rect',
              rotation: Math.PI / 4,
            },
          },
          data: bands.map((band) => [
            { xAxis: band.from, yAxis: band.depth, name: bandLabel(band.depth) },
            { xAxis: band.to, yAxis: depthMax },
          ]),
        };

  if (existingSeries.length > 0 && typeof existingSeries[0] === 'object' && existingSeries[0] !== null) {
    existingSeries[0] = {
      ...existingSeries[0],
      markLine,
      ...(markArea ? { markArea } : {}),
    };
  }

  return {
    ...base,
    yAxis,
    grid,
    series: existingSeries,
  };
}
