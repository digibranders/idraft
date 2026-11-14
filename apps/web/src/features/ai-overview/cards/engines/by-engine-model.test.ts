import { describe, expect, it } from 'vitest';

import { buildByEngine, longRows } from './by-engine-model';
import { engineCells, promptRow, summaryOf } from './engines-fixtures';
import { buildAggregates, type OverviewAggregates } from '../../data/aggregates';
import { projectEngine } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, PromptsSummary, Schemas } from '@/lib/api/types';
import { engineRates } from '@/lib/rates/strip-model';
import { isDetectableChange } from '@/lib/stats';

const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];

function aggregatesOf(
  current: PromptsSummary,
  over: {
    previous?: PromptsSummary | null;
    chosen?: readonly string[] | null;
    off?: readonly EngineCode[];
    sources?: Schemas['SourcesMeta'] | null;
  } = {},
): OverviewAggregates {
  // The engines of the summary are the ones the project has on
  const {
    previous = null,
    chosen = null,
    off = ALL.filter((code) => !current.engine_codes.includes(code)),
    sources = null,
  } = over;
  return buildAggregates({
    current,
    previous,
    engines: ALL.map((code) => ({ ...projectEngine(code), is_enabled: !off.includes(code) })),
    chosenEngines: chosen,
    topicsKept: null,
    sources,
    fanout: null,
  });
}

const CODES = ['chatgpt_web', 'gemini_web'] as const;

/** Two engines over two prompts: ChatGPT names the brand more, Gemini cites it more. */
function twoEngines(): PromptsSummary {
  return summaryOf(
    [
      promptRow('p1', [
        engineCells('chatgpt_web', { mentioned: [6, 8], cited: [2, 8], shareOfVoice: [4, 8] }),
        engineCells('gemini_web', { mentioned: [2, 8], cited: [6, 8], shareOfVoice: [2, 8] }),
      ]),
      promptRow('p2', [
        engineCells('chatgpt_web', { mentioned: [4, 8], cited: [0, 8], shareOfVoice: [4, 8] }),
        engineCells('gemini_web', { mentioned: [4, 8], cited: [4, 8], shareOfVoice: [2, 8] }),
      ]),
    ],
    { codes: CODES },
  );
}

const sourcesOf = (own: number, competitor: number, thirdParty: number): Schemas['SourcesMeta'] =>
  ({
    by_role_by_engine: [
      {
        engine_code: 'chatgpt_web',
        own: { citation_units: own },
        competitor: { citation_units: competitor },
        third_party: { citation_units: thirdParty },
      },
    ],
  }) as unknown as Schemas['SourcesMeta'];

