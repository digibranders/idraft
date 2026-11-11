import type { ChartTokens } from '@/lib/design/read-tokens';

export interface RankAxisExtras {
  depthMax: number;
  plotHeight: number;
  bands: readonly { from: number; to: number; depth: number }[];
  failedIndices?: readonly number[];
  failedLabel?: string;
  guide: (rank: number) => string;
  bandLabel: (depth: number) => string;
  /** The y axis title, "Rank (1 = best)". */
  axisName?: string;
  /** Categories whose check was a deep check: their tooltip says so (15 section 7.4). */
  deepIndices?: readonly number[];
  deepLabel?: string;
  /** Events drawn as glyphs on the bottom edge of the plot (15 section 7 rule 6), one shape per family. */
  eventMarks?: readonly EventMark[];
}

/** The families of event the chart draws: a changed ranking URL, a move across the top 10, an AI Overview. */
export type EventFamily = 'url' | 'rank' | 'aio';

export interface EventMark {
  /** The check (category) the event belongs to. */
  index: number;
  family: EventFamily;
  /** What the glyph stands for, in words. */
  label: string;
}

/** A shape per family, so that the glyphs differ without colour (WCAG 1.4.1). */
const EVENT_SYMBOL: Readonly<Record<EventFamily, { symbol: string; size: number; offset?: [number, number] }>> = {
  url: { symbol: 'diamond', size: 10, offset: [0, -5] },
  // A pin stands on its point with its tip, so it needs no lift
  rank: { symbol: 'pin', size: 12 },
  aio: { symbol: 'rect', size: 10, offset: [0, -5] },
};

interface TooltipParam {
  dataIndex?: number;
}

