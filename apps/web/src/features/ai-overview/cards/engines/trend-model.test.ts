import { describe, expect, it } from 'vitest';

import { engineCells, promptRow, summaryOf, week } from './engines-fixtures';
import {
  buildTrend,
  engineGate,
  panelsOf,
  projectWeeks,
  trendExport,
  trendSummary,
  type TrendWords,
} from './trend-model';
import { buildAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { MetricCell, PointPool, PromptsSummary } from '@/lib/api/types';
import { rateTipText, type RateTipWords } from '@/lib/charts/rate-tip';
import { engineRates } from '@/lib/rates/strip-model';

const RANGE = { from: '2026-10-16', to: '2026-11-12' };
const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';

const pool = (weeks: number): PointPool => ({
  weeks,
  reason: 'prompt_point',
  below_prompts: 10,
  window: { from: '2026-10-19', to: '2026-11-01', timezone: 'UTC' },
});

/** The cell of a topic or total point: prompt weighted, so its value is a mean of rates and `pooled` holds the answers. */
const weighted = (rates: number, prompts: number, successes: number, trials: number): MetricCell => ({
  value: prompts === 0 ? null : rates / prompts,
  numerator: rates,
  denominator: prompts,
  n_observations: trials,
  pooled: { successes, trials },
});

const WORDS: RateTipWords = {
  value: (ratio) => `${String(Math.round(ratio * 100))}%`,
  answers: (k, n) => `${String(k)} of ${String(n)} answers`,
  interval: (band) => `${String(Math.round(band.low * 100))}% to ${String(Math.round(band.high * 100))}%`,
  prompts: (count) => `${String(count)} prompts, each counts once`,
  thin: (n) => `${String(n)} answers`,
  pooled: (weeks) => `pooled over ${String(weeks)} weeks`,
  noAnswers: 'No answers',
};
const TREND_WORDS: TrendWords = {
  rate: WORDS,
  share: (value, n) => `${String(Math.round(value * 100))}%, ${String(n)} answers name a brand`,
  partial: 'partial week',
};

/** Two prompts of ChatGPT, one week each; the cells of the week are the prompt's own pooled counts. */
function oneWeek(): PromptsSummary {
  return summaryOf([
    promptRow('p1', [
      engineCells('chatgpt_web', {
        mentioned: [1, 4],
        cited: [2, 4],
        shareOfVoice: [1, 4],
        series: [week(W1, { mentioned: [1, 4], cited: [2, 4], shareOfVoice: [1, 4], prompts: 1 })],
      }),
    ]),
    promptRow('p2', [
      engineCells('chatgpt_web', {
        mentioned: [3, 4],
        cited: [0, 4],
        shareOfVoice: [3, 4],
        series: [week(W1, { mentioned: [3, 4], cited: [0, 4], shareOfVoice: [3, 4], prompts: 1 })],
      }),
    ]),
  ]);
}

describe('projectWeeks', () => {
  it("a point is the mean of the prompts' own rates with k and n summed from the same cells (R12)", () => {
    const summary = oneWeek();
    const [point] = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    const strip = engineRates(summary.prompts, 'chatgpt_web').mentioned;
    expect(point).toMatchObject({ weekStart: W1, value: 0.5, k: 4, n: 8, prompts: 2, thin: false });
    expect(point?.value).toBe(strip.value);
    expect(point?.k).toBe(strip.successes);
    expect(point?.n).toBe(strip.answers);
    expect(point?.band).not.toBeNull();
    // Citation reads the cited cell, not the mentioned one
    expect(projectWeeks(summary, 'chatgpt_web', 'citation', RANGE)[0]).toMatchObject({ value: 0.25, k: 2, n: 8 });
  });

  it('a prompt that answered more is not weighted more: the value is the mean of the rates, k and n are sums', () => {
    const summary = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { series: [week(W1, { mentioned: [1, 2] })] })]),
      promptRow('p2', [engineCells('chatgpt_web', { series: [week(W1, { mentioned: [9, 10] })] })]),
    ]);
    const [point] = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    expect(point?.value).toBeCloseTo(0.7, 10);
    expect(point).toMatchObject({ k: 10, n: 12 });
  });

  it('a share of voice point is numerator over denominator with no band and no k', () => {
    const [point] = projectWeeks(oneWeek(), 'chatgpt_web', 'share_of_voice', RANGE);
    expect(point).toMatchObject({ value: 0.5, k: null, n: 8, band: null, thin: false });
  });

  it('a point with fewer than 4 answers is thin with no band', () => {
    const summary = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { series: [week(W1, { mentioned: [1, 3] })] })]),
    ]);
    const [point] = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    expect(point).toMatchObject({ n: 3, thin: true, band: null });
    expect(point?.value).toBeCloseTo(1 / 3, 10);
  });

  it('a week without answers is a gap, never 0', () => {
    const summary = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          series: [week(W1, { mentioned: [2, 4] }), week(W2), week(W3, { mentioned: [1, 4] })],
        }),
      ]),
    ]);
    const points = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    expect(points[1]).toMatchObject({ weekStart: W2, value: null, k: null, n: 0, band: null, thin: false });
    const model = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    expect(model.series[0]?.points[1]?.value).toBeNull();
    // A gap draws no point at all
    expect(panelsOf(model, () => 'ChatGPT', TREND_WORDS)[0]?.points[1]).toBeNull();
  });

  it('a point that pools several weeks says so, and one that holds its own week says nothing of pooling', () => {
    const summary = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          series: [
            week(W1, { mentioned: [2, 4], pool: pool(1) }),
            week(W2, { mentioned: [4, 8], pool: pool(2) }),
            week(W3, { mentioned: [6, 12], pool: pool(3) }),
          ],
        }),
      ]),
    ]);
    const points = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    expect(points.map((point) => point.pooledWeeks)).toEqual([null, 2, 3]);
    const model = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    const [panel] = panelsOf(model, () => 'ChatGPT', TREND_WORDS);
    expect(panel?.cellText[2]).toContain('pooled over 3 weeks');
    expect(panel?.cellText[0]).not.toContain('pooled');
  });

  it("a point of summary.total whose is_pooled is false is the week's own and says nothing about pooling", () => {
    const base = summaryOf([], { codes: ['chatgpt_web'] });
    const total: PromptsSummary = {
      ...base,
      total: {
        engines: [
          {
            ...engineCells('chatgpt_web'),
            series: [
              { ...week(W1, { prompts: 12 }), mentioned: weighted(6, 12, 30, 60) },
              { ...week(W2, { prompts: 12, pool: pool(4) }), mentioned: weighted(5, 12, 100, 240) },
            ],
          },
        ],
        last_observed_at: null,
        last_valid_at: null,
        prompt_count: 12,
      },
    };
    const model = buildTrend({
      current: total,
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    expect(model.source).toBe('total');
    const [first, second] = model.series[0]?.points ?? [];
    expect(first).toMatchObject({ value: 0.5, k: 30, n: 60, prompts: 12, pooledWeeks: null });
    expect(second).toMatchObject({ n: 240, k: 100, pooledWeeks: 4 });
    expect(model.series[0]?.points.every((point) => point.band !== null)).toBe(true);
  });

  it('prompt rows are the source when the summary carries no total', () => {
    expect(
      buildTrend({ current: oneWeek(), previous: null, asked: ['chatgpt_web'], metric: 'mention', range: RANGE })
        .source,
    ).toBe('prompts');
  });

  it('the first and last weeks are partial when the window cuts them', () => {
    const summary = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          series: ['2026-10-12', W1, W2, W3, '2026-11-09'].map((start) => week(start, { mentioned: [2, 4] })),
        }),
      ]),
    ]);
    const points = projectWeeks(summary, 'chatgpt_web', 'mention', RANGE);
    expect(points.map((point) => point.partial)).toEqual([true, false, false, false, true]);
    const model = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    const [panel] = panelsOf(model, () => 'ChatGPT', TREND_WORDS);
    expect(panel?.cellText[0]).toContain('partial week');
    expect(panel?.cellText[1]).not.toContain('partial week');
  });
});

