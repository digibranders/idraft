import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { buildAggregates, type AggregateInputs, type EngineAggregate } from './aggregates';
import { lastObservedAt } from '@/features/prompts/prompt-model';
import { cell, engine, projectEngine, promptRow } from '@/features/prompts/topics-by-engine/cells-fixtures';
import type {
  EngineCode,
  EngineSummary,
  MetricCell,
  ProjectEngine,
  PromptsSummary,
  PromptSummaryRow,
  Schemas,
} from '@/lib/api/types';
import { engineRates } from '@/lib/rates/strip-model';
import { isDetectableChange } from '@/lib/stats';
import { setAiSeeded } from '@/mocks/ai-seed';
import { MOCK_PROJECTS, MOCK_WORKSPACE } from '@/mocks/fixtures';
import { dataOf, mockBrowser } from '@/test/mock-api';

/** Thursday 12 November 2026, noon UTC: the Thursday run of 02:00 has answered. */
const NOW = Date.parse('2026-11-12T12:00:00Z');
const ALL: readonly EngineCode[] = ['chatgpt_web', 'gemini_web', 'google_ai_mode'];
const WINDOW = { from: '2026-10-16', to: '2026-11-12' };
const BEFORE = { from: '2026-09-18', to: '2026-10-15' };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => NOW);
  setAiSeeded(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAiSeeded(false);
});

// Builders: a summary written as counts, so a test reads "3 of 8 answers".

/** A share of voice cell: the numerator is a sum of shares of one answer each, so it need not be whole. */
const share = (numerator: number, denominator: number, observations: number = denominator): MetricCell => ({
  value: denominator === 0 ? null : numerator / denominator,
  numerator,
  denominator,
  n_observations: observations,
  pooled: null,
});

interface Cells {
  mentioned?: MetricCell;
  cited?: MetricCell;
  both?: MetricCell;
  share?: MetricCell;
}

/** One engine's cells of one prompt, with the named and cited outcome cell. */
function cellsOf(code: string, cells: Cells): EngineSummary {
  const base = engine(code, {
    ...(cells.mentioned === undefined ? {} : { mentioned: cells.mentioned }),
    ...(cells.cited === undefined ? {} : { cited: cells.cited }),
    ...(cells.share === undefined ? {} : { share_of_voice: cells.share }),
  });
  return cells.both === undefined ? base : { ...base, outcomes: { ...base.outcomes, mentioned_and_cited: cells.both } };
}

const row = (id: string, ...engines: EngineSummary[]): PromptSummaryRow => promptRow(id, id, [], engines);

/** A summary of prompt rows; the rest of it is not read by the aggregates. */
function summaryOf(prompts: PromptSummaryRow[], codes: readonly string[] = ['chatgpt_web']): PromptsSummary {
  return {
    branded_only: false,
    engine_codes: [...codes],
    entities: [],
    entity_config_versions: [],
    include_branded: false,
    metric_context: {} as PromptsSummary['metric_context'],
    prompts,
    topics: [],
    window: { ...WINDOW, timezone: 'UTC' },
  };
}

function projectEngineOf(code: EngineCode, over: { enabled?: boolean; fanout?: boolean } = {}): ProjectEngine {
  const base = projectEngine(code);
  return {
    ...base,
    is_enabled: over.enabled ?? true,
    engine: { ...base.engine, exposes_fanout: over.fanout ?? false },
  };
}

const ENGINES: ProjectEngine[] = [
  projectEngineOf('chatgpt_web', { fanout: true }),
  projectEngineOf('gemini_web'),
  projectEngineOf('google_ai_mode'),
];

function inputsOf(current: PromptsSummary, over: Partial<AggregateInputs> = {}): AggregateInputs {
  return {
    current,
    previous: null,
    engines: ENGINES,
    chosenEngines: null,
    topicsKept: null,
    sources: null,
    fanout: null,
    ...over,
  };
}

