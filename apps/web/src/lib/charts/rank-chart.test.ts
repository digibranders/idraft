import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { rankAxis } from './rank-chart';
import type { ChartTokens } from '@/lib/design/read-tokens';

const tokens: ChartTokens = {
  palette: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'],
  axis: 'chart-axis',
  label: 'chart-label',
  fontFamily: 'Inter',
  other: 'chart-other',
  reference: 'chart-reference',
  grid: 'chart-grid',
  band: 'chart-band',
  rankBandNone: 'chart-rank-band-none',
  surfaceElevated: 'chart-surface-elevated',
  border: 'chart-border',
  borderStrong: 'chart-border-strong',
  foreground: 'chart-foreground',
  foregroundSecondary: 'chart-foreground-secondary',
};

const TICKS = z.object({ yAxis: z.object({ axisLabel: z.object({ customValues: z.array(z.number()) }) }) });
const AREAS = z.object({
  markArea: z.object({ data: z.array(z.tuple([z.object({ name: z.string().optional() }), z.unknown()])) }),
});
const AREA_LABEL = z.object({ markArea: z.object({ label: z.record(z.string(), z.unknown()) }) });
const GUIDES = z.object({
  markLine: z.object({ data: z.array(z.object({ yAxis: z.number(), label: z.object({ show: z.boolean() }) })) }),
});
const TOOLTIP = z.object({
  formatter: z.function({ input: [z.array(z.object({ dataIndex: z.number() }))], output: z.string() }),
});

const firstSeries = (option: Record<string, unknown>): unknown =>
  Array.isArray(option.series) ? option.series[0] : undefined;

const base = {
  yAxis: { type: 'value' },
  grid: { right: 16 },
  series: [{ id: 'own', type: 'line', data: [3, null] }],
};