describe('buildTrend', () => {
  it('draws a panel only for an engine that is asked', () => {
    const summary = summaryOf(
      [
        promptRow('p1', [
          engineCells('chatgpt_web', { series: [week(W1, { mentioned: [2, 4] })] }),
          engineCells('gemini_web', { series: [week(W1, { mentioned: [1, 4] })] }),
        ]),
      ],
      { codes: ['chatgpt_web', 'gemini_web'] },
    );
    const only = buildTrend({
      current: summary,
      previous: null,
      asked: ['gemini_web'],
      metric: 'mention',
      range: RANGE,
    });
    expect(only.series.map((series) => series.engineCode)).toEqual(['gemini_web']);
    const both = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web', 'gemini_web'],
      metric: 'mention',
      range: RANGE,
    });
    expect(both.series.map((series) => series.engineCode)).toEqual(['chatgpt_web', 'gemini_web']);
  });

  it('every panel has a point for every week of the chart, a gap where the engine has none', () => {
    const summary = summaryOf(
      [
        promptRow('p1', [
          engineCells('chatgpt_web', { series: [week(W1, { mentioned: [2, 4] }), week(W2, { mentioned: [2, 4] })] }),
          engineCells('gemini_web', { series: [week(W2, { mentioned: [1, 4] })] }),
        ]),
      ],
      { codes: ['chatgpt_web', 'gemini_web'] },
    );
    const model = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web', 'gemini_web'],
      metric: 'mention',
      range: RANGE,
    });
    expect(model.weeks).toEqual([W1, W2]);
    expect(model.series.map((series) => series.points.length)).toEqual([2, 2]);
    expect(model.series[1]?.points[0]?.value).toBeNull();
    expect(model.weeksWithAnswers).toBe(2);
  });

  it('the previous series aligns on the week index and is values only', () => {
    const current = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', { series: [week(W1, { mentioned: [2, 4] }), week(W2, { mentioned: [3, 4] })] }),
      ]),
    ]);
    const previous = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          series: [
            week('2026-09-21', { mentioned: [1, 4] }),
            week('2026-09-28', { mentioned: [1, 3] }),
            week('2026-10-05', { mentioned: [2, 4] }),
          ],
        }),
      ]),
    ]);
    const model = buildTrend({ current, previous, asked: ['chatgpt_web'], metric: 'mention', range: RANGE });
    // A thin week has no value to draw against, a week beyond the current weeks has no category
    expect(model.series[0]?.previous).toEqual([0.25, null]);
    const [panel] = panelsOf(model, () => 'ChatGPT', TREND_WORDS);
    expect(panel?.previous).toEqual([0.25, null]);
    expect(
      panelsOf(
        buildTrend({ current, previous: null, asked: ['chatgpt_web'], metric: 'mention', range: RANGE }),
        () => 'ChatGPT',
        TREND_WORDS,
      )[0]?.previous,
    ).toBeUndefined();
  });

  it('counts weeks with answers, so a card can say that a trend needs two', () => {
    const one = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { series: [week(W1, { mentioned: [2, 4] })] })]),
    ]);
    expect(
      buildTrend({ current: one, previous: null, asked: ['chatgpt_web'], metric: 'mention', range: RANGE })
        .weeksWithAnswers,
    ).toBe(1);
    const none = summaryOf([promptRow('p1', [engineCells('chatgpt_web')])]);
    expect(
      buildTrend({ current: none, previous: null, asked: ['chatgpt_web'], metric: 'mention', range: RANGE }),
    ).toMatchObject({
      weeks: [],
      weeksWithAnswers: 0,
    });
  });

  it('says when the tracked set changed inside the window', () => {
    const changed = { ...oneWeek(), entity_config_versions: [3, 4] };
    expect(
      buildTrend({ current: changed, previous: null, asked: ['chatgpt_web'], metric: 'share_of_voice', range: RANGE })
        .entitiesChanged,
    ).toBe(true);
    expect(
      buildTrend({ current: oneWeek(), previous: null, asked: ['chatgpt_web'], metric: 'share_of_voice', range: RANGE })
        .entitiesChanged,
    ).toBe(false);
  });
});