describe('buildByEngine', () => {
  it('has a row per asked engine with mention, citation and share of voice figures, counts and prompts', () => {
    const summary = twoEngines();
    const model = buildByEngine({ aggregates: aggregatesOf(summary), sources: 'notRead' });
    expect(model.rows.map((row) => [row.engineCode, row.label])).toEqual([
      ['chatgpt_web', 'ChatGPT'],
      ['gemini_web', 'Gemini'],
    ]);
    const [chatgpt] = model.rows;
    const strip = engineRates(summary.prompts, 'chatgpt_web');
    expect(chatgpt?.mention).toMatchObject({
      state: 'ok',
      value: strip.mentioned.value,
      answers: 16,
      successes: 10,
      prompts: 2,
    });
    expect(chatgpt?.citation).toMatchObject({ answers: 16, successes: 2 });
    expect(chatgpt?.shareOfVoice).toMatchObject({ answers: 16, successes: null });
    expect(chatgpt?.mention.interval).not.toBeNull();
    expect(chatgpt?.shareOfVoice.interval).toBeNull();
    expect(model.promptCount).toBe(2);
  });

  it('an engine outside the filter or off in the project has no row', () => {
    const summary = twoEngines();
    expect(
      buildByEngine({ aggregates: aggregatesOf(summary, { chosen: ['gemini_web'] }), sources: 'notRead' }).rows,
    ).toHaveLength(1);
    expect(
      buildByEngine({
        aggregates: aggregatesOf(summary, { off: ['gemini_web', 'google_ai_mode'] }),
        sources: 'notRead',
      }).rows.map((row) => row.engineCode),
    ).toEqual(['chatgpt_web']);
  });

  it('the equal-weight line averages the engines that have a value, names them, and exists from 2 values (R3)', () => {
    const model = buildByEngine({ aggregates: aggregatesOf(twoEngines()), sources: 'notRead' });
    const mention = model.averages.find((average) => average.metric === 'mention');
    // ChatGPT 10 of 16 prompts-weighted 62.5%, Gemini 6 of 16 37.5%: each engine counts once
    expect(mention).toEqual({ metric: 'mention', value: 0.5, engines: ['chatgpt_web', 'gemini_web'] });

    // One engine with a rate is no average: there is nothing to average with
    const thin = summaryOf(
      [
        promptRow('p1', [
          engineCells('chatgpt_web', { mentioned: [6, 8] }),
          engineCells('gemini_web', { mentioned: [1, 3] }),
        ]),
      ],
      { codes: CODES },
    );
    const one = buildByEngine({ aggregates: aggregatesOf(thin), sources: 'notRead' });
    expect(one.averages.find((average) => average.metric === 'mention')).toBeUndefined();
    // The thin engine has no rate and is left out of the average, never counted as 0
    expect(one.rows[1]?.mention).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
  });

  it('a delta is detectable only through isDetectableChange of the aggregates', () => {
    const before = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [20, 50], cited: [10, 50], shareOfVoice: [20, 50] })]),
    ]);
    const now = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [35, 50], cited: [11, 50], shareOfVoice: [30, 50] })]),
    ]);
    const model = buildByEngine({ aggregates: aggregatesOf(now, { previous: before }), sources: 'notRead' });
    const [row] = model.rows;
    expect(isDetectableChange({ k: 35, n: 50 }, { k: 20, n: 50 })).toBe(true);
    expect(row?.mention.change).toMatchObject({ unit: 'points', isDetectable: true });
    expect(row?.mention.change.value).toBeCloseTo(0.3, 10);
    // One point more of citation is within normal variation, and share of voice has no test at all
    expect(row?.citation.change.isDetectable).toBe(false);
    expect(row?.shareOfVoice.change.isDetectable).toBeNull();
    expect(row?.shareOfVoice.change.value).toBeCloseTo(0.2, 10);
  });

  it('has no change without a comparison, and the change has no value, never 0', () => {
    const row = buildByEngine({ aggregates: aggregatesOf(twoEngines()), sources: 'notRead' }).rows[0];
    expect(row?.mention.change).toMatchObject({ value: null, isDetectable: null });
  });

  it('own citation comes from the sources read and is not read while that read is absent', () => {
    const aggregates = aggregatesOf(twoEngines(), { sources: sourcesOf(6, 10, 24) });
    const read = buildByEngine({ aggregates, sources: 'read' });
    expect(read.rows[0]?.ownCitation).toEqual({ status: 'read', state: 'ok', value: 0.15, k: 6, n: 40 });
    // Gemini has no entry in the sources read: not read, never 0
    expect(read.rows[1]?.ownCitation).toEqual({ status: 'notRead' });
    expect(buildByEngine({ aggregates: aggregatesOf(twoEngines()), sources: 'notRead' }).rows[0]?.ownCitation).toEqual({
      status: 'notRead',
    });
    expect(buildByEngine({ aggregates, sources: 'brandedOnly' }).rows[0]?.ownCitation).toEqual({
      status: 'brandedOnly',
    });
  });

  it('an engine with no valid answers has no rate and says why', () => {
    const none = summaryOf([promptRow('p1', [engineCells('chatgpt_web', { mentioned: [0, 0, 5] })])]);
    const row = buildByEngine({ aggregates: aggregatesOf(none), sources: 'notRead' }).rows[0];
    expect(row?.mention).toMatchObject({ state: 'none', value: null, reason: 'noneValid' });
    expect(row?.validAnswers).toBe(0);
    expect(row?.allAnswers).toBe(5);
  });
});

describe('longRows', () => {
  it('has a row per engine and metric with k, n, prompts and the interval, and an unknown value is empty with a status', () => {
    const summary = summaryOf([
      promptRow('p1', [engineCells('chatgpt_web', { mentioned: [6, 8], cited: [1, 3], shareOfVoice: [4, 8] })]),
    ]);
    const model = buildByEngine({ aggregates: aggregatesOf(summary), sources: 'brandedOnly' });
    const rows = longRows(model);
    expect(rows.map((row) => [row.metric, row.status])).toEqual([
      ['mention', 'ok'],
      ['citation', 'insufficient'],
      ['shareOfVoice', 'ok'],
      ['ownCitation', 'branded_only'],
    ]);
    expect(rows[0]).toMatchObject({ engineCode: 'chatgpt_web', value: 0.75, k: 6, n: 8, prompts: 1 });
    expect(rows[0]?.interval).not.toBeNull();
    expect(rows[1]).toMatchObject({ value: null, k: 1, n: 3, interval: null });
    expect(rows[3]).toMatchObject({ value: null, k: null, n: null });
  });
});