function engineOf(result: ReturnType<typeof buildAggregates>, code: EngineCode): EngineAggregate {
  const found = result.engines.find((entry) => entry.engineCode === code);
  if (found === undefined) throw new Error(`No aggregate for ${code}`);
  return found;
}

describe('the numbers of one engine', () => {
  it('has a mention rate that is the prompt weighted rate with the counts of the same cells', () => {
    const current = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(3, 8) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(1, 4) })),
      row('c', cellsOf('chatgpt_web', { mentioned: cell(0, 0, 2) })),
    ]);
    const { mentioned } = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    // (3/8 + 1/4) / 2 over the two prompts that have a valid answer; 4 of 12 answers pooled
    expect(mentioned.value).toBeCloseTo(0.3125, 10);
    expect(mentioned).toMatchObject({ state: 'ok', successes: 4, answers: 12, prompts: 2, reason: null });
  });

  it('has a share of voice that is the sum of the numerators over the sum of the denominators', () => {
    const current = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(3, 8), share: share(2.5, 5, 8) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(1, 4), share: share(1, 3, 4) })),
    ]);
    const { shareOfVoice } = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    expect(shareOfVoice.value).toBeCloseTo(3.5 / 8, 10);
    // The numerator is a sum of shares, not a count of answers
    expect(shareOfVoice).toMatchObject({ state: 'ok', answers: 8, successes: null });
  });

  it('has a named and cited rate from the outcomes cells, prompt weighted like the mention rate', () => {
    const current = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(6, 8), both: cell(2, 8) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(4, 4), both: cell(1, 4) })),
    ]);
    const { mentionedAndCited, mentioned } = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    expect(mentionedAndCited.value).toBeCloseTo((2 / 8 + 1 / 4) / 2, 10);
    expect(mentionedAndCited).toMatchObject({ state: 'ok', successes: 3, answers: 12, prompts: 2 });
    expect(mentioned.successes).toBe(10);
  });

  it('has fewer than 4 valid answers as insufficient: the count, no value', () => {
    const current = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(2, 3), cited: cell(1, 3) }))]);
    const result = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    expect(result.mentioned).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
    expect(result.cited).toMatchObject({ state: 'insufficient', value: null, answers: 3 });
    expect(result.validAnswers).toBe(3);
  });

  it('has no answer at all as none with its reason, and no valid answer as none with another', () => {
    const current = summaryOf(
      [
        row('a', cellsOf('chatgpt_web', { mentioned: cell(0, 0, 0) })),
        row('b', cellsOf('gemini_web', { mentioned: cell(0, 0, 5) })),
      ],
      ['chatgpt_web', 'gemini_web'],
    );
    const result = buildAggregates(inputsOf(current));
    expect(engineOf(result, 'chatgpt_web').mentioned).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noAnswers',
    });
    expect(engineOf(result, 'gemini_web').mentioned).toMatchObject({ state: 'none', value: null, reason: 'noneValid' });
    // An engine that is asked and has no row at all has not answered: unknown, never 0%
    expect(engineOf(result, 'google_ai_mode').mentioned).toMatchObject({
      state: 'none',
      value: null,
      reason: 'noAnswers',
    });
  });

  it('has valid answers and all answers as the sums of the denominators and of n_observations', () => {
    const current = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(3, 8, 10) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(1, 4, 5) })),
    ]);
    const result = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    expect(result.validAnswers).toBe(12);
    expect(result.allAnswers).toBe(15);
  });

  it('counts the prompts once, whatever the number of engines', () => {
    const current = summaryOf(
      [
        row('a', cellsOf('chatgpt_web', { mentioned: cell(3, 8) }), cellsOf('gemini_web', { mentioned: cell(1, 8) })),
        row('b', cellsOf('chatgpt_web', { mentioned: cell(1, 4) }), cellsOf('gemini_web', { mentioned: cell(1, 4) })),
      ],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(buildAggregates(inputsOf(current)).promptCount).toBe(2);
  });

  it('never returns a rate for a figure that is not ok', () => {
    const current = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(2, 3) }))]);
    for (const entry of buildAggregates(inputsOf(current)).engines) {
      for (const figure of [entry.mentioned, entry.cited, entry.mentionedAndCited, entry.shareOfVoice]) {
        if (figure.state !== 'ok') expect(figure.value).toBeNull();
      }
    }
  });
});

