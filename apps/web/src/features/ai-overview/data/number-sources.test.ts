import { describe, expect, it } from 'vitest';

import { buildAggregates, type AggregateInputs, type OverviewAggregates } from './aggregates';
import { NUMBER_VALUE_SOURCE, readNumber, type NumberReading, type NumberSource } from './number-sources';
import { cell, engine, projectEngine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type { EngineCode, EngineSummary, MetricCell, PromptsSummary, Schemas } from '@/lib/api/types';
import { NUMBER_TYPES } from '@/lib/layouts/catalog';

const WINDOW = { from: '2026-10-16', to: '2026-11-12', timezone: 'UTC' };

const share = (numerator: number, denominator: number, observations: number = denominator): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: observations,
  pooled: null,
});

const cellsOf = (
  code: string,
  mentioned: MetricCell,
  extra: Partial<Parameters<typeof engine>[1]> = {},
): EngineSummary => engine(code, { mentioned, ...extra });

function summaryOf(...engines: EngineSummary[]): PromptsSummary {
  return {
    branded_only: false,
    engine_codes: engines.map((entry) => entry.engine_code),
    entities: [],
    entity_config_versions: [],
    include_branded: false,
    metric_context: {} as PromptsSummary['metric_context'],
    prompts: [promptRow('p1', 'one', [], engines)],
    topics: [],
    window: WINDOW,
  };
}

function aggregatesOf(over: Partial<AggregateInputs> & { current: PromptsSummary }): OverviewAggregates {
  const engines = (['chatgpt_web', 'gemini_web', 'google_ai_mode'] as const).map((code) => {
    const base = projectEngine(code);
    return { ...base, engine: { ...base.engine, exposes_fanout: code === 'chatgpt_web' } };
  });
  return buildAggregates({
    previous: null,
    engines,
    chosenEngines: null,
    topicsKept: null,
    sources: null,
    fanout: null,
    ...over,
  });
}

const figureOf = (reading: NumberReading | null): Extract<NumberReading, { status: 'read' }>['figure'] => {
  if (reading?.status !== 'read') throw new Error(`Expected a figure, got ${JSON.stringify(reading)}`);
  return reading.figure;
};

const chatgpt = { id: 'n', metric: 'ai.mention_rate', engine: 'chatgpt_web' } as const;

describe('the number sources', () => {
  it('cover exactly the numbers the catalog offers on the AI visibility screen', () => {
    const catalog = NUMBER_TYPES.filter((type) => type.screens.includes('ai_overview')).map((type) => type.metric);
    expect(Object.keys(NUMBER_VALUE_SOURCE).sort()).toEqual([...catalog].sort());
  });

  it('say per engine what the catalog says', () => {
    const sources: Readonly<Record<string, NumberSource | undefined>> = NUMBER_VALUE_SOURCE;
    for (const type of NUMBER_TYPES) {
      const source = sources[type.metric];
      if (source !== undefined) expect(source.perEngine).toBe(type.perEngine);
    }
  });

  it('read nothing for a metric they do not know, and for a per engine number without its engine', () => {
    const aggregates = aggregatesOf({ current: summaryOf(cellsOf('chatgpt_web', cell(3, 8))) });
    expect(readNumber(aggregates, { id: 'n', metric: 'seo.keywords_tracked' })).toBeNull();
    expect(readNumber(aggregates, { id: 'n', metric: 'ai.mention_rate' })).toBeNull();
  });
});

describe('ai.prompts_in_scope', () => {
  it('counts the prompts once and gives the topics they span, with no change', () => {
    const current = {
      ...summaryOf(cellsOf('chatgpt_web', cell(3, 8)), cellsOf('gemini_web', cell(3, 8))),
      topics: [
        { term_id: 't1', name: 'One', prompt_count: 1, engines: [], last_observed_at: null, last_valid_at: null },
      ],
    };
    const figure = figureOf(readNumber(aggregatesOf({ current }), { id: 'n', metric: 'ai.prompts_in_scope' }));
    expect(figure).toMatchObject({ state: 'ok', value: 1, topics: 1, change: null });
  });
});

