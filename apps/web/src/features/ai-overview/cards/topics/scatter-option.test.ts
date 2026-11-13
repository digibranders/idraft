import { describe, expect, it } from 'vitest';

import type { TopicNode } from './model-types';
import { scatterOption, type ScatterWords } from './scatter-option';
import { scatterModel } from './scatter-model';
import { engine, weighted } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { ChartTokens } from '@/lib/design/read-tokens';

const TOKENS: ChartTokens = {
  palette: ['#c1', '#c2', '#c3', '#c4', '#c5', '#c6'],
  axis: '#axis',
  label: '#label',
  fontFamily: 'Inter',
  other: '#other',
  reference: '#reference',
  grid: '#grid',
  band: '#band',
  rankBandNone: '#none',
  surfaceElevated: '#elevated',
  border: '#border',
  borderStrong: '#strong',
  foreground: '#fg',
  foregroundSecondary: '#fg2',
  foregroundMuted: '#muted',
};

const WORDS: ScatterWords = {
  series: 'Topics',
  mention: 'Mention',
  citation: 'Citation',
  reference: 'Cited as often as named',
  rate: (ratio) => `${String(Math.round(ratio * 100))}%`,
  value: (value) =>
    `${String(Math.round((value.value ?? 0) * 100))}%, ${String(value.successes)} of ${String(value.answers)}`,
  prompts: (count) => `${String(count)} prompts`,
};

function leaf(
  name: string,
  prompts: number,
  mention: readonly [number, number],
  citation: readonly [number, number],
): TopicNode {
  return {
    key: name,
    termId: name,
    name,
    path: [name],
    parentKey: null,
    level: 1,
    promptCount: prompts,
    engines: [
      engine('chatgpt_web', {
        mentioned: weighted(mention[0], mention[1], prompts),
        cited: weighted(citation[0], citation[1], prompts),
      }),
    ],
    members: null,
    lastValidAt: null,
    children: [],
  };
}

const model = scatterModel(
  [leaf('SEO tools', 17, [64, 136], [16, 136]), leaf('Email', 4, [40, 80], [30, 80])],
  'chatgpt_web',
);
const build = (nodes = model): Record<string, unknown> =>
  scatterOption({ points: nodes.points, ceiling: nodes.ceiling }, TOKENS, WORDS);

interface SeriesOut {
  type: string;
  data: { value: [number, number]; symbolSize: number }[];
  itemStyle: { color: string; borderColor: string; borderWidth: number; opacity: number };
  emphasis: { itemStyle: { color: string; opacity: number } };
  markLine: {
    silent: boolean;
    symbol: string;
    lineStyle: { color: string; type: string; width: number };
    data: { coord: [number, number] }[][];
  };
}
const seriesOf = (option: Record<string, unknown>): SeriesOut[] => option.series as SeriesOut[];
const tooltipOf = (
  option: Record<string, unknown>,
): { formatter: (params: { dataIndex: number }) => string; trigger: string } =>
  option.tooltip as { formatter: (params: { dataIndex: number }) => string; trigger: string };

describe('scatterOption', () => {
  it('one scatter series with the points', () => {
    const series = seriesOf(build());
    expect(series).toHaveLength(1);
    expect(series[0]?.type).toBe('scatter');
    expect(series[0]?.data.map((entry) => entry.value)).toEqual(model.points.map((point) => [point.x, point.y]));
    expect(series[0]?.data.map((entry) => entry.symbolSize)).toEqual(model.points.map((point) => point.size));
  });

  it('puts mention on x and citation on y, both from 0 to the one ceiling', () => {
    const option = build();
    expect(option.xAxis).toMatchObject({ type: 'value', min: 0, max: model.ceiling });
    expect(option.yAxis).toMatchObject({ type: 'value', min: 0, max: model.ceiling });
  });

  it('a diagonal reference line', () => {
    const line = seriesOf(build())[0]?.markLine;
    // From the corner to the corner of the one axis: cited as often as named
    expect(line?.data).toEqual([[{ coord: [0, 0] }, { coord: [model.ceiling, model.ceiling] }]]);
    expect(line?.lineStyle).toMatchObject({ color: '#reference', type: 'dashed', width: 1 });
    expect(line?.silent).toBe(true);
    expect(line?.symbol).toBe('none');
  });

  it('colours come from the tokens', () => {
    const [series] = seriesOf(build());
    expect(series?.itemStyle).toMatchObject({
      color: '#reference',
      borderColor: '#elevated',
      borderWidth: 1,
      opacity: 0.6,
    });
    expect(series?.emphasis.itemStyle).toMatchObject({ color: '#c1', opacity: 1 });
    expect(JSON.stringify(build())).toContain('#grid');
    expect(JSON.stringify(build())).toContain('#label');
    expect(tooltipOf(build()).trigger).toBe('item');
  });

  it('the tooltip says the topic, mention and citation with their counts, and the prompts', () => {
    const html = tooltipOf(build()).formatter({ dataIndex: 0 });
    expect(html).toContain('SEO tools');
    expect(html).toContain('Mention');
    expect(html).toContain('47%, 64 of 136');
    expect(html).toContain('Citation');
    expect(html).toContain('12%, 16 of 136');
    expect(html).toContain('17 prompts');
  });

  it('the tooltip text is plain and escaped', () => {
    const hostile = scatterModel([leaf('<img src=x onerror=alert(1)>', 5, [5, 10], [2, 10])], 'chatgpt_web');
    const html = tooltipOf(build(hostile)).formatter({ dataIndex: 0 });
    expect(html).not.toContain('<img');
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });

  it('a point that does not exist has no tooltip', () => {
    expect(tooltipOf(build()).formatter({ dataIndex: 99 })).toBe('');
  });

  it('no animation', () => {
    expect(build().animation).toBe(false);
  });

  it('names the axes and writes their ticks as percents', () => {
    const option = build();
    expect(option.xAxis).toMatchObject({ name: 'Mention' });
    expect(option.yAxis).toMatchObject({ name: 'Citation' });
    const label = (option.xAxis as { axisLabel: { formatter: (value: number) => string } }).axisLabel;
    expect(label.formatter(0.5)).toBe('50%');
  });
});