describe('the engines', () => {
  it('keep the fixed order ChatGPT, Gemini, AI Mode, with the catalog labels, whatever order the project lists them', () => {
    const reversed = [...ENGINES].reverse();
    const result = buildAggregates(inputsOf(summaryOf([]), { engines: reversed }));
    expect(result.engines.map((entry) => entry.engineCode)).toEqual(ALL);
    expect(result.engines.map((entry) => entry.label)).toEqual(['ChatGPT', 'Gemini', 'AI Mode']);
  });

  it('are not asked outside the engine filter, and have no figures', () => {
    const current = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(3, 8) }), cellsOf('gemini_web', { mentioned: cell(3, 8) })),
    ]);
    const result = buildAggregates(inputsOf(current, { chosenEngines: ['gemini_web'] }));
    const chatgpt = engineOf(result, 'chatgpt_web');
    expect(chatgpt).toMatchObject({ asked: false, availability: 'outsideFilter', validAnswers: 0, allAnswers: 0 });
    expect(chatgpt.mentioned).toMatchObject({ state: 'none', value: null });
    expect(chatgpt.previous).toBeNull();
    expect(engineOf(result, 'gemini_web')).toMatchObject({ asked: true, availability: 'asked', validAnswers: 8 });
  });

  it('are not asked when off in the project, and an engine the project does not list is off', () => {
    const engines = [projectEngineOf('chatgpt_web'), projectEngineOf('gemini_web', { enabled: false })];
    const result = buildAggregates(inputsOf(summaryOf([]), { engines }));
    expect(engineOf(result, 'gemini_web')).toMatchObject({ asked: false, availability: 'off' });
    expect(engineOf(result, 'google_ai_mode')).toMatchObject({ asked: false, availability: 'off' });
    expect(engineOf(result, 'chatgpt_web')).toMatchObject({ asked: true, availability: 'asked' });
  });
});