describe('ai.mention_rate', () => {
  it('reads the rate, its counts, the invalid answers, the change and the companions of the same engine', () => {
    const current = summaryOf(
      cellsOf('chatgpt_web', cell(40, 100, 110), { cited: cell(21, 100), share_of_voice: share(27, 100) }),
    );
    const previous = summaryOf(cellsOf('chatgpt_web', cell(20, 100)));
    const aggregates = aggregatesOf({ current, previous });
    const figure = figureOf(readNumber(aggregates, chatgpt));
    expect(figure).toMatchObject({ state: 'ok', value: 0.4, k: 40, n: 100, unit: 'answers', prompts: 1, invalid: 10 });
    expect(figure.change).toMatchObject({ unit: 'points', detectable: true });
    expect(figure.change?.delta).toBeCloseTo(0.2, 10);
    expect(figure.companions).toEqual({ cited: 0.21, shareOfVoice: 0.27 });
  });

  it('has an unknown companion as null, never 0', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    const figure = figureOf(readNumber(aggregatesOf({ current }), chatgpt));
    expect(figure.companions).toEqual({ cited: null, shareOfVoice: null });
  });

  it('has fewer than 4 valid answers as insufficient with the count and no value and no change', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(2, 3)));
    const previous = summaryOf(cellsOf('chatgpt_web', cell(20, 100)));
    const figure = figureOf(readNumber(aggregatesOf({ current, previous }), chatgpt));
    expect(figure).toMatchObject({ state: 'insufficient', value: null, k: 2, n: 3 });
    expect(figure.change).toBeNull();
  });

  it('has no valid answer as none with its reason and the invalid count', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(0, 0, 5)));
    const figure = figureOf(readNumber(aggregatesOf({ current }), chatgpt));
    expect(figure).toMatchObject({ state: 'none', value: null, invalid: 5, reason: 'noneValid' });
  });

  it('has no change when the previous window has no answer', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    const previous = summaryOf(cellsOf('chatgpt_web', cell(0, 0, 0)));
    expect(figureOf(readNumber(aggregatesOf({ current, previous }), chatgpt)).change).toBeNull();
  });

  it('is not asked outside the engine filter and when the engine is off, with the reason', () => {
    const current = summaryOf(cellsOf('gemini_web', cell(40, 100)));
    const outside = aggregatesOf({ current, chosenEngines: ['gemini_web'] });
    expect(readNumber(outside, chatgpt)).toEqual({ status: 'notAsked', why: 'outsideFilter' });
    const off = aggregatesOf({ current, engines: [] });
    expect(readNumber(off, chatgpt)).toEqual({ status: 'notAsked', why: 'off' });
  });
});

describe('ai.valid_answers', () => {
  it('is the valid answers of the engine over all its answers, with the invalid count and a change in answers', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100, 110)));
    const previous = summaryOf(cellsOf('chatgpt_web', cell(10, 80, 80)));
    const figure = figureOf(
      readNumber(aggregatesOf({ current, previous }), { id: 'n', metric: 'ai.valid_answers', engine: 'chatgpt_web' }),
    );
    expect(figure).toMatchObject({ state: 'ok', value: 100, k: 100, n: 110, invalid: 10 });
    expect(figure.change).toEqual({ delta: 20, detectable: null, unit: 'count' });
  });

  it('is none, not 0, when the engine has no answer at all, and has the invalid count when none is valid', () => {
    const none = aggregatesOf({ current: summaryOf(cellsOf('chatgpt_web', cell(0, 0, 0))) });
    const asked = { id: 'n', metric: 'ai.valid_answers', engine: 'chatgpt_web' } as const;
    expect(figureOf(readNumber(none, asked))).toMatchObject({ state: 'none', value: null, invalid: 0 });
    const invalid = aggregatesOf({ current: summaryOf(cellsOf('chatgpt_web', cell(0, 0, 5))) });
    expect(figureOf(readNumber(invalid, asked))).toMatchObject({ state: 'none', value: null, k: 0, n: 5, invalid: 5 });
  });
});