describe('panelsOf', () => {
  it('writes the tip with the counts, the prompts and the interval, and the Table words equal it (R1)', () => {
    const model = buildTrend({
      current: oneWeek(),
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    const [panel] = panelsOf(model, () => 'ChatGPT', TREND_WORDS);
    const point = panel?.points[0];
    expect(point?.tip).toBe(
      rateTipText(
        { value: 0.5, k: 4, n: 8, prompts: 2, band: point?.band ?? null, thin: false, pooledWeeks: undefined },
        WORDS,
      ),
    );
    expect(panel?.cellText).toEqual([point?.tip]);
    expect(panel).toMatchObject({ id: 'chatgpt_web', name: 'ChatGPT', role: { kind: 'brand' } });
  });

  it('a thin point says its answers and no percent, and share of voice says the answers that name a brand', () => {
    const thin = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', { series: [week(W1, { mentioned: [1, 3], shareOfVoice: [1, 3] })] }),
      ]),
    ]);
    const mention = panelsOf(
      buildTrend({ current: thin, previous: null, asked: ['chatgpt_web'], metric: 'mention', range: RANGE }),
      () => 'ChatGPT',
      TREND_WORDS,
    );
    expect(mention[0]?.points[0]).toMatchObject({ thin: true, band: null, tip: '3 answers' });
    const share = panelsOf(
      buildTrend({
        current: oneWeek(),
        previous: null,
        asked: ['chatgpt_web'],
        metric: 'share_of_voice',
        range: RANGE,
      }),
      () => 'ChatGPT',
      TREND_WORDS,
    );
    expect(share[0]?.points[0]).toMatchObject({ band: null, tip: '50%, 8 answers name a brand' });
  });
});