describe('the previous window', () => {
  const current = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(40, 100) }))]);

  it('is null when the comparison is off, with no change figure', () => {
    const result = engineOf(buildAggregates(inputsOf(current)), 'chatgpt_web');
    expect(result.previous).toBeNull();
    expect(result.change.mentioned).toEqual({ delta: null, detectable: null });
    expect(buildAggregates(inputsOf(current)).previousAnswers).toBeNull();
  });

  it('is null when the previous window has no answer of any kind: never a rate of zero', () => {
    const empty = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(0, 0, 0) }))]);
    const result = buildAggregates(inputsOf(current, { previous: empty }));
    const chatgpt = engineOf(result, 'chatgpt_web');
    expect(chatgpt.previous).toBeNull();
    expect(chatgpt.change.mentioned.delta).toBeNull();
    // The window was read and holds no valid answer: the caller says so, it is not unread
    expect(result.previousAnswers).toBe(0);
  });

  it('keeps the previous figures with the counts of the same arithmetic', () => {
    const previous = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(20, 100, 110), cited: cell(5, 100) })),
    ]);
    const chatgpt = engineOf(buildAggregates(inputsOf(current, { previous })), 'chatgpt_web');
    expect(chatgpt.previous?.mentioned).toMatchObject({ state: 'ok', successes: 20, answers: 100 });
    expect(chatgpt.previous).toMatchObject({ validAnswers: 100, allAnswers: 110 });
  });

  it('has a change in points that is the difference of the two rates, on the 0 to 1 scale', () => {
    const previous = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(20, 100) }))]);
    const { change } = engineOf(buildAggregates(inputsOf(current, { previous })), 'chatgpt_web');
    expect(change.mentioned.delta).toBeCloseTo(0.2, 10);
  });

  it('is detectable from isDetectableChange on the pooled counts, and not for a change within normal variation', () => {
    const previous = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(20, 100) }))]);
    const big = engineOf(buildAggregates(inputsOf(current, { previous })), 'chatgpt_web');
    expect(big.change.mentioned.detectable).toBe(isDetectableChange({ k: 40, n: 100 }, { k: 20, n: 100 }));
    expect(big.change.mentioned.detectable).toBe(true);

    const near = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(21, 100) }))]);
    const small = engineOf(
      buildAggregates(
        inputsOf(summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(22, 100) }))]), { previous: near }),
      ),
      'chatgpt_web',
    );
    expect(small.change.mentioned.detectable).toBe(isDetectableChange({ k: 22, n: 100 }, { k: 21, n: 100 }));
    expect(small.change.mentioned.detectable).toBe(false);
  });

  it('is detectable for the cited and the named and cited rates the same way', () => {
    const now = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(40, 100), cited: cell(60, 100), both: cell(30, 100) })),
    ]);
    const before = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(40, 100), cited: cell(20, 100), both: cell(10, 100) })),
    ]);
    const { change } = engineOf(buildAggregates(inputsOf(now, { previous: before })), 'chatgpt_web');
    expect(change.cited).toMatchObject({ detectable: true });
    expect(change.cited.delta).toBeCloseTo(0.4, 10);
    expect(change.mentionedAndCited).toMatchObject({ detectable: true });
    expect(change.mentioned).toMatchObject({ detectable: false });
    expect(change.mentioned.delta).toBeCloseTo(0, 10);
  });

  it('has no test for share of voice: the change is there and its detectability is null', () => {
    const now = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(40, 100), share: share(50, 100) }))]);
    const before = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(20, 100), share: share(20, 100) }))]);
    const { change } = engineOf(buildAggregates(inputsOf(now, { previous: before })), 'chatgpt_web');
    expect(change.shareOfVoice.delta).toBeCloseTo(0.3, 10);
    expect(change.shareOfVoice.detectable).toBeNull();
  });

  it('has no change and no test when either window has too few valid answers', () => {
    const few = summaryOf([row('a', cellsOf('chatgpt_web', { mentioned: cell(2, 3) }))]);
    const { change } = engineOf(buildAggregates(inputsOf(current, { previous: few })), 'chatgpt_web');
    expect(change.mentioned).toEqual({ delta: null, detectable: null });
  });

  it('makes no claim when the weighted change and the pooled counts point apart', () => {
    // Weighted: 0.5 against 0.104 is up. Pooled: 4 of 100 against 20 of 100 is down, and the test would call that detectable
    const now = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(4, 4) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(0, 96) })),
    ]);
    const before = summaryOf([
      row('a', cellsOf('chatgpt_web', { mentioned: cell(0, 4) })),
      row('b', cellsOf('chatgpt_web', { mentioned: cell(20, 96) })),
    ]);
    const { change } = engineOf(buildAggregates(inputsOf(now, { previous: before })), 'chatgpt_web');
    expect(change.mentioned.delta).toBeGreaterThan(0);
    expect(isDetectableChange({ k: 4, n: 100 }, { k: 20, n: 100 })).toBe(true);
    expect(change.mentioned.detectable).toBeNull();
  });

  it('reports the valid answers of the previous window over the engines asked', () => {
    const now = summaryOf(
      [row('a', cellsOf('chatgpt_web', { mentioned: cell(4, 10) }), cellsOf('gemini_web', { mentioned: cell(4, 10) }))],
      ['chatgpt_web', 'gemini_web'],
    );
    const before = summaryOf(
      [row('a', cellsOf('chatgpt_web', { mentioned: cell(4, 7) }), cellsOf('gemini_web', { mentioned: cell(4, 5) }))],
      ['chatgpt_web', 'gemini_web'],
    );
    expect(buildAggregates(inputsOf(now, { previous: before })).previousAnswers).toBe(12);
  });
});