const GUIDES = [3, 10, 20] as const;
/** Ticks of a deep axis: the standard depth is labeled by the guides, deeper depths by these. */
const DEEP_TICKS = [50, 100, 200] as const;
/** A guide or tick label needs this many pixels from the next one (12 px type plus air). */
const GUIDE_LABEL_GAP = 16;
/** A band is labeled only when it spans this share of the categories: narrower, the text would overflow it. */
const BAND_LABEL_MIN_SHARE = 0.15;
/** Room the plot keeps above and below its ranks for the axis labels. */
const PLOT_PADDING = 24;
/** Room above the plot for the axis title. */
const AXIS_NAME_ROOM = 24;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => `&#${String(character.codePointAt(0) ?? 0)};`);

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

  const existingY = (base.yAxis as Record<string, unknown> | undefined) ?? {};
  const existingGrid = (base.grid as Record<string, unknown> | undefined) ?? {};
  const existingSeries = Array.isArray(base.series) ? [...base.series] : [];

  const rawData = (base.xAxis as { data?: unknown[] } | undefined)?.data;
  const categoriesCount = Array.isArray(rawData) ? rawData.length : undefined;

  const maxBandDepth = bands.reduce((max, b) => Math.max(max, b.depth), 0);
  const effectiveDepthMax =
    bands.length > 0 && maxBandDepth >= depthMax
      ? maxBandDepth <= 20
        ? 25
        : maxBandDepth <= 50
          ? 60
          : maxBandDepth <= 100
            ? 115
            : maxBandDepth + 15
      : depthMax;

  // Tick labels from the top down, each at least 16 px from the last kept: on a deep axis 1, 3 and 10 would
  // touch, and ECharts then reserves a band above the plot to fit them (the plot shrinks to half its height)
  const pixelsPerRank = (plotHeight - PLOT_PADDING) / Math.max(1, effectiveDepthMax - 1);
  const customValues: number[] = [];
  for (const tick of [...(plotHeight < 200 ? [1, 10, 20] : [1, 3, 10, 20]), ...DEEP_TICKS]) {
    const last = customValues.at(-1);
    if (tick <= depthMax && (last === undefined || (tick - last) * pixelsPerRank >= GUIDE_LABEL_GAP)) {
      customValues.push(tick);
    }
  }

  const yAxis = {
    ...existingY,
    ...(extras.axisName === undefined
      ? {}
      : {
          name: extras.axisName,
          // At the start of an inverted axis, which is the top, above the plot
          nameLocation: 'start',
          nameGap: 8,
          nameTextStyle: { color: tokens.label, fontSize: 12, fontFamily: tokens.fontFamily, align: 'left' },
        }),
    inverse: true,
    min: 1,
    max: effectiveDepthMax,
    interval: undefined,
    axisLabel: {
      ...((existingY.axisLabel as Record<string, unknown> | undefined) ?? {}),
      customValues,
    },
  };

  const grid = {
    ...existingGrid,
    right: 52,
    // The axis title sits above the plot
    ...(extras.axisName === undefined ? {} : { top: AXIS_NAME_ROOM }),
  };

  const visibleGuides = GUIDES.filter((g) => g <= depthMax);
  // Labels are given out from the deepest guide up, and one that would sit within 16 px of a label already
  // given is left out: the guide line stays, so a deep axis does not pile its labels up
  const labeled = new Set<number>();
  for (const rank of [...visibleGuides].reverse()) {
    const nearest = Math.min(...[...labeled].map((other) => Math.abs(other - rank)), Number.POSITIVE_INFINITY);
    if (nearest * pixelsPerRank >= GUIDE_LABEL_GAP) labeled.add(rank);
  }
  const markLine = {
    silent: true,
    symbol: 'none',
    data: visibleGuides.map((rank) => ({
      yAxis: rank,
      name: guide(rank),
      lineStyle: { type: 'dashed', width: 1, color: tokens.axis },
      label: {
        show: labeled.has(rank),
        position: 'end',
        formatter: guide(rank),
        color: tokens.label,
        fontSize: 12,
        fontFamily: tokens.fontFamily,
      },
    })),
  };

  // One label, on the widest band and only if the text fits it: a label per band printed over each other
  const widest = bands.reduce<number>(
    (best, band, index) => (band.to - band.from > (bands[best]?.to ?? 0) - (bands[best]?.from ?? 0) ? index : best),
    0,
  );
  const widestBand = bands[widest];
  const labeledBand =
    widestBand !== undefined &&
    (categoriesCount === undefined || (widestBand.to - widestBand.from + 1) / categoriesCount >= BAND_LABEL_MIN_SHARE)
      ? widest
      : -1;

  const markArea =
    bands.length === 0
      ? undefined
      : {
          silent: true,
          // At the bottom left of the band: below the data and clear of the axis labels
          label: {
            show: true,
            position: 'insideBottomLeft',
            color: tokens.label,
            fontSize: 12,
            fontFamily: tokens.fontFamily,
          },
          itemStyle: {
            color: tokens.rankBandNone,
            decal: {
              symbol: 'rect',
              rotation: Math.PI / 4,
            },
          },
          data: bands.map((band, index) => {
            const isSingle = categoriesCount === 1;
            const x0 = band.from === 0 ? 0 : Math.max(0, band.from - 0.5);
            const x1 =
              categoriesCount !== undefined && band.to >= categoriesCount - 1 ? categoriesCount - 1 : band.to + 0.5;
            return [
              {
                ...(isSingle ? {} : { xAxis: x0 }),
                yAxis: band.depth,
                ...(index === labeledBand ? { name: bandLabel(band.depth) } : {}),
              },
              {
                ...(isSingle ? {} : { xAxis: x1 }),
                yAxis: effectiveDepthMax,
              },
            ];
          }),
        };

  const failedMarks = (extras.failedIndices ?? []).map((idx) => ({
    coord: [idx, effectiveDepthMax],
    symbol: 'triangle',
    symbolSize: 8,
    itemStyle: { color: tokens.other },
    name: extras.failedLabel ?? '',
  }));
  const eventMarks = (extras.eventMarks ?? []).map((mark) => {
    const shape = EVENT_SYMBOL[mark.family];
    return {
      coord: [mark.index, effectiveDepthMax],
      symbol: shape.symbol,
      symbolSize: shape.size,
      ...(shape.offset === undefined ? {} : { symbolOffset: shape.offset }),
      itemStyle: { color: tokens.foreground },
      name: mark.label,
    };
  });
  const markPoint =
    failedMarks.length + eventMarks.length === 0 ? undefined : { silent: true, data: [...failedMarks, ...eventMarks] };

  if (existingSeries.length > 0 && typeof existingSeries[0] === 'object' && existingSeries[0] !== null) {
    existingSeries[0] = {
      ...existingSeries[0],
      markLine,
      ...(markArea ? { markArea } : {}),
      ...(markPoint ? { markPoint } : {}),
    };
  }

  const baseTooltip = base.tooltip as { formatter?: (params: readonly TooltipParam[]) => string } | undefined;
  const deep = new Set(extras.deepIndices ?? []);
  const tooltip =
    baseTooltip?.formatter === undefined || deep.size === 0 || extras.deepLabel === undefined
      ? base.tooltip
      : {
          ...baseTooltip,
          formatter: (params: readonly TooltipParam[]): string => {
            const text = baseTooltip.formatter?.(params) ?? '';
            const isDeep = params.some((param) => param.dataIndex !== undefined && deep.has(param.dataIndex));
            return isDeep
              ? `${text}<div style="margin-top:4px;color:${tokens.foregroundSecondary}">${escapeHtml(extras.deepLabel ?? '')}</div>`
              : text;
          },
        };

  return {
    ...base,
    yAxis,
    grid,
    ...(tooltip === undefined ? {} : { tooltip }),
    series: existingSeries,
  };
}