describe('rankAxis', () => {
  it('inverts the axis from 1 to the depth shown, with labels at 1, 3, 10 and 20', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 240,
      bands: [],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => 'Not in top 20',
    });
    expect(option.yAxis).toMatchObject({ inverse: true, min: 1, max: 20 });
    expect(option.grid).toMatchObject({ right: 52 });
  });

  it('drops the label at 3 below 200 px of plot but keeps the Top 3 guide', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => '',
    });
    const guides = (option.series as { markLine?: { data: { yAxis: number }[] } }[])[0]?.markLine?.data.map(
      (line) => line.yAxis,
    );
    expect(guides).toEqual([3, 10, 20]);
  });

  it('hatches a middle run from its depth to the bottom of the axis with 0.5 category padding', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 2, to: 4, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 1.5, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 4.5, yAxis: 50 },
      ],
    ]);
  });

  it('clamps a run at the start to 0 to prevent overshooting the left plot edge', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 0, to: 2, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 0, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 2.5, yAxis: 50 },
      ],
    ]);
  });

  it('clamps a run at the end to categoriesCount minus 1 to prevent overshooting the right plot edge', () => {
    const multiBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2', 'Oct 3', 'Oct 4', 'Oct 5', 'Oct 6'] },
    };
    const option = rankAxis(multiBase, tokens, {
      depthMax: 50,
      plotHeight: 240,
      bands: [{ from: 3, to: 5, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([
      [
        { xAxis: 2.5, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 5, yAxis: 50 },
      ],
    ]);
  });

  it('covers full category width for a single category run by omitting xAxis (documented ECharts behavior)', () => {
    const singleBase = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1'] },
    };
    const option = rankAxis(singleBase, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 0, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    expect(option.yAxis).toMatchObject({ max: 25 });
    const area = (option.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area).toEqual([[{ yAxis: 20, name: 'Not in top 20' }, { yAxis: 25 }]]);
  });

  it('ensures non-zero markArea height at depth 20 and depth 100 by extending effectiveDepthMax', () => {
    const base20 = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2'] },
    };
    const opt20 = rankAxis(base20, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 20 }],
      guide: () => '',
      bandLabel: (d) => `Not in top ${String(d)}`,
    });
    expect(opt20.yAxis).toMatchObject({ max: 25 });
    const area20 = (opt20.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area20).toEqual([
      [
        { xAxis: 0, yAxis: 20, name: 'Not in top 20' },
        { xAxis: 1, yAxis: 25 },
      ],
    ]);

    const base100 = {
      ...base,
      xAxis: { type: 'category', data: ['Oct 1', 'Oct 2'] },
    };
    const opt100 = rankAxis(base100, tokens, {
      depthMax: 100,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 100 }],
      guide: () => '',
      bandLabel: (d) => `Not in top ${String(d)}`,
    });
    expect(opt100.yAxis).toMatchObject({ max: 115 });
    const area100 = (opt100.series as { markArea?: { data: unknown[] } }[])[0]?.markArea?.data;
    expect(area100).toEqual([
      [
        { xAxis: 0, yAxis: 100, name: 'Not in top 100' },
        { xAxis: 1, yAxis: 115 },
      ],
    ]);
  });

  it('adds distinct markPoint for failed checks with coordinate at effectiveDepthMax', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 180,
      bands: [{ from: 0, to: 1, depth: 20 }],
      failedIndices: [1],
      failedLabel: 'Check failed',
      guide: () => '',
      bandLabel: () => '',
    });
    const markPoint = (option.series as { markPoint?: { data: unknown[] } }[])[0]?.markPoint?.data;
    expect(markPoint).toEqual([
      {
        coord: [1, 25],
        symbol: 'triangle',
        symbolSize: 8,
        itemStyle: { color: 'chart-other' },
        name: 'Check failed',
      },
    ]);
  });

  const areas = (option: Record<string, unknown>): { name?: string | undefined }[] => {
    const first = Array.isArray(option.series) ? option.series[0] : undefined;
    const parsed = AREAS.parse(first);
    return parsed.markArea.data.map(([corner]) => corner);
  };

  it('puts ticks at 50 and 100 when the axis reaches them, and at 200 only when the data does', () => {
    const labels = (depthMax: number): number[] =>
      TICKS.parse(
        rankAxis(base, tokens, {
          depthMax,
          plotHeight: 240,
          bands: [],
          guide: () => '',
          bandLabel: () => '',
        }),
      ).yAxis.axisLabel.customValues;
    expect(labels(20)).toEqual([1, 3, 10, 20]);
    // Rank 3 is left out once the axis is deep: its label would touch the 1 and the 10
    expect(labels(50)).toEqual([1, 10, 20, 50]);
    expect(labels(100)).toEqual([1, 10, 20, 50, 100]);
    // Ten ranks are about 11 px apart at 200: the 10 would touch the 1
    expect(labels(200)).toEqual([1, 20, 50, 100, 200]);
  });

  it('labels at most one of many bands, the widest, so the labels never print over each other', () => {
    const categories = Array.from({ length: 30 }, (_, n) => `Oct ${String(n + 1)}`);
    // Ten runs: the run at 12 to 17 is the widest
    const bands = Array.from({ length: 10 }, (_, n) => ({ from: n * 3, to: n * 3 + (n === 4 ? 5 : 0), depth: 100 }));
    const option = rankAxis({ ...base, xAxis: { type: 'category', data: categories } }, tokens, {
      depthMax: 100,
      plotHeight: 240,
      bands,
      guide: () => '',
      bandLabel: (depth) => `Not in top ${String(depth)}`,
    });
    const corners = areas(option);
    expect(corners).toHaveLength(10);
    expect(corners.filter((corner) => corner.name !== undefined)).toHaveLength(1);
    expect(corners[4]?.name).toBe('Not in top 100');
  });

  it('draws no band label at all when even the widest band is too narrow to hold its text', () => {
    const categories = Array.from({ length: 30 }, (_, n) => `Oct ${String(n + 1)}`);
    const option = rankAxis({ ...base, xAxis: { type: 'category', data: categories } }, tokens, {
      depthMax: 100,
      plotHeight: 240,
      bands: [
        { from: 2, to: 2, depth: 100 },
        { from: 9, to: 10, depth: 100 },
      ],
      guide: () => '',
      bandLabel: () => 'Not in top 100',
    });
    expect(areas(option).filter((corner) => corner.name !== undefined)).toHaveLength(0);
  });

  it('sets the band label at the bottom left of its band, away from the data and the axis labels', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 240,
      bands: [{ from: 0, to: 1, depth: 20 }],
      guide: () => '',
      bandLabel: () => 'Not in top 20',
    });
    const area = AREA_LABEL.parse(Array.isArray(option.series) ? option.series[0] : undefined);
    expect(area.markArea.label).toMatchObject({ show: true, position: 'insideBottomLeft' });
  });

  it('names the y axis "Rank (1 = best)" from the text it is given, and leaves it unnamed otherwise', () => {
    const extras = { depthMax: 20, plotHeight: 240, bands: [], guide: () => '', bandLabel: () => '' };
    expect(rankAxis(base, tokens, { ...extras, axisName: 'Rank (1 = best)' }).yAxis).toMatchObject({
      name: 'Rank (1 = best)',
    });
    expect(rankAxis(base, tokens, extras).yAxis).not.toHaveProperty('name');
    // The title has room above the plot, and a chart without one keeps its grid
    expect(rankAxis(base, tokens, { ...extras, axisName: 'Rank (1 = best)' }).grid).toMatchObject({ top: 24 });
    expect(rankAxis(base, tokens, extras).grid).not.toHaveProperty('top');
  });

  it('labels the Top 20 and Top 10 guides but not Top 3 when 100 ranks leave them too close', () => {
    const option = rankAxis(base, tokens, {
      depthMax: 100,
      plotHeight: 240,
      // A band at 100 stretches the axis to 115
      bands: [{ from: 0, to: 1, depth: 100 }],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => '',
    });
    const lines = GUIDES.parse(Array.isArray(option.series) ? option.series[0] : undefined).markLine.data;
    expect(lines.map((line) => [line.yAxis, line.label.show])).toEqual([
      [3, false],
      [10, true],
      [20, true],
    ]);
    const shallow = rankAxis(base, tokens, {
      depthMax: 20,
      plotHeight: 240,
      bands: [],
      guide: (rank) => `Top ${String(rank)}`,
      bandLabel: () => '',
    });
    const all = GUIDES.parse(Array.isArray(shallow.series) ? shallow.series[0] : undefined).markLine.data;
    expect(all.map((line) => line.label.show)).toEqual([true, true, true]);
  });

  it('adds a "Deep check" line to the tooltip of a deep check, and to no other', () => {
    const withTooltip = {
      ...base,
      tooltip: { formatter: () => '<div>Oct 3</div>' },
    };
    const option = rankAxis(withTooltip, tokens, {
      depthMax: 100,
      plotHeight: 240,
      bands: [],
      deepIndices: [2],
      deepLabel: 'Deep check <top 100>',
      guide: () => '',
      bandLabel: () => '',
    });
    const formatter = TOOLTIP.parse(option.tooltip).formatter;
    expect(formatter([{ dataIndex: 1 }])).toBe('<div>Oct 3</div>');
    const deep = formatter([{ dataIndex: 2 }]);
    expect(deep).toContain('<div>Oct 3</div>');
    expect(deep).toContain('Deep check &#60;top 100&#62;');
  });

  it('keeps a tick label exactly 16 px from the last one and drops it at 15.3 px', () => {
    const ticks = (depthMax: number): number[] =>
      TICKS.parse(
        rankAxis(base, tokens, { depthMax, plotHeight: 200, bands: [], guide: () => '', bandLabel: () => '' }),
      ).yAxis.axisLabel.customValues;
    // 176 px over 22 ranks is 8 px a rank: 1 and 3 are 16 px apart
    expect(ticks(23)).toEqual([1, 3, 10, 20]);
    // 176 px over 23 ranks is 7.65 px a rank: 15.3 px
    expect(ticks(24)).toEqual([1, 10, 20]);
  });

  it('keeps a guide label exactly 16 px from the next one and drops it at 15.9 px', () => {
    const labelled = (depthMax: number): boolean[] =>
      GUIDES.parse(
        firstSeries(
          rankAxis(base, tokens, {
            depthMax,
            plotHeight: 200,
            bands: [],
            guide: (rank) => `Top ${String(rank)}`,
            bandLabel: () => '',
          }),
        ),
      ).markLine.data.map((line) => line.label.show);
    // 176 px over 110 ranks is 1.6 px a rank: Top 10 is 16 px from Top 20
    expect(labelled(111)[1]).toBe(true);
    // 176 px over 111 ranks: 15.86 px
    expect(labelled(112)[1]).toBe(false);
  });
});