describe('the freshness of the answers', () => {
  it('has lastValidAt and lastObservedAt as the newest of the prompt rows, and null with none', () => {
    const a = { ...row('a'), last_valid_at: '2026-11-10T02:00:00Z', last_observed_at: '2026-11-11T02:00:00Z' };
    const b = { ...row('b'), last_valid_at: '2026-11-12T02:00:00Z', last_observed_at: '2026-11-12T02:00:00Z' };
    const c = { ...row('c'), last_valid_at: null, last_observed_at: null };
    const result = buildAggregates(inputsOf(summaryOf([a, b, c])));
    expect(result.lastValidAt).toBe('2026-11-12T02:00:00Z');
    expect(result.lastObservedAt).toBe('2026-11-12T02:00:00Z');
    const none = buildAggregates(inputsOf(summaryOf([c])));
    expect(none.lastValidAt).toBeNull();
    expect(none.lastObservedAt).toBeNull();
  });
});

describe('the citation share', () => {
  const units = (own: number, competitor: number, third: number, code: EngineCode): Schemas['EngineRoleUnits'] => ({
    engine_code: code,
    own: { answers_citing: own, citation_units: own },
    competitor: { answers_citing: competitor, citation_units: competitor },
    third_party: { answers_citing: third, citation_units: third },
  });
  const meta = (byEngine: Schemas['EngineRoleUnits'][] | null): Schemas['SourcesMeta'] => ({
    answers: 100,
    answers_citing: 90,
    by_role: [],
    by_role_by_engine: byEngine,
    citation_units: 100,
    engine_codes: ['chatgpt_web', 'gemini_web'],
    include_branded: false,
    window: { ...WINDOW, timezone: 'UTC' },
  });

  it('is own citation units over all citation units of the engine, with both counts', () => {
    const sources = meta([units(10, 30, 60, 'chatgpt_web'), units(3, 1, 0, 'gemini_web')]);
    const result = buildAggregates(inputsOf(summaryOf([]), { sources }));
    expect(engineOf(result, 'chatgpt_web').citationShare).toEqual({ state: 'ok', value: 0.1, k: 10, n: 100 });
    // Four citation units: the smallest count that shows a rate
    expect(engineOf(result, 'gemini_web').citationShare).toEqual({ state: 'ok', value: 0.75, k: 3, n: 4 });
  });

  it('is insufficient under 4 citation units and none with no citation', () => {
    const sources = meta([units(1, 1, 1, 'chatgpt_web'), units(0, 0, 0, 'gemini_web')]);
    const result = buildAggregates(inputsOf(summaryOf([]), { sources }));
    expect(engineOf(result, 'chatgpt_web').citationShare).toEqual({ state: 'insufficient', value: null, k: 1, n: 3 });
    expect(engineOf(result, 'gemini_web').citationShare).toEqual({ state: 'none', value: null, k: 0, n: 0 });
  });

  it('is null (unknown) while the read is absent, for an engine it does not list and without the by engine block', () => {
    expect(engineOf(buildAggregates(inputsOf(summaryOf([]))), 'chatgpt_web').citationShare).toBeNull();
    const sources = meta([units(10, 30, 60, 'chatgpt_web')]);
    expect(engineOf(buildAggregates(inputsOf(summaryOf([]), { sources })), 'gemini_web').citationShare).toBeNull();
    expect(
      engineOf(buildAggregates(inputsOf(summaryOf([]), { sources: meta(null) })), 'chatgpt_web').citationShare,
    ).toBeNull();
  });
});