describe('the other rates', () => {
  it('read the cited rate, the named and cited rate and the share of voice of the same engine', () => {
    const base = cellsOf('chatgpt_web', cell(40, 100), { cited: cell(60, 100), share_of_voice: share(27, 100) });
    const current = summaryOf({ ...base, outcomes: { ...base.outcomes, mentioned_and_cited: cell(30, 100) } });
    const aggregates = aggregatesOf({ current });
    const read = (metric: string): ReturnType<typeof figureOf> =>
      figureOf(readNumber(aggregates, { id: 'n', metric, engine: 'chatgpt_web' }));
    expect(read('ai.citation_rate')).toMatchObject({ value: 0.6, k: 60, n: 100, unit: 'answers' });
    expect(read('ai.mention_and_citation_rate')).toMatchObject({ value: 0.3, k: 30, n: 100 });
    expect(read('ai.share_of_voice')).toMatchObject({ value: 0.27, k: null, n: 100, unit: 'namingAnswers' });
  });

  it('has a share of voice change that is never coloured: no test', () => {
    const now = summaryOf(cellsOf('chatgpt_web', cell(40, 100), { share_of_voice: share(50, 100) }));
    const before = summaryOf(cellsOf('chatgpt_web', cell(40, 100), { share_of_voice: share(20, 100) }));
    const figure = figureOf(
      readNumber(aggregatesOf({ current: now, previous: before }), {
        id: 'n',
        metric: 'ai.share_of_voice',
        engine: 'chatgpt_web',
      }),
    );
    expect(figure.change?.delta).toBeCloseTo(0.3, 10);
    expect(figure.change?.detectable).toBeNull();
  });
});

describe('ai.citation_share', () => {
  const sources = (code: EngineCode): Schemas['SourcesMeta'] => ({
    answers: 100,
    answers_citing: 90,
    by_role: [],
    by_role_by_engine: [
      {
        engine_code: code,
        own: { answers_citing: 10, citation_units: 10 },
        competitor: { answers_citing: 30, citation_units: 30 },
        third_party: { answers_citing: 60, citation_units: 60 },
      },
    ],
    citation_units: 100,
    engine_codes: [code],
    include_branded: false,
    window: WINDOW,
  });
  const asked = { id: 'n', metric: 'ai.citation_share', engine: 'chatgpt_web' } as const;

  it('reads own units over all units with both counts, and no change (the read has no previous roles)', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    const figure = figureOf(readNumber(aggregatesOf({ current, sources: sources('chatgpt_web') }), asked));
    expect(figure).toMatchObject({ state: 'ok', value: 0.1, k: 10, n: 100, unit: 'citationUnits', change: null });
  });

  it('is unread until its own read answers, without touching the other numbers', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    const aggregates = aggregatesOf({ current });
    expect(readNumber(aggregates, asked)).toEqual({ status: 'unread' });
    expect(figureOf(readNumber(aggregates, chatgpt)).value).toBe(0.4);
  });
});

describe('ai.fanout_presence_rate', () => {
  const fanout: Schemas['FanoutMeta'] = {
    answers: 600,
    answers_truncated: 0,
    answers_with_fanout: 96,
    engine_codes: ['chatgpt_web'],
    engines_without_fanout: ['gemini_web', 'google_ai_mode'],
    include_branded: false,
    min_support: 1,
    window: WINDOW,
  };
  const metric = 'ai.fanout_presence_rate';

  it('reads the answers with a fan-out over the answers for ChatGPT', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    const figure = figureOf(readNumber(aggregatesOf({ current, fanout }), { id: 'n', metric, engine: 'chatgpt_web' }));
    expect(figure).toMatchObject({ state: 'ok', value: 0.16, k: 96, n: 600, unit: 'answers', change: null });
  });

  it('says not exposed for the engines that do not show their fan-out', () => {
    const current = summaryOf(cellsOf('gemini_web', cell(40, 100)));
    expect(readNumber(aggregatesOf({ current, fanout }), { id: 'n', metric, engine: 'gemini_web' })).toEqual({
      status: 'notExposed',
    });
  });

  it('is unread while its read is absent', () => {
    const current = summaryOf(cellsOf('chatgpt_web', cell(40, 100)));
    expect(readNumber(aggregatesOf({ current }), { id: 'n', metric, engine: 'chatgpt_web' })).toEqual({
      status: 'unread',
    });
  });

  it('is not asked, not not exposed, for an engine outside the filter', () => {
    const current = summaryOf(cellsOf('gemini_web', cell(40, 100)));
    const aggregates = aggregatesOf({ current, fanout, chosenEngines: ['gemini_web'] });
    expect(readNumber(aggregates, { id: 'n', metric, engine: 'chatgpt_web' })).toEqual({
      status: 'notAsked',
      why: 'outsideFilter',
    });
  });
});