describe('trendSummary', () => {
  it("is the aggregates' window figures: rate, count, change in points and whether it is detectable (parity with the strip)", () => {
    const current = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [35, 50], cited: [10, 50], shareOfVoice: [20, 50] })]),
    ]);
    const previous = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [20, 50], cited: [10, 50], shareOfVoice: [20, 50] })]),
    ]);
    const aggregates = buildAggregates({
      current,
      previous,
      engines: [projectEngine('chatgpt_web')],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    const [item] = trendSummary(aggregates, ['chatgpt_web'], 'mention');
    const engine = aggregates.engines[0];
    expect(item).toMatchObject({ engineCode: 'chatgpt_web', state: 'ok', value: 0.7, k: 35, n: 50, prompts: 1 });
    expect(item?.change).toEqual(engine?.change.mentioned);
    expect(item?.change?.delta).toBeCloseTo(0.3, 10);
    expect(item?.change?.detectable).toBe(true);
    // Citation did not move, and share of voice has no test
    expect(trendSummary(aggregates, ['chatgpt_web'], 'citation')[0]?.change?.detectable).toBe(false);
    expect(trendSummary(aggregates, ['chatgpt_web'], 'share_of_voice')[0]).toMatchObject({ k: null, n: 50 });
    expect(trendSummary(aggregates, ['chatgpt_web'], 'share_of_voice')[0]?.change?.detectable).toBeNull();
  });

  it('has no change without a comparison, and a state for an engine with too few or no answers', () => {
    const current = summaryOf(
      [promptRow('p1', [engineCells('chatgpt_web', { mentioned: [1, 3] }), engineCells('gemini_web')])],
      { codes: ['chatgpt_web', 'gemini_web'] },
    );
    const aggregates = buildAggregates({
      current,
      previous: null,
      engines: [projectEngine('chatgpt_web'), projectEngine('gemini_web')],
      chosenEngines: null,
      topicsKept: null,
      sources: null,
      fanout: null,
    });
    const items = trendSummary(aggregates, ['chatgpt_web', 'gemini_web'], 'mention');
    expect(items.map((item) => [item.state, item.change])).toEqual([
      ['insufficient', null],
      ['none', null],
    ]);
    expect(items[0]).toMatchObject({ n: 3, value: null });
  });
});

describe('trendExport', () => {
  it('has a row for each week and engine, an unknown value empty with a status, never 0', () => {
    const summary = summaryOf([
      promptRow('p1', [
        engineCells('chatgpt_web', {
          series: [week(W1, { mentioned: [2, 4] }), week(W2), week(W3, { mentioned: [1, 3] })],
        }),
      ]),
    ]);
    const model = buildTrend({
      current: summary,
      previous: null,
      asked: ['chatgpt_web'],
      metric: 'mention',
      range: RANGE,
    });
    const block = trendExport(model, () => 'ChatGPT');
    expect(block.header).toEqual([
      'week',
      'engine',
      'value_percent',
      'k',
      'n',
      'prompts',
      'interval_low_percent',
      'interval_high_percent',
      'pooled_weeks',
      'partial_week',
      'status',
    ]);
    expect(block.rows.map((row) => [row[0], row[2], row[4], row[10]])).toEqual([
      [W1, 50, 4, 'ok'],
      [W2, null, 0, 'no_answers'],
      [W3, null, 3, 'insufficient'],
    ]);
  });
});

describe('engineGate', () => {
  const engines = [projectEngine('chatgpt_web'), { ...projectEngine('gemini_web'), is_enabled: false }];
  it('is asked, off in the project, or outside the page filter, in that order of precedence', () => {
    expect(engineGate('chatgpt_web', engines, null)).toBe('asked');
    expect(engineGate('gemini_web', engines, null)).toBe('off');
    expect(engineGate('google_ai_mode', engines, null)).toBe('off');
    expect(engineGate('chatgpt_web', engines, ['gemini_web'])).toBe('outsideFilter');
    expect(engineGate('gemini_web', engines, ['chatgpt_web'])).toBe('off');
  });
});