describe('the fan-out presence', () => {
  const meta = (codes: EngineCode[], without: EngineCode[]): Schemas['FanoutMeta'] => ({
    answers: 600,
    answers_truncated: 0,
    answers_with_fanout: 96,
    engine_codes: codes,
    engines_without_fanout: without,
    include_branded: false,
    min_support: 1,
    window: { ...WINDOW, timezone: 'UTC' },
  });

  it('is the answers with a fan-out over the answers, for the one engine that shows its fan-out', () => {
    const fanout = meta(['chatgpt_web'], ['gemini_web', 'google_ai_mode']);
    const result = buildAggregates(inputsOf(summaryOf([]), { fanout }));
    expect(engineOf(result, 'chatgpt_web').fanout).toEqual({
      exposed: true,
      presence: { state: 'ok', value: 0.16, k: 96, n: 600 },
    });
  });

  it('says not exposed for an engine that does not show its fan-out, never zero', () => {
    const fanout = meta(['chatgpt_web'], ['gemini_web', 'google_ai_mode']);
    const result = buildAggregates(inputsOf(summaryOf([]), { fanout }));
    expect(engineOf(result, 'gemini_web').fanout).toEqual({ exposed: false, presence: null });
    // The project engine says so as well, without the read
    expect(engineOf(buildAggregates(inputsOf(summaryOf([]))), 'gemini_web').fanout).toEqual({
      exposed: false,
      presence: null,
    });
  });

  it('is unknown while the read is absent', () => {
    expect(engineOf(buildAggregates(inputsOf(summaryOf([]))), 'chatgpt_web').fanout).toEqual({
      exposed: true,
      presence: null,
    });
  });

  it('is not split between engines: a read over two engines belongs to neither', () => {
    const engines = [projectEngineOf('chatgpt_web', { fanout: true }), projectEngineOf('gemini_web', { fanout: true })];
    const fanout = meta(['chatgpt_web', 'gemini_web'], []);
    const result = buildAggregates(inputsOf(summaryOf([]), { engines, fanout }));
    expect(engineOf(result, 'chatgpt_web').fanout).toEqual({ exposed: true, presence: null });
    expect(engineOf(result, 'gemini_web').fanout).toEqual({ exposed: true, presence: null });
  });
});

// R12: one denominator per number. The Overview and the Topics and Prompts strip read the same cells with the same
// functions, so for the same summary they show the same figure and the same counts.

const SUMMARY = z.custom<PromptsSummary>(
  (value) => typeof value === 'object' && value !== null && 'prompts' in value && 'engine_codes' in value,
);
const world = (slug: string): { path: string; engines: EngineCode[] } => {
  const project = MOCK_PROJECTS.find((entry) => entry.slug === slug);
  if (project === undefined) throw new Error(`The ${slug} project fixture is missing`);
  const path = `/api/v1/workspaces/${MOCK_WORKSPACE.workspace_id}/projects/${project.project_id}/ai/prompts-summary`;
  return { path, engines: slug === 'eventus-security' ? ['chatgpt_web', 'gemini_web'] : [...ALL] };
};
async function read(slug: string, window: { from: string; to: string }, query = ''): Promise<PromptsSummary> {
  const answer = await mockBrowser('viewer').call(
    'GET',
    `${world(slug).path}?from=${window.from}&to=${window.to}${query}`,
  );
  return dataOf(answer, SUMMARY);
}
const enabledEngines = (codes: readonly EngineCode[]): ProjectEngine[] =>
  ALL.map((code) => projectEngineOf(code, { enabled: codes.includes(code), fanout: code === 'chatgpt_web' }));

/** What the Prompts screen hands its strip: the prompt rows' topics and engines. */
const stripPromptsOf = (summary: PromptsSummary): { topic_term_ids: string[]; engines: EngineSummary[] }[] =>
  summary.prompts.map((prompt) => ({ topic_term_ids: prompt.topic_term_ids, engines: prompt.engines }));

function expectParity(summary: PromptsSummary, aggregates: ReturnType<typeof buildAggregates>): void {
  for (const code of ALL) {
    const strip = engineRates(stripPromptsOf(summary), code);
    const mine = engineOf(aggregates, code);
    if (!mine.asked) continue;
    expect(mine.mentioned).toEqual(strip.mentioned);
    expect(mine.cited).toEqual(strip.cited);
    expect(mine.shareOfVoice).toEqual(strip.shareOfVoice);
  }
  expect(aggregates.promptCount).toBe(summary.prompts.length);
  expect(aggregates.lastObservedAt).toBe(lastObservedAt(summary));
}

describe('R12: the mention rate equals the Topics and Prompts strip', () => {
  it('on the Fynix world: three engines, with their counts', async () => {
    const summary = await read('fynix', WINDOW);
    const aggregates = buildAggregates(inputsOf(summary, { engines: enabledEngines(world('fynix').engines) }));
    expect(summary.prompts.length).toBeGreaterThan(0);
    expect(aggregates.engines.some((entry) => entry.mentioned.state === 'ok')).toBe(true);
    expectParity(summary, aggregates);
  });

  it('on the Eventus Security world: two engines have answers and AI Mode is off, not zero', async () => {
    const summary = await read('eventus-security', WINDOW);
    const aggregates = buildAggregates(
      inputsOf(summary, { engines: enabledEngines(world('eventus-security').engines) }),
    );
    expect(engineOf(aggregates, 'chatgpt_web').mentioned.state).toBe('ok');
    expect(engineOf(aggregates, 'gemini_web').mentioned.state).toBe('ok');
    expect(engineOf(aggregates, 'google_ai_mode')).toMatchObject({ asked: false, availability: 'off' });
    expectParity(summary, aggregates);
  });

  it('in a scope with one engine: the others are not asked and the one engine still equals the strip', async () => {
    const summary = await read('fynix', WINDOW, '&filter[engine_code_in]=gemini_web');
    const aggregates = buildAggregates(
      inputsOf(summary, { engines: enabledEngines(world('fynix').engines), chosenEngines: ['gemini_web'] }),
    );
    expect(aggregates.engines.map((entry) => entry.asked)).toEqual([false, true, false]);
    expectParity(summary, aggregates);
  });

  it('in a scope with the comparison off: no previous figures, the current ones unchanged', async () => {
    const summary = await read('eventus-security', WINDOW);
    const engines = enabledEngines(world('eventus-security').engines);
    const compared = buildAggregates(inputsOf(summary, { engines, previous: await read('eventus-security', BEFORE) }));
    const off = buildAggregates(inputsOf(summary, { engines, previous: null }));
    expect(off.engines.every((entry) => entry.previous === null)).toBe(true);
    expect(off.previousAnswers).toBeNull();
    expect(off.engines.map((entry) => entry.mentioned)).toEqual(compared.engines.map((entry) => entry.mentioned));
    expectParity(summary, off);
    expectParity(summary, compared);
  });

  it('with the comparison on: the previous window reads through the same arithmetic as the strip would', async () => {
    const summary = await read('eventus-security', WINDOW);
    const before = await read('eventus-security', BEFORE);
    const aggregates = buildAggregates(
      inputsOf(summary, { engines: enabledEngines(world('eventus-security').engines), previous: before }),
    );
    const chatgpt = engineOf(aggregates, 'chatgpt_web');
    expect(chatgpt.previous?.mentioned).toEqual(engineRates(stripPromptsOf(before), 'chatgpt_web').mentioned);
  });

  it('for an engine with zero valid answers: unknown, never 0%, and the strip says the same', () => {
    const summary = summaryOf(
      [row('a', cellsOf('chatgpt_web', { mentioned: cell(0, 0, 6), cited: cell(0, 0, 6) }))],
      ['chatgpt_web'],
    );
    const aggregates = buildAggregates(inputsOf(summary));
    const chatgpt = engineOf(aggregates, 'chatgpt_web');
    expect(chatgpt.mentioned).toMatchObject({ state: 'none', value: null, reason: 'noneValid' });
    expect(chatgpt.validAnswers).toBe(0);
    expect(chatgpt.allAnswers).toBe(6);
    expectParity(summary, aggregates);
  });
});
